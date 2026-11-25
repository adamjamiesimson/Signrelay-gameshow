import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';

const types = new Map([
  ['html', /^text\/html$/], ['json', /^application\/json$/], ['css', /^text\/css$/],
  ['mjs', /^(text|application)\/javascript$/], ['js', /^(text|application)\/javascript$/],
  ['wasm', /^application\/wasm$/], ['task', /^application\/octet-stream$/],
  ['onnx', /^application\/octet-stream$/], ['mp4', /^video\/mp4$/],
]);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function releaseFiles() {
  const manifest = JSON.parse(await readFile('dist/runtime.json', 'utf8'));
  const worker = await readFile('dist/sw.js');
  if (manifest.assets.filter(asset => /^lessons\/.+\.mp4$/.test(asset.path)).length !== 10 ||
      !['model/model.onnx', 'model/meta.json', 'vision/hand_landmarker.task', 'vision/pose_landmarker_lite.task']
        .every(path => manifest.assets.some(asset => asset.path === path)) ||
      !worker.toString('utf8').startsWith('const RELEASE = ' + JSON.stringify(manifest) + ';')) {
    throw new Error('Build the complete GameShow release before publishing.');
  }
  for (const asset of manifest.assets) {
    const bytes = await readFile('dist/' + asset.path);
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) throw new Error('Local build fingerprint mismatch for ' + asset.path);
  }
  return { manifest, worker };
}

export async function verifyHosting(base, { manifest, worker }, { request = fetch, delays = [0, 2000, 4000, 6000, 8000, 12000, 16000, 20000], report = console.log } = {}) {
  const files = [...manifest.assets, { path: 'sw.js', bytes: worker.length, sha256: sha256(worker) },
    { ...manifest.assets.find(asset => asset.path === 'index.html'), path: '' }];
  async function get(path, extension, attempt) {
    const url = new URL(path, base);
    url.searchParams.set('release', manifest.version + '-' + attempt + '-' + Date.now());
    const response = await request(url, { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const header = response.headers.get('content-type') ?? '';
    const type = header.split(';')[0].trim().toLowerCase();
    const expected = types.get(extension);
    if (response.status !== 200 || (expected && !expected.test(type)) || type === 'text/html' && extension !== 'html') {
      await response.body?.cancel();
      const redirect = response.headers.get('location');
      throw new Error(`${url.pathname} returned HTTP ${response.status}, ${header || 'no Content-Type'}${redirect ? ', redirect to ' + redirect : ''}`);
    }
    return response;
  }
  let lastError;
  for (const [index, delay] of delays.entries()) {
    await wait(delay);
    try {
      const response = await get('runtime.json', 'json', index);
      let online;
      try { online = await response.json(); } catch { throw new Error('/runtime.json could not be parsed as JSON'); }
      if (JSON.stringify(online) !== JSON.stringify(manifest)) {
        throw new Error(`/runtime.json version ${String(online?.version ?? 'missing').slice(0, 40)} does not match ${manifest.version} and its asset list`);
      }
      for (let i = 0; i < files.length; i += 4) {
        const checks = await Promise.allSettled(files.slice(i, i + 4).map(async file => {
          const response = await get(file.path, file.path.split('.').at(-1) || 'html', index);
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error('/' + file.path + ' fingerprint differs from the local release');
          if (file.path === '' && (!response.headers.has('content-security-policy') ||
              !response.headers.get('permissions-policy')?.includes('camera=(self)'))) throw new Error('/ is missing the GameShow hosting security headers');
          if (file.path === 'sw.js' && !/\b(no-cache|no-store|max-age=0)\b/.test(response.headers.get('cache-control') ?? '')) {
            throw new Error('/sw.js does not require cache revalidation');
          }
        }));
        const failure = checks.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
      }
      report(`Verified ${base} · ${manifest.version} · ${manifest.assets.length} assets, service worker and HTML`);
      return;
    } catch (error) {
      lastError = error;
      report(`Hosting verification ${index + 1}/${delays.length}: ${error.message}${error.cause?.code ? ' (' + error.cause.code + ')' : ''}`);
    }
  }
  throw new Error(`Could not verify ${base} after ${delays.length} checks. Inspect the active Firebase Hosting release.`, { cause: lastError });
}
