import { leaderboard, MAX_ROUNDS, MODES, player, score, streaks, successful } from './game.mjs';
import { signById } from './signs.mjs';
import { icon } from './icons.mjs';
import { nextPlayer, roundNumber } from './party.mjs';

export const $ = name => document.getElementById(name);
export const escapeHtml = value => String(value).replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export const playerNumber = p => '#' + String(p.number).padStart(3, '0');
const button = (action, label, kind = '') => '<button data-action="' + action + '" class="' + kind + '">' + label + '</button>';
const buy = (action, label) => button(action, label, 'primary');
const podium = (current, p) => '<li class="board-row' + (current === p.id ? ' active' : '') + (p.points > 0 && p.rank === 1 ? ' best' : '') +
  '" data-row="' + p.id + '"' + (current === p.id ? ' aria-current="true"' : '') + '><span class="rank">' + p.rank +
  '</span><div><div class="board-name">' + escapeHtml(p.name) + '</div><div class="board-meta">' + playerNumber(p) +
  ' · ' + p.results.length + '/5 rounds' + (p.streak >= 3 ? ' · ' + p.streak + '-sign streak' : '') +
  '</div></div><span class="board-score"><span data-points="' + p.points + '">' + p.points + '</span><small>/50</small></span></li>';

export function setupIcons() {
  for (const [action, mark] of Object.entries({ mute:'sound', fullscreen:'fullscreen', host:'gear', leaderboard:'board', 'leader-fullscreen':'fullscreen', replay:'replay' })) {
    document.querySelectorAll('button[data-action="' + action + '"].icon-button,button[data-action="' + action + '"].media-control')
      .forEach(control => { control.innerHTML = icon(mark); });
  }
  document.querySelectorAll('button[data-close].icon-button').forEach(control => { control.innerHTML = icon('close'); });
}

export function renderBoard(state) {
  const rows = leaderboard(state.people);
  for (const id of ['board-list', 'full-board']) {
    const list = $(id);
    if (id === 'full-board' && !$('leader-dialog').open) continue;
    const previous = new Map([...list.querySelectorAll('[data-row]')].map(row => [row.dataset.row,
      { top: row.offsetTop, points: Number(row.querySelector('[data-points]')?.textContent) }]));
    const scroll = list.scrollTop;
    list.innerHTML = rows.length ? rows.map(p => podium(state.activeId, p)).join('') :
      '<li class="board-empty">Scores appear when players join.</li>';
    list.scrollTop = scroll;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      [...list.querySelectorAll('[data-row]')].forEach(row => {
        const prior = previous.get(row.dataset.row);
        if (!prior) return;
        if (prior.top !== row.offsetTop) row.animate(
          [{ transform: 'translateY(' + (prior.top - row.offsetTop) + 'px)' }, { transform: 'none' }], { duration: 330, easing: 'ease-out' });
        const points = row.querySelector('[data-points]');
        const total = Number(points.dataset.points);
        if (Number.isFinite(prior.points) && prior.points !== total) {
          const start = performance.now();
          const step = now => {
            if (!points.isConnected) return;
            const part = Math.min(1, (now - start) / 330);
            points.textContent = Math.round(prior.points + (total - prior.points) * part);
            if (part < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }
      });
    }
  }
  $('board-count').textContent = rows.length + (rows.length === 1 ? ' player' : ' players');
  const p = player(state);
  const next = nextPlayer(state);
  const count = p?.results.length ?? 0;
  const dots = Array.from({ length: MAX_ROUNDS }, (_, i) => {
    const kind = i < count ? successful(p.results[i]) ? 'won' : 'missed' : i === count && p ? 'next' : '';
    return '<i class="' + kind + '"></i>';
  }).join('');
  $('player-card').innerHTML = p
    ? '<div class="player-card-head"><div><p class="eyebrow">CURRENT PLAYER</p><h2>' +
      escapeHtml(p.name) + ' <span>' + playerNumber(p) + '</span></h2></div><span class="board-score">' + score(p) +
      '<small>/50</small></span></div><div class="round-dots" aria-label="' + count + ' of 5 rounds complete">' + dots + '</div>' +
      '<p class="player-hint">Round ' + roundNumber(state) + ' of 5 · ' +
      (next ? 'Next up ' + escapeHtml(next.name) + ' · ' + playerNumber(next) : 'Final turn') + '</p>'
    : '<p class="eyebrow">GAME COMPLETE</p><h2>Final standings</h2>';
}

function stage(name) {
  const previous = document.body.dataset.stage;
  document.body.dataset.stage = name;
  for (const id of ['registration', 'wheel', 'teaching', 'challenge', 'result', 'completion']) $(id + '-stage').hidden = id !== name;
  $('game-side').hidden = name === 'registration';
  if (previous !== name) {
    if (previous === 'teaching') $('lesson-video').pause();
    if (previous === 'challenge') {
      $('reference-video').pause();
      $('reference-video').closest('details').open = false;
    }
  }
}

const setVideo = (id, sign) => {
  const element = $(id);
  const source = './lessons/' + sign.id + '.mp4';
  if (element.getAttribute('src') !== source) element.setAttribute('src', source);
  return element;
};
export function renderStage(kind, p, state, ui) {
  stage(kind);
  const sign = p?.pending ? signById[p.pending.sign] : null;
  if (kind === 'wheel') {
    $('wheel-hub').disabled = !p || ui.spinning;
    $('wheel-copy').innerHTML = '<p class="eyebrow">ROUND ' + roundNumber(state) + ' OF 5 · ' + playerNumber(p) + '</p><h1 id="wheel-title">' + escapeHtml(p.name) + '<em>, you’re up.</em></h1><p class="description">Take your place at the camera, then spin for your sign.</p>' +
      '<button class="primary gold" data-action="spin"' + (ui.spinning ? ' disabled' : '') + '>' + (ui.spinning ? 'Wheel spinning…' : 'Spin the wheel') + '</button>';
  } else if (kind === 'teaching') {
    $('lesson-copy').innerHTML = '<p class="eyebrow">LEARN ROUND ' + (p.results.length + 1) + '</p><h1 id="lesson-title">' + sign.word +
      '</h1><p class="description">' + sign.cue + '</p><div class="button-row">' +
      '<button class="primary" data-action="start"' + (ui.starting ? ' disabled' : '') + '>' + (ui.starting ? 'Getting ready…' : 'Ready') + '</button>' +
      '</div>' + (ui.problem ? '<p class="player-hint" role="status">' + escapeHtml(ui.problem) + '</p>' : '');
    const video = setVideo('lesson-video', sign);
    if (video.paused) video.play().catch(() => {});
  } else if (kind === 'challenge') {
    $('challenge-copy').innerHTML = '<p class="eyebrow">ROUND ' + (p.results.length + 1) + ' OF 5</p><h1 id="challenge-title">' + sign.word +
      '</h1><p class="meta">' + escapeHtml(p.name) + ' · ' + score(p) + '/50 points</p>';
    setVideo('reference-video', sign);
    $('challenge-actions').innerHTML = !p.pending.deadline ?
      '<button class="primary" data-action="start"' + (ui.starting ? ' disabled' : '') + '>' + (ui.starting ? 'Getting ready…' : 'Resume') + '</button>' : '';
    $('camera-message').innerHTML = ui.problem
      ? icon('camera') + '<span>' + escapeHtml(ui.problem) + '</span>'
      : state.settings.manual ? icon('hand') + '<span>Show the sign to your host</span>'
      : !p.pending.deadline ? icon('camera') + '<span>Challenge paused</span>' : '';
  } else if (kind === 'result') {
    const r = ui.result;
    const next = nextPlayer(state);
    const correct = successful(r);
    const chain = streaks(p).current;
    const screen = $('result-stage');
    screen.classList.toggle('win', correct);
    screen.innerHTML = '<p class="eyebrow">' + signById[r.sign].word + ' · ROUND ' + p.results.length + ' OF 5</p><h1>' +
      (correct ? 'You signed it!' : 'Nice try!') + '</h1><div class="result-points">' + (correct ? '+10' : '+0') +
      ' <small>points</small></div>' + (correct && chain >= 3 ? '<p class="streak">' + icon('bolt') + ' ' + chain + '-SIGN STREAK</p>' : '') +
      '<p class="description">' + escapeHtml(p.name) + ' · ' + score(p) + '/50' +
      (next ? '<br>Up next ' + escapeHtml(next.name) + ' · ' + playerNumber(next) : '') +
      '</p>' + buy('next', next ? state.people.length === 1 ? 'Next round' : 'Next Player' : 'See final results');
  } else if (kind === 'completion') {
    const rows = leaderboard(state.people);
    const winners = rows.filter(row => row.rank === 1);
    const places = [2, 1, 3].map(rank => {
      const people = rows.filter(row => row.rank === rank);
      return '<li class="podium-place place-' + rank + '"><span>' + ['','1st','2nd','3rd'][rank] + '</span>' +
        (people.length ? people.map(row => '<strong>' + escapeHtml(row.name) + ' <small>' + playerNumber(row) + '</small></strong>').join('') +
          '<span>' + people[0].points + '/50</span>' : '<span aria-label="No player at this rank">—</span>') + '</li>';
    }).join('');
    const screen = $('completion-stage');
    screen.classList.toggle('perfect', winners[0].points === 50);
    screen.innerHTML = '<div class="finale-head"><p class="eyebrow">FIVE ROUNDS COMPLETE</p><h1>' +
      (winners.length > 1 ? 'Shared victory!' : escapeHtml(winners[0].name) + ' wins!') + '</h1>' +
      (winners[0].points === 50 ? '<p class="finale-perfect">Perfect score · 50/50</p>' : '') + '</div><ol class="podium" aria-label="Podium">' + places +
      '</ol><ul class="final-standings" aria-label="Final scores and best streaks">' + rows.map(row =>
        '<li><span><b>' + row.rank + '</b> ' + escapeHtml(row.name) + ' <small>' + playerNumber(row) + '</small></span><strong>' + row.points + '/50</strong><small>Best streak ' + streaks(row).best + '</small></li>').join('') +
      '</ul>' + buy('new-game', 'New Game');
  }
}

export function renderHost(state, ui) {
  const p = player(state);
  const r = p?.pending;
  $('host-round').innerHTML = p ? '<p>' + escapeHtml(p.name) + ' · ' + playerNumber(p) + ' · ' + score(p) + '/50</p>' +
    (r ? '<div class="button-row">' +
      (r.deadline ? button('pause', 'Pause') + button('manual', 'Confirm correct', 'primary') : button('start', r.ready ? 'Resume' : 'Start round')) +
      button('restart', 'Restart turn') + button('skip', 'Skip challenge') + '</div>' : '') : '';
  if (state.people.some(person => person.results.length)) {
    $('host-round').insertAdjacentHTML('beforeend', '<details><summary>Correct a score</summary>' + state.people.filter(person => person.results.length).map(person =>
      '<p>' + escapeHtml(person.name) + ' · ' + playerNumber(person) + '</p><div class="button-row">' + person.results.map(result =>
        '<button data-action="correct" data-person="' + person.id + '" data-challenge="' + result.id + '">' + signById[result.sign].word + ' · ' +
        (successful(result) ? 'set to 0' : 'award 10') + '</button>').join('') + '</div>').join('') + '</details>');
  }
  const { settings } = state;
  $('sensitivity').value = settings.mode;
  $('custom').value = Math.round(settings.custom * 100);
  $('custom-value').textContent = $('custom').value;
  $('custom-row').hidden = settings.mode !== 'custom';
  $('volume').value = Math.round(settings.volume * 100);
  $('volume-value').textContent = $('volume').value + '%';
  $('overlay-setting').checked = settings.overlay;
  $('manual').checked = settings.manual;
  $('camera-select').innerHTML = '<option value="">Default camera</option>' + ui.devices.map((d, i) =>
    '<option value="' + escapeHtml(d.deviceId) + '">' + escapeHtml(d.label || 'Camera ' + (i + 1)) + '</option>').join('');
  if (settings.camera && !ui.devices.some(d => d.deviceId === settings.camera)) {
    const option = document.createElement('option');
    option.value = settings.camera;
    option.textContent = 'Saved camera (unavailable)';
    $('camera-select').append(option);
  }
  $('camera-select').value = settings.camera;
}

export const threshold = settings => settings.mode === 'custom' ? settings.custom : MODES[settings.mode];

