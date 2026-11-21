// 29mo (T-70): a config or a backup the user made read-only (no write bit) is refused BY NAME, before anything is written, and is
// never replaced. The test asserts on the MODE, never on EACCES (root ignores the bit on POSIX; the mode check does not). On Windows
// the read-only attribute reads back as mode 0o444, so the same one check covers both platforms. Spawns the REAL configure.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(repo, 'scripts', 'configure.mjs');
const TMP_PREFIX = 'configure-readonly-';
const REAL_TMP = fs.realpathSync.native(os.tmpdir());
const GOOD = '{ "language": "fr", "severityFloor": "high", "updateMode": "ask" }\n';
const OLD = '{ "language": "de" }\n';
const MALFORMED = '{ "language": "fr", \n';
const READ_ONLY = 0o444;

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
  fs.mkdirSync(home, { recursive: true });
  return {
    root, proj, home,
    project: path.join(proj, '.claude', 'coal', 'coalledger.json'),
    legacy: path.join(proj, '.coalledger.json'),
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

function runConfigure(sb) {
  const env = { ...process.env, HOME: sb.home, USERPROFILE: sb.home, NODE_OPTIONS: '--max-old-space-size=2048' };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') || k.startsWith('CLAUDE_')) delete env[k];
  return spawnSync(process.execPath, [CLI, '--updateMode', 'off'], { cwd: sb.proj, env, encoding: 'utf8', timeout: 60000 });
}

function modeOf(file) {
  return fs.statSync(file).mode & 0o777;
}

// The refusal: exit 1, the exact FAIL line for the named file, and nothing written (the caller checks the bytes and the folder).
function assertRefusedByName(r, file) {
  assert.equal(r.error, undefined, `the child did not run: ${r.error && r.error.message}`);
  assert.equal(r.status, 1, `expected a refusal (exit 1), got ${r.status}:\n${r.stdout}\n${r.stderr}`);
  const want = `FAIL ${file}: read-only; nothing was written -- make the file writable if you mean to change it`;
  const lines = `${r.stdout}\n${r.stderr}`.split(/\r?\n/);
  assert.ok(lines.includes(want), `no exact refusal line for ${file}:\n${lines.join('\n')}`);
}

function noTempLeft(dir) {
  assert.equal(fs.readdirSync(dir).some((n) => n.includes('coalledger-tmp')), false, `a temp file was left in ${dir}`);
}

test('T-70 a read-only config is refused by name, is not replaced, and keeps its mode', (t) => {
  const sb = sandbox(t);
  fs.writeFileSync(sb.project, GOOD);
  fs.chmodSync(sb.project, READ_ONLY);
  const r = runConfigure(sb);
  assertRefusedByName(r, sb.project);
  assert.equal(fs.readFileSync(sb.project, 'utf8'), GOOD, 'the read-only config was replaced');
  assert.equal(modeOf(sb.project), READ_ONLY, 'the read-only config lost its mode');
  noTempLeft(path.dirname(sb.project));
});

test('T-70 a read-only malformed backup is refused before the malformed config is touched (nothing is written)', (t) => {
  const sb = sandbox(t);
  fs.writeFileSync(sb.project, MALFORMED);
  const bak = `${sb.project}.bak`;
  fs.writeFileSync(bak, OLD);
  fs.chmodSync(bak, READ_ONLY);
  const r = runConfigure(sb);
  assertRefusedByName(r, bak);
  assert.equal(fs.readFileSync(sb.project, 'utf8'), MALFORMED, 'the malformed config was written before the backup refusal');
  assert.equal(fs.readFileSync(bak, 'utf8'), OLD, 'the read-only backup was replaced');
  assert.equal(modeOf(bak), READ_ONLY, 'the read-only backup lost its mode');
  noTempLeft(path.dirname(sb.project));
});

test('T-70 a read-only migration backup is refused before the new home is written (nothing is written)', (t) => {
  const sb = sandbox(t);
  fs.writeFileSync(sb.legacy, GOOD);
  const bak = `${sb.legacy}.bak`;
  fs.writeFileSync(bak, OLD);
  fs.chmodSync(bak, READ_ONLY);
  const r = runConfigure(sb);
  assertRefusedByName(r, bak);
  assert.equal(fs.existsSync(sb.project), false, 'the new home was written before the migration backup refusal');
  assert.equal(fs.readFileSync(sb.legacy, 'utf8'), GOOD, 'the legacy file was moved although its backup was refused');
  assert.equal(fs.readFileSync(bak, 'utf8'), OLD, 'the read-only migration backup was replaced');
  assert.equal(modeOf(bak), READ_ONLY, 'the read-only migration backup lost its mode');
});
