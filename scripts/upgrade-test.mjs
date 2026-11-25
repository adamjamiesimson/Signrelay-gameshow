import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';

const base = process.argv[2];
if (!base) throw new Error('Usage: node scripts/upgrade-test.mjs <previous-kiosk-dist>');
const before = JSON.parse(await readFile(resolve(base, 'runtime.json'), 'utf8')).version;
const after = JSON.parse(await readFile('dist/runtime.json', 'utf8')).version;
assert.notEqual(before, after);
const profile = await mkdtemp(resolve(tmpdir(), 'gameshow-upgrade-'));
const chrome = process.env.GAMESHOW_CHROME ??
  (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome');
const openBrowser = () => chromium.launchPersistentContext(profile, { executablePath: chrome, headless: true, reducedMotion: 'reduce' });
let server;
let context;
try {
  const initial = await serve({ directory: base });
  server = initial.server;
  const port = server.address().port;
  context = await openBrowser();
  let page = context.pages()[0];
  const startPage = async () => { await page.goto(initial.url); await page.locator('#registration-stage:visible, #wheel-stage:visible').waitFor(); };
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const ready = async version => {
    await click('Host controls');
    await page.waitForFunction(value => document.querySelector('#diagnostics').textContent.includes('Offline  Ready') &&
      document.querySelector('#diagnostics').textContent.includes(value), version);
    await click('Close host controls');
  };
  await startPage();
  await ready(before);
  if (await page.locator('#registration-stage').isVisible()) {
    await page.locator('#roster input').first().fill('Upgrade test player');
    await click('Start Game');
  } else {
    await click('Join the game');
    await page.locator('#name').fill('Upgrade test player');
    await click('Add player');
  }
  await page.waitForFunction(() => document.querySelector('#board-count').textContent === '1 player');

  await new Promise(done => server.close(done));
  server = (await serve({ port })).server;
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.waitForFunction(async ({ before, after }) => {
    const cachesNow = await caches.keys();
    return cachesNow.includes('signrelay-gameshow-' + after) && !cachesNow.includes('signrelay-gameshow-' + before);
  }, { before, after });
  assert.match(await page.locator('#board-list .board-name').first().textContent(), /Upgrade test player/);
  await page.reload();
  await page.locator('#registration-stage').waitFor();
  await context.close();
  context = await openBrowser();
  page = context.pages()[0];
  await startPage();
  try {
    await ready(after);
  } catch (error) {
    console.error(await page.locator('#diagnostics').textContent(), await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return { active: registration.active?.state, waiting: registration.waiting?.state, caches: await caches.keys() };
    }));
    throw error;
  }
  await page.locator('#registration-stage').waitFor();
  assert.equal(await page.locator('#board-list .board-name').count(), 0);
  const cachesAfter = await page.evaluate(() => caches.keys());
  assert.ok(cachesAfter.includes('signrelay-gameshow-' + after));
  assert.ok(!cachesAfter.includes('signrelay-gameshow-' + before));
  await context.setOffline(true);
  await new Promise(done => server.close(done));
  await page.reload();
  await ready(after);
  await page.locator('#registration-stage').waitFor();
  console.log('PASS same-origin upgrade ' + before + ' → ' + after + ' replaced the old cache and reopened offline at registration, with no historical player shown.');
} finally {
  await context?.close();
  if (server?.listening) await new Promise(done => server.close(done));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

