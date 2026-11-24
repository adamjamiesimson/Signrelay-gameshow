import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pinFile = resolve(root, 'asset-pins.json');
const pins = JSON.parse(await readFile(pinFile, 'utf8'));
for (const asset of pins) {
  const bytes = await readFile(resolve(root, 'public', asset.path));
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(asset.path + ' failed SHA-256 verification');
  console.log('Verified ' + asset.path);
}

