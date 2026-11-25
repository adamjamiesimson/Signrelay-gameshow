import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launch } from './browser-common.mjs';
import { serve } from './serve.mjs';
import { formatPoints, weightedPoints } from '../src/game.mjs';

const [sample, target = 'PLEASE', wrong = 'DRINK', random = '0'] = process.argv.slice(2);
if (!sample) throw new Error('Usage: node scripts/camera-replay.mjs <please.y4m>');
const remote = process.env.GAMESHOW_TEST_URL;
const local = remote ? undefined : await serve({ directory: process.env.GAMESHOW_BROWSER_DIST ?? 'dist' });
const url = remote ?? local.url;
let browser;
try {
  browser = await launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    '--use-file-for-fake-video-capture=' + resolve(sample)] });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  await page.addInitScript(value => { Math.random = () => value; }, Number(random));
  await page.goto(url);
  const click = name => page.getByRole('button', { name, exact: true }).click();
  if (await page.locator('#registration-stage').count()) {
    await page.locator('#roster input').first().fill('Replay scorer');
    await click('Start Game');
  } else {
    await click('Join the game');
    await page.locator('#name').fill('Replay scorer');
    await click('Add player');
  }
  const spin = () => page.locator('#wheel-copy').getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  const lesson = word => page.getByRole('heading', { name: word, exact: true }).waitFor();
  await click('Host controls');
  await page.waitForFunction(() => document.querySelector('#diagnostics').textContent.includes('Model  Ready'), null, { timeout: 95000 });
  await click('Close host controls');
  await spin();
  await lesson(target);
  await click('Ready');
  await page.locator('#challenge-stage').waitFor({ state: 'visible' });
  const targetStart = performance.now();
  if (process.env.GAMESHOW_DEBUG) {
    await click('Host controls');
    await page.getByText('Readiness and diagnostics', { exact: true }).click();
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(750);
      console.log(await page.locator('#diagnostics').innerText(), await page.locator('#feedback').textContent());
    }
    await click('Close host controls');
  }
  await page.getByRole('heading', { name: 'You signed it!', exact: true }).waitFor({ timeout: 26000 });
  const targetMs = Math.round(performance.now() - targetStart);
  const awardNode = page.locator('#result-stage [data-award]');
  const weighted = await awardNode.count() > 0;
  let award = 1000;
  if (weighted) {
    award = Number(await awardNode.getAttribute('data-award'));
    const time = Number.parseFloat(await page.locator('.score-breakdown dd').first().textContent());
    assert.ok(award >= 500 && award <= 1000);
    assert.ok(Math.abs(award - weightedPoints(time * 1000)) <= 1, 'Award did not match the displayed signing time');
  } else assert.match(await page.locator('#result-stage').textContent(), /\+10/);
  await click('Next round');
  await spin();
  await lesson(wrong);
  await click('Ready');
  await page.locator('#challenge-stage').waitFor({ state: 'visible' });
  const began = performance.now();
  await page.getByRole('heading', { name: 'Nice try!', exact: true }).waitFor({ timeout: 26000 });
  const timeoutMs = Math.round(performance.now() - began);
  assert.ok(timeoutMs >= 19_500 && timeoutMs <= 21_500, 'Wrong-target round deadline drift: ' + timeoutMs + ' ms');
  assert.match(await page.locator('#result-stage').textContent(), /\+0/);
  assert.equal(await page.locator('#board-list [aria-current=true] .board-score').textContent(), (weighted ? formatPoints(award) : '10') + '/50');
  console.log('PASS prerecorded ' + target + ' awarded one automatic +' + formatPoints(award) + ' after ' + targetMs + ' ms; ' +
    wrong + ' timed out after ' + timeoutMs + ' ms with no additional score.');
  if (remote) {
    const { version } = JSON.parse(await readFile('dist/runtime.json'));
    const ready = async () => {
      await click('Host controls');
      await page.waitForFunction(expected => {
        const text = document.querySelector('#diagnostics').textContent;
        return text.includes('Model  Ready') && text.includes('Offline  Ready') && text.includes(expected);
      }, version, { timeout: 90000 });
      await click('Close host controls');
    };
    await ready();
    await page.context().setOffline(true);
    await page.reload();
    await page.locator('#registration-stage').waitFor();
    assert.equal(await page.locator('#roster input').first().inputValue(), '');
    await ready();
    await page.locator('#roster input').first().fill('Offline replay');
    await click('Start Game');
    await spin();
    await page.waitForFunction(() => document.querySelector('#lesson-video').readyState >= 2);
    await click('Ready');
    await page.waitForFunction(() => document.querySelector('#camera').srcObject?.active);
    console.log('PASS hosted build ' + version + ' reloaded offline with registration, lesson and camera');
  }
} finally {
  await browser?.close();
  if (local) await new Promise(resolve => { local.server.close(resolve); local.server.closeAllConnections(); });
}

