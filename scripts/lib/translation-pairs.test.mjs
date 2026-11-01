// T-20 witness: doc-consistency's mechanical layer for DECLARED translation pairs. Each fixture is a real git repository
// with fixed committer dates, because the engine dates files from git's record and never from mtime. The CLI runs
// through SANDBOX_ENV (T-19). The config key's case rule is pinned here too: clampedRead must keep a path's case.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { clampedRead } from './config-schema.mjs';
import { gitEnv } from './git-env.mjs';
import { SANDBOX_ENV } from '../test-sandbox.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, 'translation-pairs.mjs');
const TMP = fs.realpathSync.native(os.tmpdir());
const T_OLD = '2026-01-01T00:00:00Z';
const T_NEW = '2026-02-01T00:00:00Z';

function fixture(t) {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(TMP, 'cl-tpairs-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }));
  return d;
}

// A repository with its own .git, asserted before any git command runs against it.
function repo(t) {
  const d = fixture(t);
  execFileSync('git', ['init', '-q', d], { env: gitEnv(path.dirname(d)), stdio: 'ignore' });
  assert.ok(fs.existsSync(path.join(d, '.git')), 'the fixture repository has its own .git');
  return d;
}

// One commit at `iso`; `files` is written before it. The author date is set with --date. Git reads the COMMITTER date
// only from GIT_COMMITTER_DATE, which the env policy does not let a fixture set, so a rebase copies the author date
// across: the record the engine reads (%cI) then carries the fixed date.
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false'];
function commit(d, iso, files) {
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
    fs.writeFileSync(path.join(d, rel), body);
  }
  execFileSync('git', ['add', '-A'], { cwd: d, env: gitEnv(path.dirname(d)), stdio: 'ignore' });
  execFileSync('git', [...ID, 'commit', '-q', '-m', 'change', `--date=${iso}`], { cwd: d, env: gitEnv(path.dirname(d)), stdio: 'ignore' });
  execFileSync('git', [...ID, 'rebase', '-q', '--committer-date-is-author-date', '--root'], { cwd: d, env: gitEnv(path.dirname(d)), stdio: 'ignore' });
}

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL', env: SANDBOX_ENV });
}

function findings(root, pairs) {
  const r = run([`--root=${root}`, '--json', ...pairs.map((p) => `--pair=${p}`)]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).findings;
}

test('a counterpart last committed before its source is reported translation-older, with both dates and the rule text', (t) => {
  const d = repo(t);
  commit(d, T_OLD, { 'README.th.md': 'th\n' });
  commit(d, T_NEW, { 'README.md': 'en\n' });
  const f = findings(d, ['README.md=README.th.md']);
  assert.equal(f.length, 1);
  assert.equal(f[0].check, 'translation-older');
  assert.equal(f[0].verdict, 'SUSPECTED');
  assert.equal(f[0].rule, 'translationPairs "README.md=README.th.md"');
  assert.equal(Date.parse(f[0].sourceDate), Date.parse(T_NEW));
  assert.equal(Date.parse(f[0].counterpartDate), Date.parse(T_OLD));
  const text = run([`--root=${d}`, '--pair=README.md=README.th.md']);
  assert.match(text.stdout, /"translation-older"/, 'the text output names the check through JSON.stringify');
});

test('a missing counterpart is reported translation-missing and never dated', (t) => {
  const d = repo(t);
  commit(d, T_NEW, { 'README.md': 'en\n' });
  const f = findings(d, ['README.md=README.th.md']);
  assert.deepEqual(f.map((x) => x.check), ['translation-missing']);
});

test('a counterpart committed after its source gives no finding', (t) => {
  const d = repo(t);
  commit(d, T_OLD, { 'README.md': 'en\n' });
  commit(d, T_NEW, { 'README.th.md': 'th\n' });
  assert.deepEqual(findings(d, ['README.md=README.th.md']), []);
});

test('a source and its counterpart in one commit give no finding', (t) => {
  const d = repo(t);
  commit(d, T_OLD, { 'README.md': 'en\n', 'README.th.md': 'th\n' });
  assert.deepEqual(findings(d, ['README.md=README.th.md']), []);
});

test('malformed pairs are refused as pair-invalid, one finding each, and never read', (t) => {
  const d = repo(t);
  commit(d, T_OLD, { 'README.md': 'en\n', 'README.th.md': 'th\n' });
  const bad = ['README.md', 'README.md=', '=README.th.md', '../x.md=README.th.md', '/abs/README.md=README.th.md', 'docs\\README.md=README.th.md'];
  const f = findings(d, bad);
  assert.equal(f.length, bad.length);
  assert.ok(f.every((x) => x.check === 'pair-invalid'), JSON.stringify(f.map((x) => x.check)));
});

test('a missing source is reported pair-source-missing', (t) => {
  const d = repo(t);
  commit(d, T_OLD, { 'README.th.md': 'th\n' });
  assert.deepEqual(findings(d, ['README.md=README.th.md']).map((x) => x.check), ['pair-source-missing']);
});

test('a folder with no .git is dated by no one: translation-undated, never translation-older', (t) => {
  const d = fixture(t);
  fs.writeFileSync(path.join(d, 'README.md'), 'en\n');
  fs.writeFileSync(path.join(d, 'README.th.md'), 'th\n');
  const f = findings(d, ['README.md=README.th.md']);
  assert.deepEqual(f.map((x) => x.check), ['translation-undated']);
  assert.match(f[0].reason, /git/);
});

test('a CRLF pair is dated and compared exactly like an LF pair', (t) => {
  const d = repo(t);
  commit(d, T_OLD, { 'README.th.md': 'th\r\n' });
  commit(d, T_NEW, { 'README.md': 'en\r\n' });
  assert.deepEqual(findings(d, ['README.md=README.th.md']).map((x) => x.check), ['translation-older']);
});

test('a counterpart that is a folder link leaving the root is refused as translation-missing, never dated (capability-gated)', (t) => {
  const d = repo(t);
  const outside = fixture(t);
  fs.writeFileSync(path.join(outside, 'README.th.md'), 'th\n');
  commit(d, T_NEW, { 'README.md': 'en\n' });
  try {
    fs.symlinkSync(outside, path.join(d, 'th'), 'junction'); // made after the commit: the link itself is never tracked
  } catch {
    t.skip('this volume cannot make a folder link (probe: symlinkSync with junction failed)');
    return;
  }
  assert.deepEqual(findings(d, ['README.md=th/README.th.md']).map((x) => x.check), ['translation-missing']);
});

test('--root missing exits 2 with a usage line', () => {
  const r = run(['--json', '--pair=README.md=README.th.md']);
  assert.equal(r.status, 2, r.stdout);
});

test('clampedRead keeps the case of a translation pair while disabledCanaries still lowercases', () => {
  assert.deepEqual(clampedRead({ translationPairs: ['README.md=README.th.md'] }, 'translationPairs'), ['README.md=README.th.md']);
  assert.deepEqual(clampedRead({ disabledCanaries: ['Doc-Structure'] }, 'disabledCanaries'), ['doc-structure']);
});
