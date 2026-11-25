import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launch } from './browser-common.mjs';
import { serve } from './serve.mjs';

const [sample, cycleArg = '24', secondsArg = '6'] = process.argv.slice(2);
const reverse = process.argv.includes('--reverse');
if (!sample) throw new Error('Usage: node scripts/booth-benchmark.mjs <replay.y4m> [cycles] [seconds per cycle]');
const cycles = Number(cycleArg);
const period = Number(secondsArg) * 1000;
assert.ok(Number.isInteger(cycles) && cycles >= 0 && cycles <= 100);
assert.ok(Number.isFinite(period) && period >= 1000 && period <= 12000);
const browser = await launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  '--use-file-for-fake-video-capture=' + resolve(sample)] });
const { server, url } = await serve({ directory: process.env.GAMESHOW_BROWSER_DIST ?? 'dist' });
const began = performance.now();
const errors = [];
const quantile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(p * values.length) - 1] : null;

try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Math.random = () => .55;
    const WorkerBase = Worker;
    const oscillatorStart = OscillatorNode.prototype.start;
    const oscillatorStop = OscillatorNode.prototype.stop;
    const timer = { starts: 0, stops: 0, ended: 0 };
    window.soundStats = timer;
    OscillatorNode.prototype.start = function (...args) {
      timer.starts++;
      this.addEventListener('ended', () => timer.ended++, { once: true });
      return oscillatorStart.apply(this, args);
    };
    OscillatorNode.prototype.stop = function (...args) {
      timer.stops++;
      return oscillatorStop.apply(this, args);
    };
    const probe = window.workerProbe = { active: {}, creates: { tracker: 0, classifier: 0 }, delegates: [], frames: [], batches: [], paints: [], longTasks: [] };
    new PerformanceObserver(list => probe.longTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask' });
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.id === 'overlay' && probe.overlayAt !== undefined) {
        const start = performance.now();
        const timestamp = probe.overlayAt;
        queueMicrotask(() => probe.paints.push({ age: start - timestamp, draw: performance.now() - start }));
      }
      return clear.apply(this, args);
    };
    window.Worker = class MeasuredWorker extends WorkerBase {
      constructor(url, options) {
        super(url, options);
        const what = String(url).endsWith('tracker.js') ? 'tracker' : 'classifier';
        window.workerProbe.active[what] = this;
        window.workerProbe.creates[what]++;
        this.addEventListener('message', ({ data }) => {
          if (what === 'tracker' && data.type === 'ready' && data.delegate) probe.delegates.push(data.delegate);
          if (data.type === 'overlay' || data.hands?.length) probe.overlayAt = data.timestamp;
          if (data.type === 'frame') probe.frames.push({ at: performance.now(), age: performance.now() - data.timestamp,
            cpu: data.ms, hands: data.handCount, handMs: data.handMs, poseMs: data.poseMs, copyMs: data.copyMs, width: data.width, height: data.height });
          if (data.type === 'verified' && data.windowsRun) probe.batches.push({ at: performance.now(), age: performance.now() - data.timestamp,
            cpu: data.ms, prepareMs: data.prepareMs, windows: data.windowsRun });
        });
      }
    };
  });
  const browserCDP = await browser.newBrowserCDPSession();
  const gpu = await browserCDP.send('SystemInfo.getInfo');
  const graphics = { devices: gpu.gpu.devices.map(device => device.deviceString), renderer: gpu.gpu.auxAttributes?.glRenderer,
    webgl: gpu.gpu.featureStatus?.webgl };
  const cdp = await page.context().newCDPSession(page);
  const cpu = async () => {
    const { processInfo } = await browserCDP.send('SystemInfo.getProcessInfo');
    return processInfo.reduce((sum, p) => ({ total: sum.total + p.cpuTime,
      gpu: sum.gpu + (p.type === 'GPU' ? p.cpuTime : 0) }), { total: 0, gpu: 0 });
  };
  const mem = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const value = await cdp.send('Runtime.getHeapUsage');
    const sample = { usedMB: Math.round(value.usedSize / 1000) / 1000, embedderMB: Math.round((value.embedderHeapUsedSize ?? 0) / 1000) / 1000 };
    if (process.platform === 'win32') {
      const { processInfo } = await browserCDP.send('SystemInfo.getProcessInfo');
      const ids = processInfo.map(row => row.id).filter(Number.isSafeInteger);
      if (ids.length) {
        const command = '(Get-Process -Id ' + ids.join(',') +
          ' -ErrorAction SilentlyContinue | Measure-Object -Property WorkingSet64 -Sum).Sum';
        const bytes = Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' }).trim());
        if (Number.isFinite(bytes)) sample.summedWorkingSetMB = Math.round(bytes / 100_000) / 10;
      }
    }
    return sample;
  };
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const host = () => click('Host controls');
  const close = () => click('Close host controls');
  const track = () => page.waitForFunction(() => document.querySelector('#camera').srcObject?.getVideoTracks()[0]?.readyState === 'live');
  const noTrack = () => page.waitForFunction(() => document.querySelector('#camera').srcObject === null);
  const pause = async () => { await host(); await click('Pause'); await close(); await noTrack(); };
  const restart = async () => {
    await host();
    const label = party ? 'Restart turn' : 'Restart round';
    await click(label);
    await page.locator('#confirm').getByRole('button', { name: label, exact: true }).click();
    await close();
  };
  await page.goto(url);
  const party = await page.locator('#registration-stage').count() !== 0;
  await host();
  await page.waitForFunction(() => document.querySelector('#diagnostics').textContent.includes('Model  Ready'));
  await close();
  if (party) {
    await page.locator('#roster input').first().fill('Booth benchmark');
    await click('Start Game');
  } else {
    await click('Join the game');
    await page.locator('#name').fill('Booth benchmark');
    await click('Add player');
  }
  await page.evaluate(() => {
    const values = [];
    window.spinFrames = values;
    function observe(now) {
      if (values.length) window.spinMaxDelta = Math.max(window.spinMaxDelta ?? 0, now - values.at(-1));
      values.push(now);
      if (document.querySelector('#teaching-stage').hidden && values.length < 1000) requestAnimationFrame(observe);
    }
    requestAnimationFrame(observe);
  });
  await page.locator('#wheel-copy button[data-action=spin]').click();
  await page.getByRole('heading', { name: 'STOP', exact: true }).waitFor();
  const spin = await page.evaluate(() => {
    const frames = window.spinFrames;
    const duration = frames.at(-1) - frames[0];
    return { frames: frames.length, spanMs: Math.round(duration), rafFps: Math.round(1000 * (frames.length - 1) / duration),
      longestFrameGapMs: Math.round(window.spinMaxDelta), oscillatorStarts: window.soundStats.starts };
  });
  const phases = {};
  async function measure(key, ms) {
    const startCpu = await cpu();
    await page.evaluate(() => {
      const probe = window.workerProbe;
      for (const key of ['frames', 'batches', 'paints', 'longTasks']) probe[key].length = 0;
      const video = document.querySelector('#camera');
      probe.video = { firstFrame: null, lastFrame: null };
      const sample = (_, frame) => {
        probe.video.firstFrame ??= frame.presentedFrames;
        probe.video.lastFrame = frame.presentedFrames;
        probe.video.frameCallback = video.requestVideoFrameCallback(sample);
      };
      probe.video.frameCallback = video.requestVideoFrameCallback(sample);
    });
    const start = performance.now();
    await page.waitForTimeout(ms);
    const elapsed = (performance.now() - start) / 1000;
    const { frames, batches, paints, longTasks, video, width, height } = await page.evaluate(() => {
      const element = document.querySelector('#camera');
      const { frames, batches, paints, longTasks, video } = window.workerProbe;
      element.cancelVideoFrameCallback(video.frameCallback);
      return { frames, batches, paints, longTasks, video, width: element.videoWidth, height: element.videoHeight };
    });
    const endingCpu = await cpu();
    const p95 = (items, key) => quantile(items.map(item => item[key]).filter(Number.isFinite), .95);
    phases[key] = { elapsedSeconds: Math.round(elapsed * 100) / 100, analyzedFrames: frames.length,
      analyzedFps: Math.round(frames.length / elapsed * 100) / 100, framesWithHands: frames.filter(item => item.hands).length,
      trackingP50Ms: quantile(frames.map(item => item.cpu), .50), trackingP95Ms: quantile(frames.map(item => item.cpu), .95),
      classifierP50Ms: quantile(batches.map(item => item.cpu), .50), classifierP95Ms: quantile(batches.map(item => item.cpu), .95),
      classifierBatches: batches.length, classifierWindows: batches.reduce((sum, item) => sum + item.windows, 0),
      chromeCpuSeconds: Math.round((endingCpu.total - startCpu.total) * 100) / 100,
      chromeGpuProcessCpuSeconds: Math.round((endingCpu.gpu - startCpu.gpu) * 100) / 100,
      cameraResolution: [width,height], presentedCameraFps: Math.round((video.lastFrame - video.firstFrame + 1) / elapsed * 100) / 100,
      analysisResolutions: [...new Set(frames.filter(frame => frame.width).map(frame => frame.width + '×' + frame.height))],
      captureToTrackingP95Ms: p95(frames, 'age'), handP95Ms: p95(frames, 'handMs'), poseP95Ms: p95(frames, 'poseMs'),
      workerCopyP95Ms: p95(frames, 'copyMs'), roundTripOutsideWorkerP95Ms: quantile(frames.map(frame => Math.max(0, frame.age - frame.cpu)), .95),
      captureToOverlayP50Ms: quantile(paints.map(paint => paint.age), .50), captureToOverlayP95Ms: p95(paints, 'age'),
      overlayDrawP95Ms: p95(paints, 'draw'), mainThreadLongTasks: longTasks, classifierPreparationP95Ms: p95(batches, 'prepareMs') };
  }
  const setOverlay = async value => {
    await host();
    await page.locator('#overlay-setting').setChecked(value);
    await close();
  };
  for (const value of (reverse ? [false, true] : [true, false])) {
    await setOverlay(value);
    await click('Ready');
    await track();
    await measure(value ? 'overlayOn' : 'overlayOff', 7000);
    await pause();
    await restart();
  }
  await setOverlay(false);
  const before = await mem();
  const soakCpu = await cpu();
  const heapSamples = [before];
  const soakStart = performance.now();
  for (let i = 0; i < cycles; i++) {
    await restart();
    await click('Ready');
    await track();
    await page.waitForTimeout(period);
    await pause();
    await page.evaluate(() => { window.workerProbe.frames.length = 0; window.workerProbe.batches.length = 0; });
    if ((i + 1) % 6 === 0) heapSamples.push(await mem());
  }
  const soak = { cycles, liveHoldSeconds: cycles * period / 1000,
    wallSeconds: Math.round((performance.now() - soakStart) / 10) / 100,
    chromeCpuSeconds: Math.round(((await cpu()).total - soakCpu.total) * 100) / 100,
    heapSamples: [...heapSamples, await mem()] };
  await restart();
  await click('Ready');
  await track();
  await page.evaluate(() => window.workerProbe.active.tracker.dispatchEvent(new ErrorEvent('error', { message: 'Simulated worker fault' })));
  await page.waitForFunction(() => window.workerProbe.creates.tracker === 2 && window.workerProbe.creates.classifier === 2);
  await track();
  await page.waitForFunction(() => Number(document.querySelector('#seconds').textContent) < 20);
  await pause();
  const state = await page.evaluate(() => ({ workers: window.workerProbe.creates, delegates: window.workerProbe.delegates, sound: window.soundStats }));
  assert.deepEqual(state.workers, { tracker: 2, classifier: 2 });
  if (party) assert.equal(state.delegates.at(-1), 'CPU');
  assert.ok(state.sound.starts > 0 && state.sound.starts === state.sound.stops && state.sound.ended === state.sound.starts);
  assert.deepEqual(errors, []);
  const result = { elapsedSeconds: Math.round((performance.now() - began) / 10) / 100,
    graphics, spin, phases, soak, recovery: 'one injected tracking worker fault, workers recreated and round resumed', ...state, pageErrors: errors };
  await mkdir('test-output', { recursive: true });
  await writeFile(process.env.GAMESHOW_BENCHMARK_REPORT ?? (reverse ? 'test-output/party-booth-reverse.json' : 'test-output/party-booth.json'),
    JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}

