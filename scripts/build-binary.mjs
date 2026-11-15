#!/usr/bin/env node
/**
 * Builds a Node.js Single Executable Application (SEA) for the current platform.
 * Steps:
 *   1. Bundle bin/betty.js with ncc → dist/bundle.js
 *   2. Write sea-config.json
 *   3. Generate SEA blob (sea-prep.blob)
 *   4. Copy node binary to dist/betty[.exe]
 *   5. Inject blob with postject
 */

import { execFileSync, execSync } from 'child_process';
import { createRequire } from 'module';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const dist = join(root, 'dist');
const bundlePath = join(dist, 'bundle.js');
const blobPath = join(dist, 'sea-prep.blob');
const seaConfig = join(dist, 'sea-config.json');

const isWin = process.platform === 'win32';
const binaryName = isWin ? 'betty.exe' : 'betty';
const binaryOut = join(dist, binaryName);
const targetNodeBinary = process.env.BETTY_SEA_NODE_BINARY || process.execPath;

const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: root });
// Commands with paths run without a shell, so no checkout path (spaces, $, %)
// can break or alter them.
const runFile = (file, args) => execFileSync(file, args, { stdio: 'inherit', cwd: root });
const postjectCli = createRequire(import.meta.url).resolve('postject/dist/cli.js');

// 1. Clean dist
if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 2. TypeScript build
console.log('\n[1/5] Building TypeScript…');
run('npm run build');

// 3. Bundle with ncc
console.log('\n[2/5] Bundling with ncc…');
run(`npx ncc build bin/betty.js -o dist/ncc --no-source-map-register`);

// ncc outputs to dist/ncc/index.js
const nccBundle = join(dist, 'ncc', 'index.js');
copyFileSync(nccBundle, bundlePath);

// 4. Write SEA config
console.log('\n[3/5] Writing SEA config…');
writeFileSync(seaConfig, JSON.stringify({
  main: bundlePath,
  output: blobPath,
  disableExperimentalSEAWarning: true,
}, null, 2));

// 5. Generate blob
console.log('\n[4/5] Generating SEA blob…');
runFile(process.execPath, ['--experimental-sea-config', seaConfig]);

// 6. Copy node binary + inject
console.log('\n[5/5] Creating binary…');
copyFileSync(targetNodeBinary, binaryOut);

// On macOS, remove code signature before injection
if (process.platform === 'darwin') {
  try { runFile('codesign', ['--remove-signature', binaryOut]); } catch { /* ignore if no signature */ }
}

runFile(process.execPath, [
  postjectCli, binaryOut, 'NODE_SEA_BLOB', blobPath,
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : []),
]);

console.log(`\nDone! Binary: dist/${binaryName}`);
