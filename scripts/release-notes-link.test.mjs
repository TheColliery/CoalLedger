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

// A preload: every lstat of CHANGELOG.md reports a link. The canon makes one lstat of the name, AFTER the open (no check before it), so the
// post-open comparison is the check that refuses it: a name that is a link once it is read is refused with the link message, never read.
function linkLstat(dir) {
  const file = path.join(dir, 'link-lstat.mjs');
  fs.writeFileSync(file, [
    "import fs from 'node:fs';",
    'const real = fs.lstatSync;',
    "fs.lstatSync = (p, o) => { const st = real(p, o); if (String(p) !== 'CHANGELOG.md') return st;",
    "  return new Proxy(st, { get(t, k) { if (k === 'isSymbolicLink') return () => true; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } });",
    '};',
    '',
  ].join('\n'));
  return pathToFileURL(file).href;
}

// The fallback branch (no O_NOFOLLOW): a name that reads as a link after the open is refused with the link message, never read.
test('a CHANGELOG.md that reads as a link after the open is refused with the link message, never read (runs only where no-follow is absent)', { skip: fs.constants.O_NOFOLLOW !== undefined ? 'this platform refuses a link at the open itself (O_NOFOLLOW)' : false }, (t) => {
  const dir = sandbox(t);
  const work = path.join(dir, 'work');
  fs.mkdirSync(work);
  fs.writeFileSync(path.join(work, 'CHANGELOG.md'), '## [9.9.9] - 2026-01-01\n\nSecretOutsideText.\n');
  const r = spawnSync(process.execPath, ['--import', linkLstat(dir), SCRIPT, '--check', '--repo', 'CoalLedger'], { cwd: work, encoding: 'utf8', env: sandboxEnv(dir), timeout: 60000, killSignal: 'SIGKILL' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /CHANGELOG\.md is not a regular file/, r.stderr);
  assert.equal((r.stdout + r.stderr).includes('SecretOutsideText'), false, 'the link target was read');
});

// A preload: fs.lstatSync reports CHANGELOG.md as the decoy file, so the name looks like a file other than the one the open reaches.
function swapLstat(dir) {
  const file = path.join(dir, 'swap-lstat.mjs');
  fs.writeFileSync(file, [
    "import fs from 'node:fs';",
    'const real = fs.lstatSync;',
    `const decoy = ${JSON.stringify(path.join(dir, 'decoy.md'))};`,
    "fs.lstatSync = (p, o) => real(String(p) === 'CHANGELOG.md' ? decoy : p, o);",
    '',
  ].join('\n'));
  return pathToFileURL(file).href;
}

// The fallback branch (no O_NOFOLLOW: Windows) compares the open descriptor with a fresh lstat of the name. The constant decides
// which branch runs here, so the probe is the constant, not the platform name. Runs on this box, where the branch is the one in use.
test('a CHANGELOG.md whose name is swapped for another file after the check is refused, never read (runs only where no-follow is absent)', { skip: fs.constants.O_NOFOLLOW !== undefined ? 'this platform refuses a link at the open itself (O_NOFOLLOW), so the lstat fallback never runs' : false }, (t) => {
  const dir = sandbox(t);
  const work = path.join(dir, 'work');
  fs.mkdirSync(work);
  fs.writeFileSync(path.join(work, 'CHANGELOG.md'), '## [9.9.9] - 2026-01-01\n\nSecretOutsideText.\n');
  fs.writeFileSync(path.join(dir, 'decoy.md'), 'decoy\n');
  const r = spawnSync(process.execPath, ['--import', swapLstat(dir), SCRIPT, '--check', '--repo', 'CoalLedger'], { cwd: work, encoding: 'utf8', env: sandboxEnv(dir), timeout: 60000, killSignal: 'SIGKILL' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /CHANGELOG\.md changed between the check and the read/, r.stderr);
  assert.equal((r.stdout + r.stderr).includes('SecretOutsideText'), false, 'the swapped file was read');
  assert.equal((r.stdout + r.stderr).includes('9.9.9'), false, 'the swapped file was read');
});

test('a plain CHANGELOG.md is read on the fallback branch too: the descriptor and the name agree, so the check passes', (t) => {
  const dir = sandbox(t);
  const work = path.join(dir, 'work');
  fs.mkdirSync(work);
  fs.writeFileSync(path.join(work, 'CHANGELOG.md'), '## [1.2.0] - 2026-09-22\n\nA proof.\n\n### Added\n- x\n');
  const r = spawnSync(process.execPath, [SCRIPT, '--check', '--repo', 'CoalLedger'], { cwd: work, encoding: 'utf8', env: sandboxEnv(dir), timeout: 60000, killSignal: 'SIGKILL' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('a CHANGELOG.md that is a link is refused by name and its target is never read, even when the link check says plain file', (t) => {
  const dir = sandbox(t);
  const outside = path.join(dir, 'outside.md');
  fs.writeFileSync(outside, '## [9.9.9] - 2026-01-01\n\nSecretOutsideText.\n');
  const work = path.join(dir, 'work');
  fs.mkdirSync(work);
  try { fs.symlinkSync(outside, path.join(work, 'CHANGELOG.md'), 'file'); } catch (e) { t.skip(`this volume cannot make a file link (${e.code})`); return; }
  // No preload: the link is real, so the lstat in front of the open (Windows) or the open itself (POSIX) refuses it. The same
  // link message comes out on every platform.
  const r = spawnSync(process.execPath, [SCRIPT, '--check', '--repo', 'CoalLedger'], { cwd: work, encoding: 'utf8', env: sandboxEnv(dir), timeout: 60000, killSignal: 'SIGKILL' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /CHANGELOG\.md is not a regular file/, r.stderr);
  assert.equal((r.stdout + r.stderr).includes('SecretOutsideText'), false, 'the link target was read');
  assert.equal((r.stdout + r.stderr).includes('9.9.9'), false, 'the link target was read');
});
