// T-47 (order 29cl): each engine reads its project root and doc paths from the run list when given --list, and the shipped
// skill line that runs it names neither. A doc whose name carries a shell substitution is read as data: no marker appears,
// whether the engine is run directly or through the command line the built SKILL.md names. Sandboxed HOME and USERPROFILE;
// every folder is made under the resolved temp root and removed by the test that made it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SANDBOX_ENV } from '../test-sandbox.mjs';
import { gitEnv } from './git-env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const DOLLAR_PAREN = String.fromCharCode(36, 40); // the two characters that open a command substitution, built here so the literal stays out of the text
const EM = String.fromCharCode(0x2014);
const ENGINES = [
  { skill: 'doc-structure', engine: 'md-checks', docs: true, args: ['--json'] },
  { skill: 'doc-quality', engine: 'emdash', docs: true, args: [] },
  { skill: 'doc-quality', engine: 'lang-mechanics', docs: true, args: ['--json'] },
  { skill: 'doc-consistency', engine: 'translation-pairs', docs: false, args: ['--json'] },
  { skill: 'doc-standard', engine: 'repo-standard', docs: false, args: ['--json', '--now=2026-11-06T00:00:00Z'] },
];

const runListFile = () => path.join(SANDBOX_ENV.HOME, '.claude', 'coal', 'coalledger', 'run.json');

function writeRunList(root, docs) {
  fs.mkdirSync(path.dirname(runListFile()), { recursive: true });
  fs.writeFileSync(runListFile(), JSON.stringify({ root, docs }));
}

// A project with its own .git and a config that turns the em-dash rule on, so every engine has something to say about a doc.
function project(t, engine) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cl-runlist-eng-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 }));
  const p = path.join(base, 'project');
  fs.mkdirSync(p);
  execFileSync('git', ['init', '-q', p], { env: gitEnv(base), stdio: 'ignore' });
  fs.mkdirSync(path.join(p, '.claude', 'coal'), { recursive: true });
  fs.writeFileSync(path.join(p, '.claude', 'coal', 'coalledger.json'), JSON.stringify({ emDash: 'unspaced' }) + '\n');
  fs.writeFileSync(path.join(p, 'a.md'), `# A\n\n[broken](nope.md)\n\nalpha ${EM} beta\n`);
  const doc = path.join(p, `doc${DOLLAR_PAREN}mkdir MARK-${engine}).md`);
  fs.writeFileSync(doc, `# A\n\n[broken](nope.md)\n\nalpha ${EM} beta\n`);
  return { p, doc, base };
}

const engineFile = (engine) => path.join(ROOT, 'scripts', 'lib', engine + '.mjs');

// The same engine, run twice: once with the explicit root and doc path, once with --list. The reports must be equal.
function equivalence(i, t) {
  const { engine, docs, args } = ENGINES[i];
  const { p, doc } = project(t, engine);
  writeRunList(p, docs ? [doc] : []);
  const control = spawnSync(process.execPath, [engineFile(engine), ...args, `--root=${p}`, ...(docs ? [doc] : [])], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', env: SANDBOX_ENV, cwd: p });
  const listed = spawnSync(process.execPath, [engineFile(engine), ...args, '--list'], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', env: SANDBOX_ENV, cwd: p });
  assert.equal(listed.status, control.status, listed.stderr);
  assert.equal(listed.stdout, control.stdout);
  assert.equal(fs.existsSync(path.join(p, `MARK-${engine}`)), false, 'a shell ran the doc name');
}

function refusal(i, t) {
  const { engine, docs, args } = ENGINES[i];
  const { p, doc } = project(t, engine);
  writeRunList('relative/dir', docs ? [doc] : []);
  const r = spawnSync(process.execPath, [engineFile(engine), ...args, '--list'], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', env: SANDBOX_ENV, cwd: p });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /absolute/);
}

// The command the built SKILL.md names, run through bash with the sandboxed paths: the doc name is read as data.
function shipped(i, t) {
  const { skill, engine, docs } = ENGINES[i];
  const { p, doc, base } = project(t, engine);
  writeRunList(p, docs ? [doc] : []);
  const md = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', skill, 'SKILL.md'), 'utf8');
  const span = new RegExp('`(cd "<skill base dir>" && node \\./lib/' + engine + '\\.mjs[^`]*)`').exec(md);
  assert.ok(span, `${skill} names the ${engine} command in one code span`);
  assert.doesNotMatch(span[1], /<project root>|<absolute-file\.md>/, 'the command line carries no project root and no doc path');
  const copy = path.join(base, 'skill');
  fs.cpSync(path.join(ROOT, 'plugin', 'skills', skill), copy, { recursive: true });
  const cmd = span[1].split('<skill base dir>').join(copy.split(path.sep).join('/'));
  const script = path.join(base, 'run-engine.sh');
  fs.writeFileSync(script, cmd + '\n');
  const r = spawnSync('bash', [script], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', env: SANDBOX_ENV, cwd: p });
  assert.equal(fs.existsSync(path.join(copy, `MARK-${engine}`)), false, 'a shell ran the doc name (in the skill copy)');
  assert.equal(fs.existsSync(path.join(p, `MARK-${engine}`)), false, 'a shell ran the doc name (in the project)');
  assert.doesNotMatch(r.stderr, /usage/, r.stderr);
}

// The registrations are written out one per line: the room's declared-test bound counts column-0 test( calls, so a loop would hide them.
test('md-checks --list reads the root and docs from the run list and reports what the explicit-path run reports', (t) => equivalence(0, t));
test('md-checks --list with a relative root exits 2 and names the absolute rule', (t) => refusal(0, t));
test('the command the built doc-structure SKILL.md names for md-checks reads the run list, and a doc name is data', (t) => shipped(0, t));
test('emdash --list reads the root and docs from the run list and reports what the explicit-path run reports', (t) => equivalence(1, t));
test('emdash --list with a relative root exits 2 and names the absolute rule', (t) => refusal(1, t));
test('the command the built doc-quality SKILL.md names for emdash reads the run list, and a doc name is data', (t) => shipped(1, t));
test('lang-mechanics --list reads the root and docs from the run list and reports what the explicit-path run reports', (t) => equivalence(2, t));
test('lang-mechanics --list with a relative root exits 2 and names the absolute rule', (t) => refusal(2, t));
test('the command the built doc-quality SKILL.md names for lang-mechanics reads the run list, and a doc name is data', (t) => shipped(2, t));
test('translation-pairs --list reads the root from the run list and reports what the explicit-path run reports', (t) => equivalence(3, t));
test('translation-pairs --list with a relative root exits 2 and names the absolute rule', (t) => refusal(3, t));
test('the command the built doc-consistency SKILL.md names for translation-pairs reads the run list, and a doc name is data', (t) => shipped(3, t));
test('repo-standard --list reads the root from the run list and reports what the explicit-path run reports', (t) => equivalence(4, t));
test('repo-standard --list with a relative root exits 2 and names the absolute rule', (t) => refusal(4, t));
test('the command the built doc-standard SKILL.md names for repo-standard reads the run list, and a doc name is data', (t) => shipped(4, t));
