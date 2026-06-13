#!/usr/bin/env node
// Package the extension into a Chrome Web Store-ready zip in dist/.
//
// Ships runtime files only — the manifest plus the JS/CSS/HTML the extension actually
// loads. Tests, fixtures, docs, package.json, and the store-listing images stay out.
// The version comes from --version (CI passes the git tag) and is stamped into the
// *packaged* manifest only; the committed manifest version is just a dev placeholder so
// the working tree stays clean. Usage:
//
//   node scripts/build.mjs [--version=X.Y.Z] [--skip-tests]
//
// Falls back to the committed manifest version when --version is omitted (local dev
// build). --skip-tests is for CI, which runs `npm test` as its own step for visibility.

import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const STAGE = join(DIST, 'package'); // staging copy; we zip its contents (manifest at root)

// Runtime allowlist — exactly what the loaded extension needs. content.js dynamically
// imports the rest of src/ as web-accessible ES modules, so the whole dir ships. Only
// the sized icon PNGs ship (named explicitly) — the icons/ source art (base*.png) and
// any other working files there never leak into the package.
const INCLUDE = ['manifest.json', 'options.html', 'options.js', 'src', 'styles',
  'icons/16.png', 'icons/32.png', 'icons/48.png', 'icons/128.png'];

function parseArgs(argv) {
  const args = { skipTests: false, version: null };
  for (const a of argv) {
    if (a === '--skip-tests') args.skipTests = true;
    else if (a.startsWith('--version=')) args.version = a.slice('--version='.length).replace(/^v/, '');
    else { console.error(`✗ unknown argument: ${a}`); process.exit(1); }
  }
  return args;
}

// Chrome extension version: 1–4 dot-separated integers, each 0–65535, no leading zeros.
function validVersion(v) {
  if (!/^\d+(\.\d+){0,3}$/.test(v)) return false;
  return v.split('.').every((p) => { const n = Number(p); return n >= 0 && n <= 65535 && String(n) === p; });
}

function countFiles(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(join(dir, e.name));
    else n += 1;
  }
  return n;
}

const args = parseArgs(process.argv.slice(2));

// 1. Resolve the version: --version wins (CI tag), else the committed manifest (dev build).
const manifestPath = join(ROOT, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const version = args.version || manifest.version;
if (!validVersion(version)) {
  console.error(`✗ invalid version "${version}" — expected 1–4 dot-separated 0–65535 integers (e.g. 1.2.3)`);
  process.exit(1);
}

// 2. Validate via the test suite unless skipped (CI runs it separately).
if (!args.skipTests) {
  console.log('• running tests…');
  execFileSync('node', ['--test'], { cwd: ROOT, stdio: 'inherit' });
}

// 3. Confirm every runtime path exists before we stage.
for (const entry of INCLUDE) {
  if (!existsSync(join(ROOT, entry))) { console.error(`✗ missing runtime file: ${entry}`); process.exit(1); }
}

// 4. Stage a clean copy, stamping the build version into the packaged manifest only.
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
for (const entry of INCLUDE) cpSync(join(ROOT, entry), join(STAGE, entry), { recursive: true });
writeFileSync(join(STAGE, 'manifest.json'), `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);

// 5. Zip the staging contents (manifest.json at the archive root) → dist/solring-vX.Y.Z.zip.
const zipName = `solring-v${version}.zip`;
const zipPath = join(DIST, zipName);
rmSync(zipPath, { force: true });
try {
  execFileSync('zip', ['-r', '-X', '-q', zipPath, '.', '-x', '*.DS_Store'], { cwd: STAGE });
} catch (err) {
  console.error('✗ failed to create the zip — is the `zip` CLI installed?', err.message);
  process.exit(1);
}

// 6. Clean up the staging dir; report.
const fileCount = countFiles(STAGE);
rmSync(STAGE, { recursive: true, force: true });
const size = statSync(zipPath).size;
console.log(`\n✓ packaged ${zipName}  ·  ${fileCount} files  ·  ${(size / 1024).toFixed(1)} KB  ·  v${version}`);
console.log(`  → ${zipPath}`);
