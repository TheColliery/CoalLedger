// 29mo (T-69): scripts/configure.mjs reads the config it is about to rewrite. Only ENOENT means "there is no config yet". Any
// other read failure (a denied read, a directory at the path, an over-bound file) is a refusal: the run names the file and the
// code, writes NOTHING (no new home, no .bak, no temp) and exits 1. These legs spawn the REAL configure.mjs in a sandboxed
// project. A leg whose read denial does not bind on this account skips VISIBLY, never passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(repo, 'scripts', 'configure.mjs');
const TMP_PREFIX = 'configure-reader-';
const REAL_TMP = fs.realpathSync.native(os.tmpdir());
const GOOD = '{ "language": "fr", "severityFloor": "high", "updateMode": "ask" }\n';
const IS_WIN = process.platform === 'win32';
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
const USER = os.userInfo().username;

// Every file this test makes sits under one folder it made, asserted to resolve directly under the OS temp root.
function sandbox(t) {
  const root = fs.mkdtempSync(path.join(REAL_TMP, TMP_PREFIX));
  t.after(() => {
    const real = fs.realpathSync.native(root);
    if (path.dirname(real) === REAL_TMP && path.basename(real).startsWith(TMP_PREFIX)) {
      clearReadOnly(real);
      fs.rmSync(real, { recursive: true, force: true });
    }
  });
  const proj = path.join(root, 'proj');
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  fs.mkdirSync(path.join(proj, '.claude', 'coal'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  return {
    root, proj, home,
    project: path.join(proj, '.claude', 'coal', 'coalledger.json'),
    legacy: path.join(proj, '.coalledger.json'),
    global: path.join(home, '.claude', '.coalledger.json'),
  };
}

// A read-only file cannot be removed on Windows, so the teardown makes every entry writable first.
function clearReadOnly(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.lstatSync(p);
    if (st.isDirectory()) clearReadOnly(p);
    else if (!st.isSymbolicLink()) fs.chmodSync(p, 0o666);
  }
}

// Runs the real CLI in the sandboxed project. The child env drops every GIT_* and CLAUDE_* key, and HOME/USERPROFILE point at the sandbox home.
function runConfigure(sb, extra = []) {
  const env = { ...process.env, HOME: sb.home, USERPROFILE: sb.home, NODE_OPTIONS: '--max-old-space-size=2048' };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') || k.startsWith('CLAUDE_')) delete env[k];
  return spawnSync(process.execPath, [CLI, ...extra, '--updateMode', 'off'], { cwd: sb.proj, env, encoding: 'utf8', timeout: 60000 });
}

// True when a read of the file fails right now (the denial binds for this account).
function readFails(file) {
  try { fs.readFileSync(file); return false; } catch { return true; }
}

// Denies the read of one file to this account. Returns an undo function, or null when the denial does not bind here (the caller skips visibly).
function denyRead(file) {
  if (IS_WIN) {
    const r = spawnSync('icacls', [file, '/deny', `${USER}:(RD)`], { encoding: 'utf8', timeout: 20000 });
    const undo = () => spawnSync('icacls', [file, '/remove:d', USER], { encoding: 'utf8', timeout: 20000 });
    if (r.status !== 0) return null;
    if (!readFails(file)) { undo(); return null; }
    return undo;
  }
  if (IS_ROOT) return null; // root reads through a 000 mode, so the denial cannot be shown as a refusal
  fs.chmodSync(file, 0o000);
  const undo = () => fs.chmodSync(file, 0o644);
  if (!readFails(file)) { undo(); return null; }
  return undo;
}

// The refusal: exit 1, one FAIL line naming the file and a code, and the words that say nothing was written.
function assertRefused(r, file, codePattern = /could not be read \((E[A-Z]+)\)/) {
  assert.equal(r.error, undefined, `the child did not run: ${r.error && r.error.message}`);
  assert.equal(r.status, 1, `expected a refusal (exit 1), got ${r.status}:\n${r.stdout}\n${r.stderr}`);
  const lines = `${r.stdout}\n${r.stderr}`.split(/\r?\n/);
  const line = lines.find((l) => l.startsWith(`FAIL ${file}: `));
  assert.ok(line, `no FAIL line names ${file}:\n${lines.join('\n')}`);
  assert.match(line, codePattern, `the FAIL line does not carry the read code: ${line}`);
  assert.ok(line.endsWith('nothing was written'), `the FAIL line does not say nothing was written: ${line}`);
}

function noTempLeft(dir) {
  if (!fs.existsSync(dir)) return;
  assert.equal(fs.readdirSync(dir).some((n) => n.includes('coalledger-tmp')), false, `a temp file was left in ${dir}`);
}

test('T-69 project: a config that exists but cannot be read is refused (exit 1), and is not replaced', (t) => {
  const sb = sandbox(t);
  fs.writeFileSync(sb.project, GOOD);
  const undo = denyRead(sb.project);
  if (!undo) { t.skip('the read denial does not bind on this account (icacls or mode 000): this leg is not reproduced here'); return; }
  let r;
  try { r = runConfigure(sb); } finally { undo(); }
  assertRefused(r, sb.project);
  assert.equal(fs.readFileSync(sb.project, 'utf8'), GOOD, 'the unreadable project config was replaced');
  noTempLeft(path.dirname(sb.project));
});

test('T-69 global: an unreadable global config is refused with --global, and is not replaced', (t) => {
  const sb = sandbox(t);
  fs.writeFileSync(sb.global, GOOD);
  const undo = denyRead(sb.global);
  if (!undo) { t.skip('the read denial does not bind on this account (icacls or mode 000): this leg is not reproduced here'); return; }
  let r;
  try { r = runConfigure(sb, ['--global']); } finally { undo(); }
  assertRefused(r, sb.global);
  assert.equal(fs.readFileSync(sb.global, 'utf8'), GOOD, 'the unreadable global config was replaced');
});

test('T-69 legacy: an unreadable legacy config is refused, and the new home is not written (nothing is written)', (t) => {
  const sb = sandbox(t);
  fs.writeFileSync(sb.legacy, GOOD);
  const undo = denyRead(sb.legacy);
  if (!undo) { t.skip('the read denial does not bind on this account (icacls or mode 000): this leg is not reproduced here'); return; }
  let r;
  try { r = runConfigure(sb); } finally { undo(); }
  assertRefused(r, sb.legacy);
  assert.equal(fs.existsSync(sb.project), false, 'the new home was written although the legacy file could not be read');
  assert.equal(fs.existsSync(`${sb.legacy}.bak`), false, 'a .bak was written although the legacy file could not be read');
  assert.equal(fs.readFileSync(sb.legacy, 'utf8'), GOOD, 'the unreadable legacy file was changed');
});

test('T-69 a directory at the global config path is refused (EISDIR), and the directory is left as it is', (t) => {
  const sb = sandbox(t);
  fs.mkdirSync(sb.global);
  const r = runConfigure(sb, ['--global']);
  assertRefused(r, sb.global, /could not be read \((EISDIR)\)/);
  assert.ok(fs.statSync(sb.global).isDirectory(), 'the directory at the config path was replaced');
});

test('T-69 an absent config is still created: only ENOENT means there is no config yet', (t) => {
  const sb = sandbox(t);
  const r = runConfigure(sb);
  assert.equal(r.status, 0, `an absent config must still be created, got exit ${r.status}:\n${r.stdout}\n${r.stderr}`);
  assert.ok(fs.existsSync(sb.project), 'the new config was not written');
});
