// The run list lives in a folder only its own user can write: coalledger-<uid> where the platform reports a uid, coalledger
// where it does not. A planted list at the old fixed name, a link at the folder or the file, a folder open to others or
// owned by someone else is refused, and each engine prints the list path alone under --list-path. Every child runs with its
// own temp folder, and a uid is stubbed by a preload where the owner branch needs one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SANDBOX_ENV } from '../test-sandbox.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const realUid = process.getuid?.();
const folderName = (uid) => (uid === undefined ? 'coalledger' : `coalledger-${uid}`);

function sandbox(t) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cl-folder-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 }));
  const tmp = path.join(base, 'tmp');
  fs.mkdirSync(tmp);
  return { base, tmp, env: { ...SANDBOX_ENV, TMP: tmp, TEMP: tmp, TMPDIR: tmp } };
}

// A preload that makes the engine see another uid, so the owner branch runs on every platform.
function stubUid(base, uid) {
  const file = path.join(base, `uid-${uid}.mjs`);
  fs.writeFileSync(file, `process.getuid = () => ${uid};\n`);
  return ['--import', pathToFileURL(file).href];
}

function run(engine, args, env, extra = []) {
  return spawnSync(process.execPath, [...extra, path.join(here, engine + '.mjs'), ...args], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', env, cwd: here });
}

function listPathLeg(engine, t) {
  const { tmp, env } = sandbox(t);
  const r = run(engine, ['--list-path'], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, path.join(tmp, folderName(realUid), 'run.json') + '\n');
}

test('a list planted at the old fixed name is not read once the list lives in the per-user folder', (t) => {
  const { base, tmp, env } = sandbox(t);
  const victim = path.join(base, 'victim');
  fs.mkdirSync(victim);
  const doc = path.join(victim, 'a.md');
  fs.writeFileSync(doc, '# A\n\n[broken](nope.md)\n');
  fs.mkdirSync(path.join(tmp, 'coalledger'));
  fs.writeFileSync(path.join(tmp, 'coalledger', 'run.json'), JSON.stringify({ root: victim, docs: [doc] }));
  const r = run('md-checks', ['--json', '--list'], env, stubUid(base, 4242));
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /no readable run list/);
  assert.equal(r.stdout.includes('nope.md'), false, r.stdout);
});

test('a link at the run list folder is refused by --list-path and by --list (skipped visibly where this volume cannot make a folder link)', (t) => {
  const { base, tmp, env } = sandbox(t);
  const attacker = path.join(base, 'attacker');
  fs.mkdirSync(attacker);
  const folder = path.join(tmp, folderName(realUid));
  try { fs.symlinkSync(attacker, folder, 'junction'); } catch (e) { t.skip(`this volume cannot make a folder link (${e.code})`); return; }
  const a = run('md-checks', ['--list-path'], env);
  assert.equal(a.status, 2, a.stdout + a.stderr);
  assert.match(a.stderr, /is a link/);
  const b = run('md-checks', ['--json', '--list'], env);
  assert.equal(b.status, 2, b.stdout + b.stderr);
  assert.match(b.stderr, /is a link/);
});

test('a run list folder open to group or other bits is refused (skipped visibly where the platform reports no uid)', { skip: realUid === undefined ? 'this platform reports no uid (Windows)' : false }, (t) => {
  const { tmp, env } = sandbox(t);
  const folder = path.join(tmp, folderName(realUid));
  fs.mkdirSync(folder);
  fs.chmodSync(folder, 0o755);
  const r = run('md-checks', ['--list-path'], env);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /open to others/);
});

test('a run list folder owned by another user is refused, judged by the uid the engine reports', (t) => {
  const { base, tmp, env } = sandbox(t);
  fs.mkdirSync(path.join(tmp, 'coalledger-4242'), { mode: 0o700 });
  const r = run('md-checks', ['--list-path'], env, stubUid(base, 4242));
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /another user/);
});

test('a link at the run list file is refused, never followed (skipped visibly where this volume cannot make a file link)', (t) => {
  const { base, env } = sandbox(t);
  const first = run('md-checks', ['--list-path'], env);
  assert.equal(first.status, 0, first.stderr);
  const listFile = first.stdout.trimEnd();
  const victim = path.join(base, 'victim.json');
  fs.writeFileSync(victim, JSON.stringify({ root: base, docs: [] }));
  try { fs.symlinkSync(victim, listFile, 'file'); } catch (e) { t.skip(`this volume cannot make a file link (${e.code})`); return; }
  const r = run('md-checks', ['--json', '--list'], env);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /is a link/);
});

test('md-checks --list-path prints the run list path alone on stdout and exits 0', (t) => listPathLeg('md-checks', t));
test('emdash --list-path prints the run list path alone on stdout and exits 0', (t) => listPathLeg('emdash', t));
test('lang-mechanics --list-path prints the run list path alone on stdout and exits 0', (t) => listPathLeg('lang-mechanics', t));
test('translation-pairs --list-path prints the run list path alone on stdout and exits 0', (t) => listPathLeg('translation-pairs', t));
test('repo-standard --list-path prints the run list path alone on stdout and exits 0', (t) => listPathLeg('repo-standard', t));
