import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'gameshow-profile-'));
const local = process.env.GAMESHOW_TEST_URL ? undefined : await serve({ directory: process.env.GAMESHOW_BROWSER_DIST ?? 'dist' });
const url = process.env.GAMESHOW_TEST_URL ?? local.url;
const { version } = JSON.parse(await readFile(resolve(process.env.GAMESHOW_BROWSER_DIST ?? 'dist', 'runtime.json')));
const origin = new URL(url).origin;
const chrome = process.env.GAMESHOW_CHROME ??
  (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome');
let context, page;
const external = [];
const errors = [];
const delay = { timeout: 60000 };
const stage = name => page.locator('#' + name + '-stage').waitFor({ state: 'visible' });
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
const click = (name, scope = page) => button(name, scope).click();
const host = () => page.locator('#host');
const waitText = (selector, phrase) => page.waitForFunction(({ selector, phrase }) =>
  document.querySelector(selector)?.textContent.includes(phrase), { selector, phrase }, delay);
const stopServer = () => new Promise(done => {
  local.server.close(done);
  local.server.closeAllConnections();
});

async function openBrowser() {
  context = await chromium.launchPersistentContext(profile, { executablePath: chrome, headless: true,
    reducedMotion: 'reduce', viewport: { width: 1366, height: 768 }, acceptDownloads: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--disable-background-networking'] });
  page = context.pages()[0];
  page.setDefaultTimeout(20000);
  await page.addInitScript(() => {
    const nativeNow = performance.now.bind(performance);
    Object.defineProperty(performance, 'now', { value: () => window.scoringTestTime ?? nativeNow() });
  });
  context.on('request', request => {
    const value = new URL(request.url());
    if (value.origin !== origin && value.protocol !== 'blob:') external.push(request.url());
  });
  page.on('pageerror', error => errors.push(error.message));
}

async function readiness() {
  await click('Host controls');
  await waitText('#diagnostics', 'Model  Ready');
  await waitText('#diagnostics', 'Offline  Ready · 32 verified assets · ' + version);
  await waitText('#diagnostics', 'Threshold  0.60');
  await click('Close host controls', host());
}

async function confirm(name) {
  await click(name, host());
  await click(name, page.locator('#confirm'));
}

async function hostJudging(enabled) {
  await click('Host controls');
  await page.locator('#manual').setChecked(enabled);
  await click('Close host controls', host());
}

async function register(names) {
  await stage('registration');
  assert.equal(await page.locator('#roster input').count(), 4);
  for (const [index,name] of names.entries()) {
    if (index >= 4) await click('Add player field');
    await page.locator('#roster input').nth(index).fill(name);
  }
  await click('Start Game');
  await stage('wheel');
  assert.equal(await page.locator('#board-list [data-row]').count(), names.length);
}

async function playGame(names, { failFirst = false, checkHost = false } = {}) {
  await register(names);
  const signs = names.map(() => new Set());
  for (let round = 0; round < 5; round++) {
    for (const [index,name] of names.entries()) {
      await stage('wheel');
      assert.match(await page.locator('#wheel-title').textContent(), /you’re up/);
      assert.equal(await page.locator('#wheel-title').textContent(), name + ', you’re up.');
      const active = page.locator('#board-list [aria-current=true]');
      assert.match(await active.textContent(), new RegExp('#00' + (index + 1) + ' · ' + round + '/5 rounds'));
      assert.equal(await page.locator('#camera').evaluate(video => video.srcObject), null);
      assert.equal(await page.locator('#challenge-stage').isVisible(), false);
      await button('Spin the wheel', page.locator('#wheel-copy')).click();
      await stage('teaching');
      if (checkHost && !round && !index) {
        await click('Host controls');
        await confirm('Skip challenge');
        await click('Close host controls', host());
        await stage('wheel');
        await button('Spin the wheel', page.locator('#wheel-copy')).click();
        await stage('teaching');
      }
      const selected = await page.locator('#lesson-title').textContent();
      assert.ok(!signs[index].has(selected), 'repeated sign for ' + name);
      signs[index].add(selected);
      if (!round && !index) await page.waitForFunction(() => document.querySelector('#lesson-video').readyState >= 2);
      await page.evaluate(() => { window.scoringTestTime = performance.now(); });
      await click('Ready');
      await stage('challenge');
      assert.equal(await page.locator('#seconds').textContent(), '20');
      assert.equal(await page.locator('#potential-points').textContent(), '10.00');
      if (failFirst && !round) {
        await page.evaluate(() => { window.scoringTestTime += 20000; });
        await stage('result');
        await waitText('#result-stage', '+0.00');
      } else {
        await click('Host controls');
        if (checkHost && !round && !index) {
          await page.evaluate(() => { window.scoringTestTime += 1000; });
          await waitText('#potential-points', '9.75');
          await click('Pause', host());
          await page.evaluate(() => { window.scoringTestTime += 15000; });
          assert.equal(await page.locator('#potential-points').textContent(), '9.75');
          await click('Resume', host());
        } else if (checkHost && round === 1 && !index) {
          await page.evaluate(() => { window.scoringTestTime += 5000; });
          await confirm('Restart turn');
          await click('Start round', host());
        }
        await page.evaluate(amount => { window.scoringTestTime += amount; }, checkHost && !round && !index ? 1000 : 2000);
        await waitText('#potential-points', '9.50');
        await click('Confirm correct', host());
        await click('Close host controls', host());
        await stage('result');
        await waitText('#result-stage', '+9.50');
        assert.deepEqual(await page.locator('.score-breakdown dd').allTextContents(), ['2.00 s', '5.00', '+4.50']);
      }
      await page.evaluate(() => { delete window.scoringTestTime; });
      const last = round === 4 && index === names.length - 1;
      await click(last ? 'See final results' : names.length === 1 ? 'Next round' : 'Next Player');
    }
  }
  await stage('completion');
  await page.getByRole('heading', { name: names.length > 1 ? 'Shared victory!' : names[0] + ' wins!' }).waitFor();
  const standings = page.locator('.final-standings li');
  assert.equal(await standings.count(), names.length);
  for (const row of await standings.all()) {
    assert.equal(await row.locator('strong').textContent(), failFirst ? '38.00/50' : '47.50/50');
    assert.match(await row.locator('.final-metrics').textContent(), failFirst ? /4\/5 correct.*Best streak 4/ : /5\/5 correct.*Best streak 5/);
    assert.match(await row.locator('.final-metrics').textContent(), /Average 2.00 s.*Fastest .+2.00 s/);
    assert.equal(await row.locator('b').textContent(), '1');
  }
  if (checkHost) {
    await click('Host controls');
    await page.getByText('Correct a score', { exact: true }).click();
    await host().locator('[data-action=correct]').last().click();
    await click('Save correction', page.locator('#confirm'));
    await click('Close host controls', host());
    assert.equal(await standings.last().locator('strong').textContent(), '38.00/50');
    assert.match(await standings.last().locator('.final-metrics').textContent(), /Best streak 4/);
    assert.equal(await standings.last().locator('b').textContent(), String(names.length));
  }
  await click('New Game');
  await stage('registration');
  assert.deepEqual(await page.locator('#roster input').evaluateAll(inputs => inputs.map(input => input.value)), ['', '', '', '']);
  assert.equal(await page.locator('#board-list [data-row]').count(), 0);
  console.log('PASS ' + names.length + ' player game, weighted awards, rotation, five distinct signs, rankings, timing stats, and New Game');
}

try {
  await mkdir('test-output', { recursive: true });
  await openBrowser();
  await page.goto(url);
  await readiness();
  await click('Start Game');
  await waitText('#roster-error', 'Enter at least one');
  await page.locator('#roster input').last().fill('Removed name');
  await click('Remove player 4');
  await click('Add player field');
  assert.equal(await page.locator('#roster input').last().inputValue(), '');
  for (const [width,height] of [[1280,720], [1366,768], [1920,1080], [390,844]]) {
    await page.setViewportSize({ width, height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: 'test-output/party-registration.png' });
  const session = await context.newCDPSession(page);
  const heap = async () => {
    await session.send('HeapProfiler.collectGarbage');
    return Math.round((await session.send('Runtime.getHeapUsage')).usedSize / 1000) / 1000;
  };
  const before = await heap();
  await hostJudging(true);
  await playGame(['Solo']);
  await playGame(['Alex', 'Alex'], { failFirst: true });
  await playGame(['First', 'Second', 'Third', 'Fourth'], { checkHost: true });
  await playGame(Array.from({ length: 8 }, (_, i) => 'Player ' + (i + 1)));
  await hostJudging(false);
  console.log('PASS 75 completed turns across repeated games · renderer JS heap after GC ' + before + ' → ' + await heap() + ' MB');
  await register(['Reset check']);
  await click('Host controls');
  await host().getByText('Game and results', { exact: true }).click();
  await confirm('Restart game');
  await stage('wheel');
  assert.match(await page.locator('#wheel-title').textContent(), /Reset check/);
  await click('Full leaderboard');
  await click('Fullscreen leaderboard');
  await page.waitForFunction(() => document.querySelector('#leader-dialog').classList.contains('full-display'));
  await click('Fullscreen leaderboard');
  await click('Close leaderboard');
  assert.ok(!(await page.evaluate(() => Object.values(localStorage).join('').includes('Reset check'))));
  console.log('PASS expanded leaderboard and current roster kept out of browser settings');

  await context.close();
  await openBrowser();
  await page.goto(url);
  await stage('registration');
  await readiness();
  console.log('PASS fresh browser restart with models and cache intact');
  await context.setOffline(true);
  if (local) await stopServer();
  await page.reload();
  await stage('registration');
  await readiness();
  await register(['Offline party']);
  await button('Spin the wheel', page.locator('#wheel-copy')).click();
  await stage('teaching');
  await page.waitForFunction(() => document.querySelector('#lesson-video').readyState >= 2);
  await click('Ready');
  await page.waitForFunction(() => document.querySelector('#camera').srcObject?.active);
  await click('Host controls');
  await click('Confirm correct', host());
  await click('Close host controls', host());
  await stage('result');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('PASS expanded leaderboard, host controls, fresh browser restart, offline models, lessons, camera and scoring');
} finally {
  await context?.close();
  if (local?.server.listening) await stopServer();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
