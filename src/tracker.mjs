import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { gatherFrame } from './upstream-preprocess.mjs';

let hand, pose, canvas, context, prevPose, run, sequence = 0, lastTimestamp = 0;
const asset = path => new URL(path, self.location.href).href;

async function verified(path, expected) {
  const response = await fetch(asset(path));
  if (!response.ok) throw new Error('Missing ' + path + ' (' + response.status + ')');
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (sha !== expected) throw new Error('Fingerprint mismatch for ' + path);
  return new Uint8Array(bytes);
}
function hardwareWebGL() {
  const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
  if (!gl) return false;
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return !!renderer && !/swiftshader|software|llvmpipe|basic render/i.test(renderer);
}

async function initialize(forceCpu) {
  const [files, handTask, poseTask] = await Promise.all([
    FilesetResolver.forVisionTasks(asset('vision')),
    verified('vision/hand_landmarker.task', 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1'),
    verified('vision/pose_landmarker_lite.task', '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a'),
  ]);
  const warmup = new OffscreenCanvas(320, 240);
  const warmupContext = warmup.getContext('2d');
  warmupContext.fillStyle = '#444';
  warmupContext.fillRect(0, 0, warmup.width, warmup.height);
  let gpu = false;
  try { gpu = !forceCpu && hardwareWebGL(); } catch { /* CPU remains available. */ }
  for (const delegate of gpu ? ['GPU', 'CPU'] : ['CPU']) {
    const options = modelAssetBuffer => ({ baseOptions: { modelAssetBuffer, delegate }, runningMode: 'VIDEO' });
    try {
      hand = await HandLandmarker.createFromOptions(files, { ...options(handTask), numHands: 2 });
      pose = await PoseLandmarker.createFromOptions(files, { ...options(poseTask), numPoses: 1 });
      hand.detectForVideo(warmup, 1);
      pose.detectForVideo(warmup, 1);
      lastTimestamp = 1;
      return delegate;
    } catch (error) {
      if (delegate === 'CPU') throw error;
      try { hand?.close(); } catch {}
      try { pose?.close(); } catch {}
      hand = pose = null;
    }
  }
}

function track({ bitmap, timestamp, id, compact, overlay = true, live = false, run: frameRun }) {
  const began = performance.now();
  const inputWidth = bitmap.width ?? bitmap.displayWidth;
  const inputHeight = bitmap.height ?? bitmap.displayHeight;
  const long = Math.max(inputWidth, inputHeight);
  const ratio = Math.min(1, (compact ? 352 : 960) / long);
  const width = Math.round(inputWidth * ratio);
  const height = Math.round(inputHeight * ratio);
  if (run !== frameRun) {
    run = frameRun;
    prevPose = null;
    sequence = 0;
  }
  try {
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas = new OffscreenCanvas(width, height);
      context = canvas.getContext('2d');
      prevPose = null;
    }
    context.drawImage(bitmap, 0, 0, width, height);
  } finally {
    bitmap.close();
  }
  lastTimestamp = Math.max(lastTimestamp + 1, timestamp);
  const handStarted = performance.now();
  const detected = hand.detectForVideo(canvas, lastTimestamp);
  const afterHand = performance.now();
  if (live && overlay) {
    const xy = new Float32Array(detected.landmarks.length * 42);
    detected.landmarks.forEach((landmarks, index) => landmarks.forEach((point, p) => {
      xy[index * 42 + p * 2] = point.x;
      xy[index * 42 + p * 2 + 1] = point.y;
    }));
    self.postMessage({ type: 'overlay', id, timestamp, xy }, [xy.buffer]);
  }
  const poseStarted = performance.now();
  const updatePose = !prevPose || sequence++ % (compact ? 3 : 2) === 0;
  if (updatePose) prevPose = pose.detectForVideo(canvas, lastTimestamp);
  const afterPose = performance.now();
  const observation = gatherFrame(detected, prevPose, null, width, height);
  self.postMessage({ type: 'frame', id, timestamp, observation, handCount: detected.landmarks.length,
    hands: overlay && !live ? detected.landmarks : [], width, height,
    copyMs: handStarted - began, handMs: afterHand - handStarted, poseMs: updatePose ? afterPose - poseStarted : null,
    ms: Math.round(performance.now() - began) }, [observation.buffer]);
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const delegate = await initialize(data.forceCpu);
      self.postMessage({ type: 'ready', delegate });
    } else if (data.type === 'frame') {
      track(data);
    }
  } catch (error) {
    self.postMessage({ type: 'error', detail: error.message || String(error) });
  }
};

