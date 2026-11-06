// The CHANGELOG is read through the descriptor the script opens: a link at the name is refused by name and never read through,
// even when the link check (lstat) would report a plain file. The preload below makes lstat lie, so only the open itself can refuse.
// Skipped visibly where this volume cannot make a file link (Windows without symlink privilege); the POSIX leg is the red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'release-notes.mjs');
const BASE_ENV_KEYS = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT'];

function sandbox(t) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'rn-link-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 }));
  return base;
}

// A child environment built from named keys: the sandbox folder is HOME, TEMP and the git ceiling, so nothing reaches the real profile.
const sandboxEnv = (dir) => ({
  ...Object.fromEntries(BASE_ENV_KEYS.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])),
  HOME: dir, USERPROFILE: dir, TEMP: dir, TMP: dir, TMPDIR: dir, GIT_CEILING_DIRECTORIES: path.dirname(dir), GIT_CONFIG_NOSYSTEM: '1',
});

// A preload: fs.lstatSync reports CHANGELOG.md as a plain file whatever it is, so a check-then-open reads through a link.
function lyingLstat(dir) {
  const file = path.join(dir, 'lying-lstat.mjs');
  fs.writeFileSync(file, [
    "import fs from 'node:fs';",
    'const real = fs.lstatSync;',
    "fs.lstatSync = (p, o) => { const st = real(p, o); if (String(p) === 'CHANGELOG.md') {",
    "  return new Proxy(st, { get(t, k) { if (k === 'isSymbolicLink') return () => false; if (k === 'isFile') return () => true; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } });",
    '} return st; };',
    '',
  ].join('\n'));
  return pathToFileURL(file).href;
}

test('a CHANGELOG.md that is a link is refused by name and its target is never read, even when the link check says plain file', (t) => {
  const dir = sandbox(t);
  const outside = path.join(dir, 'outside.md');
  fs.writeFileSync(outside, '## [9.9.9] - 2026-01-01\n\nSecretOutsideText.\n');
  const work = path.join(dir, 'work');
  fs.mkdirSync(work);
  try { fs.symlinkSync(outside, path.join(work, 'CHANGELOG.md'), 'file'); } catch (e) { t.skip(`this volume cannot make a file link (${e.code})`); return; }
  const r = spawnSync(process.execPath, ['--import', lyingLstat(dir), SCRIPT, '--check', '--repo', 'CoalLedger'], { cwd: work, encoding: 'utf8', env: sandboxEnv(dir), timeout: 60000, killSignal: 'SIGKILL' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /CHANGELOG\.md is not a regular file/, r.stderr);
  assert.equal((r.stdout + r.stderr).includes('SecretOutsideText'), false, 'the link target was read');
  assert.equal((r.stdout + r.stderr).includes('9.9.9'), false, 'the link target was read');
});
