import { Camera } from './camera.mjs';
import { csv, leaderboard, MAX_ROUNDS, player, ROUND_MS, score, streaks, successful, timeLeft } from './game.mjs';
import { icon } from './icons.mjs';
import { checkOffline } from './offline.mjs';
import { SIGNS, signIds, signById } from './signs.mjs';
import { Audio, confetti, Wheel } from './spectacle.mjs';
import { newParty, partyAction, turnResult } from './party.mjs';
import { $, escapeHtml, renderBoard, renderHost, renderStage, setupIcons, threshold } from './view.mjs';

const settingsKey = 'signrelay-gameshow-settings';
const loadSettings = () => {
  try { return JSON.parse(localStorage.getItem(settingsKey)); } catch { return undefined; }
};
let state = newParty(loadSettings());
let myRun;
let starting;
let spin;
let problem = '';
let finishing = false;
let toastTimer;
let offline = 'Checking cache…';
let devices = [];
let observedHands = -1;
let tracking;
let evidence;
let challengeTick;
let nextTone;
let nextDiagnostics = 0;
let recoveryKey;
let recoveryInProgress = false;
const logs = [];

const audio = new Audio(() => state.settings);
const wheel = new Wheel($('wheel'), SIGNS, audio);
const camera = new Camera($('camera'), $('overlay'), cameraEvent, () => state.settings);
const uid = () => crypto.randomUUID();
const active = () => player(state);
const attemptKey = p => ({ personId: p?.id, challengeId: p?.pending?.id, run: p?.pending?.run });
const say = (element, value) => { if (element.textContent !== value) element.textContent = value; };
const hasDialog = () => !!document.querySelector('dialog[open]');

function log(message) {
  logs.push(new Date().toLocaleTimeString() + ' ' + message);
  if (logs.length > 25) logs.shift();
}
function toast(message) {
  clearTimeout(toastTimer);
  say($('toast'), message);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4800);
}
function diagnostics() {
  if (!$('host').open) return;
  const stats = evidence ? '\nTarget evidence ' + evidence.score.toFixed(3) + ' · p ' + evidence.p.toFixed(3) +
    ' · cosine ' + evidence.cosine.toFixed(3) + ' · unknown ' + evidence.unknown.toFixed(3) + ' · ' + evidence.ms + ' ms' : '';
  const ms = value => Number.isFinite(value) ? Math.max(0, Math.round(value)) + ' ms' : '—';
  const cadence = tracking?.fps ? '\nTracking  ' + tracking.fps + ' analyzed frames/s · ' + tracking.ms + ' ms latest' +
    '\nHand ' + ms(tracking.handMs) + ' · pose ' + ms(tracking.poseMs) + ' · capture ' + ms(tracking.captureMs) +
    ' · transfer ' + ms(tracking.transportMs) + ' · overlay age ' + ms(tracking.overlayMs) : '';
  say($('diagnostics'), 'Model  ' + camera.model + (camera.model === 'Ready' ? ' · ' + camera.delegate + ' tracking' : '') +
    '\nCamera  ' + camera.status + '\nOffline  ' + offline +
    '\nThreshold  ' + threshold(state.settings).toFixed(2) + stats + cadence + '\n\n' + logs.slice(-12).reverse().join('\n'));
}

function kind(p) {
  if (state.complete) return 'completion';
  if (!p) return 'registration';
  if (spin) return 'wheel';
  if (turnResult(state)) return 'result';
  if (p.pending) return p.pending.ready ? 'challenge' : 'teaching';
  return 'wheel';
}
function render() {
  const p = active();
  const stage = kind(p);
  const before = document.body.dataset.stage;
  const ui = { spinning: !!spin, starting, problem, result: turnResult(state), devices };
  renderStage(stage, p, state, ui);
  $('wheel').setAttribute('aria-label', 'Wheel: ' + SIGNS.map(s => s.word).join(', '));
  wheel.setUsed(p?.results.map(r => r.sign) ?? []);
  const muteButton = document.querySelector('[data-action="mute"]');
  muteButton.innerHTML = icon(state.settings.muted ? 'mute' : 'sound');
  muteButton.setAttribute('aria-label', state.settings.muted ? 'Unmute sound' : 'Mute sound');
  muteButton.title = muteButton.getAttribute('aria-label');
  muteButton.setAttribute('aria-pressed', String(state.settings.muted));
  if ($('host').open) renderHost(state, ui);
  diagnostics();
  if (stage === 'challenge') drawClock();
  if (stage !== before && !hasDialog()) {
    const title = $(stage + '-stage').querySelector('h1');
    if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
  }
}

function sync(newState, updateBoard) {
  const old = active();
  state = newState;
  const p = active();
  if (old?.id !== p?.id || old?.pending?.id !== p?.pending?.id) {
    observedHands = -1;
    tracking = undefined;
    evidence = undefined;
  }
  if (spin && (spin.personId !== p?.id || spin.challengeId !== p?.pending?.id)) {
    if (!spin.saving || spin.personId !== p?.id) { wheel.stop(); spin = null; }
  }
  if (myRun && p?.pending?.run !== myRun) {
    camera.stopCamera();
    myRun = null;
    observedHands = -1;
    tracking = undefined;
    evidence = undefined;
  }
  if (old?.id !== p?.id) {
    starting = undefined;
    problem = '';
    camera.stopCamera();
  }
  if (updateBoard) renderBoard(state);
  render();
}

function dispatch(action) {
  const next = partyAction(state, action, signIds);
  if (next === state) return false;
  if (action.type === 'settings') {
    try { localStorage.setItem(settingsKey, JSON.stringify(next.settings)); } catch {}
  }
  sync(next, ['start-game', 'restart-game', 'new-game', 'advance', 'result', 'pause', 'correct'].includes(action.type));
  return true;
}

function drawClock() {
  const p = active();
  if (!p?.pending?.ready) return;
  const round = p.pending;
  const remaining = timeLeft(round);
  const seconds = Math.ceil(remaining / 1000);
  say($('seconds'), String(seconds));
  $('countdown').classList.toggle('low', seconds <= 5);
  $('time-fill').style.transform = 'scaleX(' + (remaining / ROUND_MS).toFixed(4) + ')';
  if (!round.deadline) {
    say($('feedback'), problem ? 'The host can retry or switch to host judging.' : 'Ready to pick up where you left off?');
    return;
  }
  if (myRun !== round.run) return;
  if (seconds && seconds <= 5 && seconds !== nextTone) { nextTone = seconds; audio.play('final'); }
  if (remaining <= 0 && !finishing) void settle('timeout', myRun);
  const feedback = state.settings.manual ? 'Sign for your host before time runs out.' :
    observedHands <= 0 ? 'Show your hands inside the frame.' :
    evidence?.score >= threshold(state.settings) * .76 ? 'You’re getting closer!' : 'Take your time and try the movement again.';
  say($('feedback'), feedback);
}
function startClock() {
  clearInterval(challengeTick);
  nextTone = undefined;
  drawClock();
  challengeTick = setInterval(() => {
    if (!active()?.pending?.deadline && !starting) { clearInterval(challengeTick); challengeTick = undefined; }
    drawClock();
  }, 80);
}
function cameraEvent(type, value) {
  if (type === 'match') { void settle('automatic', value); return; }
  if (type === 'fault') { void recoverCamera(value); return; }
  if (type === 'hands') { tracking = value; observedHands = value.count; }
  if (type === 'evidence') evidence = value;
  if (type === 'hands' || type === 'evidence') {
    const now = performance.now();
    if (now < nextDiagnostics) return;
    nextDiagnostics = now + 250;
  }
  if (type === 'model' || type === 'camera') log(value);
  diagnostics();
}
async function refreshDevices() {
  try { devices = (await navigator.mediaDevices?.enumerateDevices() ?? []).filter(device => device.kind === 'videoinput'); }
  catch { devices = []; }
}
async function refreshOffline() {
  try {
    const data = await checkOffline();
    offline = data.installing ? 'Installing assets…' : data.missing.length ?
      data.missing.length + ' required assets missing' : 'Ready · ' + data.count + ' verified assets · ' + data.version;
  } catch (error) { offline = error.message; }
  diagnostics();
}
async function beginRound() {
  const p = active();
  if (starting || !p?.pending || p.pending.deadline) return;
  const request = {};
  starting = request;
  problem = '';
  const key = attemptKey(p);
  const run = uid();
  const { manual, camera: device } = state.settings;
  render();
  try {
    if (!manual) {
      const result = await Promise.allSettled([camera.warm(), camera.open(device)]);
      if (result[0].status === 'rejected') throw new Error('Recognition is unavailable. Retry or use host judging. ' + result[0].reason.message);
      if (result[1].status === 'rejected') throw result[1].reason;
      if (!result[1].value) return;
    }
    const current = active();
    if (starting !== request || current?.id !== key.personId || current?.pending?.id !== key.challengeId ||
        state.settings.manual !== manual || state.settings.camera !== device) return;
    myRun = run;
    starting = undefined;
    const committed = dispatch({ ...key, type: 'start', run });
    if (!committed) { myRun = null; camera.stopCamera(); return; }
    if (!manual) camera.play(run, current.pending.sign, threshold(state.settings));
    audio.play('start');
    startClock();
    void refreshDevices();
  } catch (error) {
    if (active()?.pending?.id === key.challengeId) {
      problem = error.message;
      camera.stopCamera();
      log(problem);
    }
  } finally {
    if (starting === request) { starting = undefined; render(); }
  }
}
async function recoverCamera({ message, workers }) {
  const p = active();
  const key = attemptKey(p);
  log(message);
  if (!key.run || key.run !== myRun || recoveryInProgress) { diagnostics(); return; }
  recoveryInProgress = true;
  problem = message + ' Your clock is paused.';
  await dispatch({ ...key, type: 'pause' });
  if (p.pending.id !== recoveryKey) {
    recoveryKey = p.pending.id;
    if (workers) void camera.warm().catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 350));
    if (active()?.pending?.id === p.pending.id && !document.hidden && !hasDialog()) await beginRound();
  }
  recoveryInProgress = false;
  render();
}
async function leaveRun(type) {
  const p = active();
  if (!p?.pending) return;
  const key = attemptKey(p);
  starting = undefined;
  problem = '';
  camera.stopCamera();
  await dispatch({ type, ...key });
}
async function settle(method, run) {
  const p = active();
  if (!p?.pending?.deadline || p.pending.run !== run || myRun !== run || finishing) return;
  const now = Date.now();
  if (method !== 'timeout' && now >= p.pending.deadline) return;
  finishing = true;
  const changed = dispatch({ ...attemptKey(p), type: 'result', method, now });
  finishing = false;
  const current = active();
  if (!changed || p.id !== current?.id) return;
  const result = turnResult(state);
  problem = '';
  render();
  const correct = successful(result);
  if (correct) {
    const streak = streaks(current).current;
    const perfect = score(current) === 50;
    audio.play(perfect ? 'perfect' : streak >= 3 ? 'streak' : 'win');
    confetti($('confetti'), streak >= 3 ? 2 : 1);
  } else audio.play('timeout');
}
async function roll() {
  const p = active();
  if (spin || !p || p.pending || turnResult(state) || p.results.length >= MAX_ROUNDS) return;
  const options = SIGNS.filter(sign => !p.results.some(result => result.sign === sign.id));
  const sign = options[Math.floor(Math.random() * options.length)].id;
  const revision = { personId: p.id, challengeId: uid(), saving: true };
  spin = revision;
  render();
  const committed = await dispatch({ type: 'spin', personId: p.id, sign, id: revision.challengeId });
  revision.saving = false;
  if (spin !== revision) return;
  if (committed) {
    const finished = await wheel.spin(sign);
    if (spin !== revision) return;
    if (finished) audio.play('select');
  }
  spin = null;
  render();
}

function show(name) {
  const dialog = $(name);
  if (!dialog.open) dialog.showModal();
}
function close(name) { if ($(name).open) $(name).close(); }
function confirmChange(message, label, callback) {
  $('confirm-message').textContent = message;
  $('confirm-yes').textContent = label;
  const dialog = $('confirm');
  dialog.returnValue = 'cancel';
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'yes') void callback();
  }, { once: true });
  show('confirm');
}
function fileDownload(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function nameField() {
  const row = document.createElement('div');
  row.className = 'roster-field';
  row.innerHTML = '<label><span></span><input name="player" maxlength="36" autocomplete="off"></label><button type="button" data-action="remove-player">Remove</button>';
  $('roster').append(row);
  labelRoster();
  return row.querySelector('input');
}
function labelRoster() {
  [...$('roster').children].forEach((row, i) => {
    row.querySelector('label span').textContent = 'Player ' + (i + 1);
    row.querySelector('button').setAttribute('aria-label', 'Remove player ' + (i + 1));
  });
}
function resetRoster() {
  $('roster').replaceChildren();
  for (let i = 0; i < 4; i++) nameField();
  $('roster-error').hidden = true;
}
function resetPlay(type) {
  if (spin) { wheel.stop(); spin = null; }
  starting = undefined;
  problem = '';
  camera.stopCamera();
  if (type === 'new-game') resetRoster();
  dispatch({ type });
}

const actions = {
  spin: roll,
  start: beginRound,
  next() {
    if (dispatch({ type: 'advance', turn: state.turn }) && state.complete) {
      audio.play('perfect');
      confetti($('confetti'), 3);
    }
  },
  'new-game': () => resetPlay('new-game'),
  'add-player': () => nameField().focus(),
  'remove-player'(button) {
    const row = button.closest('.roster-field');
    const neighbour = row.nextElementSibling ?? row.previousElementSibling;
    row.remove();
    if (neighbour) { labelRoster(); neighbour.querySelector('input').focus(); }
    else nameField().focus();
  },
  async host() {
    show('host');
    render();
    await refreshDevices();
    render();
    void refreshOffline();
  },
  leaderboard() { show('leader-dialog'); renderBoard(state); },
  async 'leader-fullscreen'() {
    const board = $('leader-dialog');
    try {
      if (board.classList.contains('full-display')) {
        board.classList.remove('full-display');
        if (board.dataset.enteredFullscreen && document.fullscreenElement) await document.exitFullscreen();
        delete board.dataset.enteredFullscreen;
      } else {
        board.classList.add('full-display');
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
          board.dataset.enteredFullscreen = 'true';
        }
      }
    } catch { toast('Fullscreen leaderboard is unavailable in this browser.'); }
  },
  async mute() { await dispatch({ type: 'settings', patch: { muted: !state.settings.muted } }); },
  async fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { toast('This browser could not enter fullscreen. Use its fullscreen menu.'); }
  },
  pause: () => leaveRun('pause'),
  manual() {
    const p = active();
    if (p?.pending?.deadline) void settle('manual', p.pending.run);
  },
  restart() {
    confirmChange('Restart this turn with a fresh 20 seconds?', 'Restart turn', () => leaveRun('restart'));
  },
  skip() {
    confirmChange('Return this sign to the wheel and let the current player spin again?', 'Skip challenge', () => leaveRun('skip'));
  },
  correct(control) {
    const p = state.people.find(person => person.id === control.dataset.person);
    const result = p?.results.find(item => item.id === control.dataset.challenge);
    if (!result) return;
    const award = !successful(result);
    confirmChange('Set ' + signById[result.sign].word + ' to ' + (award ? 10 : 0) + ' points for ' + p.name + '?', 'Save correction',
      () => dispatch({ type: 'correct', personId: p.id, challengeId: result.id, award }));
  },
  async retry() {
    if (active()?.pending?.deadline) await leaveRun('pause');
    problem = '';
    await camera.warm().catch(error => { problem = error.message; });
    if (active()?.pending) await beginRound();
    else toast(problem || 'Recognition models are ready.');
  },
  replay() {
    const video = $('lesson-video');
    video.currentTime = 0;
    video.play().catch(() => {});
  },
  async offline() { await refreshOffline(); toast(offline); },
  async persist() {
    try {
      const granted = await navigator.storage.persist();
      toast(granted ? 'Durable storage granted.' : 'Browser declined durable storage.');
    } catch { toast('Durable storage is unavailable in this browser.'); }
  },
  csv() {
    if (!state.people.length) { toast('Start a game to export scores.'); return; }
    fileDownload('signrelay-gameshow-leaderboard.csv', '\uFEFF' + csv(leaderboard(state.people)), 'text/csv;charset=utf-8');
  },
  'restart-game'() {
    if (!state.people.length) return;
    confirmChange('Start over with the same players and clear all their scores?', 'Restart game', () => {
      close('host');
      resetPlay('restart-game');
    });
  },
  reset() {
    confirmChange('Clear the current names and scores and return to registration?', 'New Game', () => {
      close('host');
      resetPlay('new-game');
    });
  },
};

setupIcons();
document.addEventListener('click', event => {
  const control = event.target.closest('button');
  if (!control) return;
  audio.unlock();
  if (control.dataset.close) { close(control.dataset.close); return; }
  if (actions[control.dataset.action]) Promise.resolve(actions[control.dataset.action](control)).catch(error => {
    log(error.message); toast(error.message);
  });
});
document.addEventListener('keydown', event => {
  if (event.altKey && event.key.toLowerCase() === 'h') {
    event.preventDefault();
    if ($('host').open) close('host'); else if (!hasDialog()) void actions.host();
  }
});
$('registration').addEventListener('submit', event => {
  event.preventDefault();
  audio.unlock();
  const entries = new FormData(event.currentTarget).getAll('player').map(name => ({ name, id: uid() }));
  if (dispatch({ type: 'start-game', entries })) $('roster').replaceChildren();
  else {
    $('roster-error').hidden = false;
    $('roster').querySelector('input').focus();
  }
});
$('roster').addEventListener('input', () => { $('roster-error').hidden = true; });
$('leader-dialog').addEventListener('close', () => {
  const board = $('leader-dialog');
  if (board.dataset.enteredFullscreen && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  board.classList.remove('full-display');
  delete board.dataset.enteredFullscreen;
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    $('leader-dialog').classList.remove('full-display');
    delete $('leader-dialog').dataset.enteredFullscreen;
  }
});
$('reference-video').closest('details').addEventListener('toggle', event => {
  const media = $('reference-video');
  if (event.target.open) media.play().catch(() => {}); else media.pause();
});
$('host').addEventListener('change', async event => {
  const { target } = event;
  const key = target.dataset.setting;
  if (!key) return;
  const value = target.type === 'checkbox' ? target.checked : target.type === 'range' ? Number(target.value) / 100 : target.value;
  if (key === 'camera' || key === 'manual') {
    if (active()?.pending?.deadline) await leaveRun('pause');
    else { starting = undefined; problem = ''; camera.stopCamera(); }
  }
  await dispatch({ type: 'settings', patch: { [key]: value } });
  camera.setThreshold(threshold(state.settings));
});
$('host').addEventListener('input', event => {
  if (event.target.id === 'volume') say($('volume-value'), event.target.value + '%');
  if (event.target.id === 'custom') say($('custom-value'), event.target.value);
});
navigator.mediaDevices?.addEventListener('devicechange', () => { if ($('host').open) void refreshDevices().then(render); });
navigator.serviceWorker?.addEventListener('controllerchange', () => { void refreshOffline(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && myRun && active()?.pending?.run === myRun) void leaveRun('pause');
});
window.addEventListener('pagehide', () => { camera.stopCamera(); });
window.addEventListener('pageshow', event => { if (event.persisted) resetPlay('new-game'); });

function boot() {
  resetRoster();
  render();
  void camera.warm().catch(() => {});
  void refreshOffline();
  fetch('./lesson-credits.json').then(response => response.ok ? response.json() : []).then(clips => {
    $('credits').innerHTML = '<p>PopSign ASL v2.1, Georgia Tech and the Deaf Professional Arts Network. Clips resized and muted.</p><ul>' +
      clips.map(clip => '<li>' + escapeHtml(clip.word) + ' · <a rel="noreferrer" target="_blank" href="' + escapeHtml(clip.source) +
        '">Source recording</a> · <a rel="noreferrer" target="_blank" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></li>').join('') + '</ul>';
  }).catch(() => {});
}
boot();

