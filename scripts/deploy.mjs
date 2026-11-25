import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { releaseFiles, verifyHosting } from './verify-hosting.mjs';

const [project, site, mode, ...extra] = process.argv.slice(2);
const target = 'gameshow';
const allowed = 'signrelay-gameshow';
if (project !== allowed || site !== allowed || extra.length || (mode && mode !== '--verify-only')) {
  throw new Error('Use exactly: node scripts/deploy.mjs signrelay-gameshow signrelay-gameshow [--verify-only]');
}
const config = JSON.parse(await readFile('firebase.json', 'utf8'));
if (config.hosting.target !== target || config.hosting.public !== 'dist' || config.hosting.rewrites?.length || config.hosting.redirects?.length) {
  throw new Error('GameShow Hosting requires the gameshow target, dist, and direct static asset routes.');
}
const release = await releaseFiles();
if (mode !== '--verify-only') {
  const mapping = JSON.parse(await readFile('.firebaserc', 'utf8'));
  const targets = mapping.targets?.[project]?.hosting?.[target];
  if (targets?.length !== 1 || targets[0] !== site) throw new Error('Map target gameshow only to signrelay-gameshow in the signrelay-gameshow project.');
  const run = args => {
    const cachedCli = process.env.GAMESHOW_FIREBASE_CLI;
    const windows = process.platform === 'win32';
    const command = cachedCli ? process.execPath : windows ? 'firebase.cmd' : 'firebase';
    const result = spawnSync(command, cachedCli ? [cachedCli, ...args] : args,
      { stdio: 'inherit', shell: !cachedCli && windows });
    if (result.status !== 0) throw new Error('Firebase CLI check failed: ' + args[0], { cause: result.error });
  };
  run(['hosting:sites:get', site, '--project', project, '--non-interactive']);
  run(['deploy', '--only', 'hosting:' + target, '--project', project, '--non-interactive']);
}
await verifyHosting('https://' + allowed + '.web.app/', release);
