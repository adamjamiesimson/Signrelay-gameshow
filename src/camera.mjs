import { startWorkers } from './workers.mjs';
import { Confirmation, PROFILE, verificationInterval } from './verification.mjs';

export const MATCH_MAX_AGE_MS = 1200;

const links = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[17,0]];
const friendly = error => {
  if (error.name === 'NotAllowedError') return 'Camera permission is blocked. Allow it in the browser, then retry.';
  if (error.name === 'NotFoundError') return 'No camera found. Reconnect it, then retry.';
  if (error.name === 'NotReadableError') return 'The camera could not start. Close other camera apps, then retry.';
  if (error.name === 'OverconstrainedError') return 'The selected camera is unavailable. Choose another camera in Host controls.';
  return error.message || 'Camera unavailable.';
};

function cameraReady(video) {
  if (video.readyState >= 2 && video.videoWidth) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const listener = new AbortController();
    const timeout = setTimeout(() => {
      listener.abort();
      reject(new Error('Camera started without a video frame. Retry or choose another camera.'));
    }, 6500);
    video.addEventListener('loadeddata', () => {
      clearTimeout(timeout);
      listener.abort();
      resolve();
    }, { once: true, signal: listener.signal });
  });
}

export class Camera {
  constructor(video, overlay, notify, settings) {
    this.video = video;
    this.overlay = overlay;
    this.context = overlay.getContext('2d');
    this.overlaySize = { width: 0, height: 0 };
    this.overlayObserver = new ResizeObserver(([entry]) => { this.overlaySize = entry.contentRect; });
    this.overlayObserver.observe(overlay);
    this.notify = notify;
    this.settings = settings;
    this.history = [];
    this.signal = new Confirmation();
    this.generation = 0;
    this.model = 'Waiting';
    this.status = 'Camera off';
  }

  warm() {
    if (this.workers) return this.ready;
    this.model = 'Loading hand, pose and sign models…';
    this.notify('model', this.model);
    try {
      this.workers = startWorkers({ forceCpu: this.forceCpu });
      const current = this.workers;
      this.ready = current.ready.then(([tracker]) => {
        if (this.workers !== current) return;
        this.model = 'Ready';
        this.delegate = tracker.delegate;
        this.notify('model', 'Hand and pose ready on ' + tracker.delegate + ' · ASL model ready');
      }, error => {
        if (this.workers !== current) throw error;
        current.close();
        this.workers = null;
        if (!this.forceCpu) {
          this.forceCpu = true;
          this.notify('model', 'Retrying model startup with CPU tracking');
          return this.warm();
        }
        this.model = 'Error · ' + error.message;
        this.notify('model', this.model);
        throw error;
      });
      return this.ready;
    } catch (error) {
      this.model = 'Error · ' + error.message;
      this.notify('model', this.model);
      return Promise.reject(error);
    }
  }

  async open(device) {
    if (this.stream?.active && device === this.device) return true;
    this.stopCamera();
    const generation = this.generation;
    this.status = 'Waiting for camera permission…';
    this.notify('camera', this.status);
    let stream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Open GameShow on HTTPS or the local booth address to use the camera.');
      const constraints = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } };
      if (device) constraints.deviceId = { exact: device };
      stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
      if (generation !== this.generation) {
        for (const track of stream.getTracks()) track.stop();
        return false;
      }
      this.device = device;
      this.stream = stream;
      this.video.srcObject = stream;
      const track = stream.getVideoTracks()[0];
      track.addEventListener('ended', () => {
        if (this.stream === stream) this.fault('Camera disconnected.');
      }, { once: true });
      await Promise.all([this.video.play(), cameraReady(this.video)]);
      if (generation !== this.generation) return false;
      this.status = 'Camera on · ' + this.video.videoWidth + ' × ' + this.video.videoHeight;
      this.notify('camera', this.status);
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.stopCamera();
      this.status = friendly(error);
      this.notify('camera', this.status);
      throw new Error(this.status);
    }
  }

  resetSignal() {
    this.history = [];
    this.signal.reset();
    this.lastAnalysis = -Infinity;
  }

  play(run, word, threshold, deadline) {
    this.stopAnalysis();
    this.resetSignal();
    const attempt = { run, word, threshold, deadline, lastVideo: performance.now(), lastSample: -Infinity,
      lastRecognition: -Infinity, latest: -Infinity, mediaTime: -1, cadence: [] };
    this.attempt = attempt;
    this.videoFrame(attempt);
    this.watchdog = setInterval(() => {
      if (this.attempt !== attempt) return;
      if (this.stream?.getVideoTracks()[0]?.readyState !== 'live' || performance.now() - attempt.lastVideo > 3400) {
        this.fault('Camera stopped sending frames.');
      }
    }, 900);
  }

  setThreshold(threshold) {
    if (!this.attempt || this.attempt.threshold === threshold) return;
    this.attempt.threshold = threshold;
    this.signal.reset();
  }

  videoFrame(attempt) {
    this.frameHandle = this.video.requestVideoFrameCallback((now, frame) => {
      if (this.attempt !== attempt) return;
      this.videoFrame(attempt);
      if (frame.mediaTime === attempt.mediaTime) return;
      attempt.mediaTime = frame.mediaTime;
      attempt.lastVideo = now;
      if (now > attempt.deadline) return;
      attempt.latest = now;
      void this.capture(attempt);
    });
  }

  hasPendingMatch(run) {
    const attempt = this.attempt;
    return attempt?.run === run && (this.trackingAttempt === attempt || this.verifyingAttempt === attempt);
  }

  async capture(attempt) {
    if (this.frameBusy || !attempt || this.attempt !== attempt ||
        !Number.isFinite(attempt.latest) || attempt.latest - attempt.lastSample < 22 || performance.now() > attempt.deadline) return;
    const timestamp = attempt.latest;
    attempt.lastSample = timestamp;
    this.frameBusy = true;
    this.trackingAttempt = attempt;
    let bitmap;
    try {
      const started = performance.now();
      if (!this.forceBitmap && typeof VideoFrame === 'function') {
        try { bitmap = new VideoFrame(this.video, { timestamp: Math.round(timestamp * 1000) }); } catch {}
      }
      bitmap ??= await createImageBitmap(this.video);
      if (this.attempt !== attempt) { bitmap.close(); return; }
      const sent = performance.now();
      const data = await this.workers.tracker.request('frame', {
        bitmap, timestamp, compact: attempt.compact, overlay: this.settings().overlay, live: true, run: attempt.run,
      }, [bitmap], overlay => {
        if (this.attempt === attempt) this.paintOverlay(overlay.xy, overlay.timestamp);
      });
      if (this.attempt === attempt) this.analyze(attempt, data, sent - started, performance.now() - sent - data.ms);
    } catch (error) {
      bitmap?.close();
      if (this.attempt === attempt) this.fault(error.message, true);
    } finally {
      this.frameBusy = false;
      this.trackingAttempt = undefined;
      void this.capture(this.attempt);
    }
  }

  analyze(attempt, data, captureMs, transportMs) {
    this.notify('hands', { count: data.handCount, ms: data.ms, fps: attempt.fps, handMs: data.handMs,
      poseMs: data.poseMs, captureMs, transportMs, overlayMs: this.overlayLag });
    // A fast preview may deliver 30 fps. The verifier keeps the trained 15 Hz cadence.
    if (data.timestamp - attempt.lastRecognition < PROFILE.sampleMs - 8) return;
    attempt.lastRecognition = data.timestamp;
    attempt.cadence.push(data.timestamp);
    while (attempt.cadence[0] < data.timestamp - 2200) attempt.cadence.shift();
    const span = data.timestamp - attempt.cadence[0];
    const fps = span > 300 ? (attempt.cadence.length - 1) * 1000 / span : null;
    attempt.fps = fps === null ? null : Math.round(fps);
    attempt.sparse = fps !== null && fps < PROFILE.sparseFps;
    if (attempt.cadence.length >= 4 && fps !== null && fps < 7) attempt.compact = true;
    if (data.timestamp - (this.history.at(-1)?.t ?? data.timestamp) > PROFILE.sparseGap) this.resetSignal();
    this.history.push({ t: data.timestamp, f: data.observation });
    while (this.history[0]?.t < data.timestamp - PROFILE.historyMs) this.history.shift();
    this.verifyLatest(attempt);
  }

  verifyLatest(attempt) {
    const sample = this.history.at(-1);
    if (!attempt || !sample || this.verifying ||
        sample.t - this.lastAnalysis < verificationInterval(attempt.sparse)) return;
    this.lastAnalysis = sample.t;
    this.verifying = true;
    this.verifyingAttempt = attempt;
    const cutoff = attempt.threshold;
    this.workers.classifier.request('verify', { timestamp: sample.t, targets: [attempt.word],
      history: this.history, sparse: attempt.sparse, stopAbove: cutoff }).then(reply => {
      if (this.attempt !== attempt || performance.now() - reply.timestamp > MATCH_MAX_AGE_MS || cutoff !== attempt.threshold) return;
      const [evidence] = reply.values;
      this.notify('evidence', { ...evidence, ms: reply.ms, windows: reply.windowsRun });
      if (reply.empty) { this.signal.reset(); return; }
      if (this.signal.push(evidence.score, reply.timestamp, cutoff)) this.notify('match', { run: attempt.run, timestamp: reply.timestamp });
    }).catch(error => {
      if (this.attempt === attempt) this.fault(error.message, true);
    }).finally(() => {
      this.verifying = false;
      this.verifyingAttempt = undefined;
      this.verifyLatest(this.attempt);
    });
  }

  paintOverlay(hands, timestamp) {
    this.overlayHands = hands;
    this.overlayTimestamp = timestamp;
    if (this.overlayFrame !== undefined || (!hands.length && !this.overlayPainted)) return;
    this.overlayFrame = requestAnimationFrame(() => {
      this.overlayFrame = undefined;
      this.overlayLag = performance.now() - this.overlayTimestamp;
      this.draw(this.overlayHands);
    });
  }

  draw(hands) {
    const canvas = this.overlay;
    const context = this.context;
    const { width, height } = this.overlaySize;
    const deviceScale = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(width * deviceScale));
    const h = Math.max(1, Math.round(height * deviceScale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    context.clearRect(0, 0, w, h);
    this.overlayPainted = false;
    if (!this.settings().overlay || !this.video.videoWidth || !hands.length) return;
    const ratio = Math.min(w / this.video.videoWidth, h / this.video.videoHeight);
    const frameW = this.video.videoWidth * ratio;
    const frameH = this.video.videoHeight * ratio;
    const left = (w - frameW) / 2;
    const top = (h - frameH) / 2;
    context.strokeStyle = '#bcffc6';
    context.lineWidth = 2.2 * deviceScale;
    context.lineCap = 'round';
    context.fillStyle = '#e6ffe9';
    this.overlayPainted = true;
    context.beginPath();
    for (let offset = 0; offset < hands.length; offset += 42) {
      for (const [a, b] of links) {
        context.moveTo(left + (1 - hands[offset + a * 2]) * frameW, top + hands[offset + a * 2 + 1] * frameH);
        context.lineTo(left + (1 - hands[offset + b * 2]) * frameW, top + hands[offset + b * 2 + 1] * frameH);
      }
    }
    context.stroke();
    context.beginPath();
    const radius = 2.6 * deviceScale;
    for (let i = 0; i < hands.length; i += 2) {
      const x = left + (1 - hands[i]) * frameW;
      const y = top + hands[i + 1] * frameH;
      context.moveTo(x + radius, y);
      context.arc(x, y, radius, 0, 2 * Math.PI);
    }
    context.fill();
  }

  fault(message, workers = false) {
    this.stopCamera();
    this.status = message;
    if (workers) {
      this.forceCpu = true;
      this.forceBitmap = true;
      this.workers?.close();
      this.workers = null;
      this.model = 'Recovering';
    }
    this.notify('fault', { message, workers });
  }

  stopAnalysis() {
    this.attempt = null;
    clearInterval(this.watchdog);
    if (this.frameHandle !== undefined) this.video.cancelVideoFrameCallback?.(this.frameHandle);
    this.frameHandle = undefined;
    cancelAnimationFrame(this.overlayFrame);
    this.overlayFrame = undefined;
    this.overlayHands = [];
    this.overlayLag = undefined;
    if (this.overlayPainted) this.draw([]);
    this.resetSignal();
  }

  stopCamera() {
    this.generation++;
    this.stopAnalysis();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.status = 'Camera off';
  }
}

