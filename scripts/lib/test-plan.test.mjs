// The room half of the test runner (09a commit C): the room's numbers, the expectation check on what a run reported, and the REAL scripts/test.mjs run end to end over planted files.
// wave-run.test.mjs (the canon's, adopted by blob id) proves the runner itself; this file proves the room's wiring of it. It replaces test-spawn.test.mjs (08b).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HEAP_MB, TEST_TIMEOUT_MS, FILE_CLOCK_MS, RUN_TIMEOUT_MS, declaredTopLevelTests, expectationFindings } from './test-plan.mjs';

const ROOM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE_JOB_TIMEOUT_MS = 10 * 60 * 1000; // ci.yml: timeout-minutes 10 on the gate job

test('test-plan: the numbers are finite, ordered per test < per file < the waves, the waves end inside the gate job clock, and the heap cap is the room\'s 2048 MB', () => {
  for (const [k, v] of Object.entries({ HEAP_MB, TEST_TIMEOUT_MS, FILE_CLOCK_MS, RUN_TIMEOUT_MS })) assert.ok(Number.isInteger(v) && v > 0, `${k} is a positive integer`);
  assert.equal(HEAP_MB, 2048);
  assert.ok(TEST_TIMEOUT_MS > 54600, 'above the slowest file measured (54.6 s, 2026-10-09)');
  assert.ok(TEST_TIMEOUT_MS < FILE_CLOCK_MS && FILE_CLOCK_MS < RUN_TIMEOUT_MS, 'per test < per file < the waves');
  assert.ok(RUN_TIMEOUT_MS < GATE_JOB_TIMEOUT_MS, 'the waves end before the gate job clock does: a stuck run ends in the runner, loudly');
  assert.ok(RUN_TIMEOUT_MS >= Math.round(1.7 * 264000 / 10000) * 10000, 'at least 1.7 times the longest whole run measured (264 s, 2026-10-09, n = 3, 34 files in waves)');
});

test('declaredTopLevelTests: counts the test() calls that start a line, test.skip and test.todo included, and nothing indented', () => {
  const src = "import test from 'node:test';\ntest('a', () => {});\ntest.skip('b', () => {});\n  test('indented, not counted', () => {});\nfor (const x of [1]) {\n  test('looped, not counted', () => {});\n}\ntest.todo('c');\n";
  assert.equal(declaredTopLevelTests(src), 3);
  assert.equal(declaredTopLevelTests("import test from 'node:test';\r\ntest('a', () => {});\r\ntest('b', () => {});\r\n"), 2);
  assert.equal(declaredTopLevelTests('const x = 1;\n'), 0);
});

test('expectationFindings: a PASS file that reported fewer tests than it declares is named; a file with enough, a red file and an unreadable file are not', () => {
  const texts = { 'a.test.mjs': "test('1', () => {});\ntest('2', () => {});\ntest('3', () => {});\n", 'b.test.mjs': "test('1', () => {});\n", 'c.test.mjs': "test('1', () => {});\ntest('2', () => {});\n", 'd.test.mjs': "test.skip('1', () => {});\ntest.skip('2', () => {});\n" };
  const read = (f) => (f in texts ? texts[f] : null);
  const results = [
    { file: 'a.test.mjs', name: 'a.test.mjs', status: 'PASS', counts: { tests: 1 } },
    { file: 'b.test.mjs', name: 'b.test.mjs', status: 'PASS', counts: { tests: 4 } }, // generated tests only add
    { file: 'c.test.mjs', name: 'c.test.mjs', status: 'FAIL', counts: { tests: 0 } },
    { file: 'gone.test.mjs', name: 'gone.test.mjs', status: 'PASS', counts: { tests: 0 } },
    { file: 'd.test.mjs', name: 'd.test.mjs', status: 'SKIP', counts: { tests: 1 } }, // an all-skipped file is checked too
  ];
  const f = expectationFindings(results, read);
  assert.equal(f.length, 2);
  assert.match(f[0], /^a\.test\.mjs: declares 3 top-level test\(s\) but the run reported 1/);
  assert.match(f[1], /^d\.test\.mjs: declares 2 top-level test\(s\) but the run reported 1/);
});

test('test.mjs: the wiring is the canon runner with the room\'s numbers, a failed start and a short report are named FAILs, and nothing else spawns the tests', () => {
  const src = fs.readFileSync(path.join(ROOM, 'scripts', 'test.mjs'), 'utf8');
  assert.match(src, /runWaves\(\{ files: TESTS, cwd: repo, env: process\.env, heapMb: plan\.HEAP_MB, fileTimeoutMs: plan\.TEST_TIMEOUT_MS, fileClockMs: plan\.FILE_CLOCK_MS, deadlineMs: plan\.RUN_TIMEOUT_MS \}\)/);
  assert.match(src, /FAIL test runner: the run did not start/);
  assert.doesNotMatch(src, /runDirect|DIRECT_FILES/, 'every roster file, the canon runner test included, runs in a wave (09b: the canon test 30 no longer loses to the preload)');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOM, 'scripts', 'lib', 'test-plan.mjs'), 'utf8'), /runDirect|DIRECT_FILES/);
  assert.match(src, /expectationFindings\(run\.results/);
  assert.match(src, /process\.exitCode = run\.exitCode !== 0 \|\| short\.length \? 1 : 0/);
});

// ---- end to end: the REAL scripts/test.mjs and the REAL runner files, copied into a temp tree whose roster is the planted files ----
// The numbers are patched down in the COPY of test-plan.mjs only. Every run is bounded by its own timer that kills the whole tree, so a regression fails the test instead of hanging the suite.
// LOW-1 (08b, re-targeted at 09a): the old plant could put a per-test clock BELOW the whole-run deadline, and on Node 22 (a per-FILE clock) that changed which line the run printed, so
// the check passed on Node 24 and failed on three Node 22 legs, and no local mutant could show it. The property is now asserted in the plant itself, on every host: the per-test clock is
// ABOVE the deadline, which is above the file clock, so the wall clock of the file always ends a blocked file first and the outcome (a named FAIL status for that file, a non-zero exit) does
// not depend on the Node line's reading of --test-timeout.
function plant(t, files, nums = {}) {
  const n = { testClock: 60000, fileClock: 3000, deadline: 20000, ...nums };
  assert.ok(n.testClock > n.deadline && n.deadline > n.fileClock, `the planted clocks must satisfy per-test > deadline > per-file (got ${JSON.stringify(n)})`);
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cl-testplan-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'hooks')); // the runner also scans hooks/ for on-disk tests that are not in the roster
  const runner = fs.readFileSync(path.join(ROOM, 'scripts', 'test.mjs'), 'utf8');
  const names = Object.keys(files).map((f) => `'scripts/lib/${f}'`).join(', ');
  const roster = runner.replace(/const TESTS = \[[\s\S]*?\n\];/, `const TESTS = [${names}];`);
  assert.notEqual(roster, runner, 'the roster in the copy was replaced');
  fs.writeFileSync(path.join(dir, 'scripts', 'test.mjs'), roster);
  for (const f of ['wave-run.mjs', 'stdout-sync.mjs', 'machine-reading.mjs']) fs.copyFileSync(path.join(ROOM, 'scripts', 'lib', f), path.join(dir, 'scripts', 'lib', f));
  let plan = fs.readFileSync(path.join(ROOM, 'scripts', 'lib', 'test-plan.mjs'), 'utf8');
  for (const [name, value] of [['TEST_TIMEOUT_MS', n.testClock], ['FILE_CLOCK_MS', n.fileClock], ['RUN_TIMEOUT_MS', n.deadline]]) {
    const next = plan.replace(new RegExp(`export const ${name} = \\d+;`), `export const ${name} = ${value};`);
    assert.notEqual(next, plan, `${name} was patched in the copy`);
    plan = next;
  }
  fs.writeFileSync(path.join(dir, 'scripts', 'lib', 'test-plan.mjs'), plan);
  for (const [f, source] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'scripts', 'lib', f), source);
  return dir;
}

function killTree(child) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { timeout: 30000 });
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } }
}

function runPlanted(dir, boundMs = 60000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    // NODE_TEST_CONTEXT is set inside a node --test file child; inherited, the nested runner would behave as a child and run nothing.
    // The nested runner and the planted probe files get the planted folder as HOME, USERPROFILE, TEMP, TMP and TMPDIR, so nothing they do can reach the real home (CodeRabbit t27 finding 16).
    const env = { ...process.env, HOME: dir, USERPROFILE: dir, TEMP: dir, TMP: dir, TMPDIR: dir };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, ['scripts/test.mjs'], { cwd: dir, env, detached: process.platform !== 'win32' });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    let bound = false;
    const timer = setTimeout(() => { bound = true; killTree(child); }, boundMs);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, bound, out, s: (Date.now() - t0) / 1000 }); });
  });
}

const HDR = "import test from 'node:test';\nimport assert from 'node:assert/strict';\n";

test('test.mjs (run): a roster of real passing files is GREEN and exits 0', async (t) => {
  const dir = plant(t, { 'ok.test.mjs': HDR + "test('real check', () => assert.equal(1, 1));\ntest('second check', () => assert.ok(true));\n" });
  const r = await runPlanted(dir);
  assert.equal(r.bound, false, r.out.slice(-400));
  assert.equal(r.code, 0, r.out.slice(-600));
  assert.match(r.out, /wave-run: 1 file · pass 1 · fail 0.*GREEN/);
});

test('test.mjs (run): a file that calls process.exit(0) before its tests register is VACUOUS and the gate FAILS (the TAP-names MUST; RED before 09a, when it read "pass 1" and exited 0)', async (t) => {
  const dir = plant(t, { 'exit0.test.mjs': HDR + "process.exit(0);\ntest('never registered', () => assert.equal(1, 2));\n" });
  const r = await runPlanted(dir);
  assert.equal(r.bound, false, r.out.slice(-400));
  assert.notEqual(r.code, 0, 'a crash that exits 0 must not read as a pass\n' + r.out.slice(-600));
  assert.match(r.out, /^VACUOUS scripts\/lib\/exit0\.test\.mjs:/m);
  assert.match(r.out, /RED/);
});

test('test.mjs (run): a file whose second test exits 0 after the first passed is SHORT and the gate FAILS (the gap the canon names open, closed by the room\'s lower bound)', async (t) => {
  const src = HDR + "test('first passes', () => assert.ok(true));\ntest('second exits the process', async () => { await new Promise((r) => setTimeout(r, 400)); process.exit(0); });\ntest('third never runs', () => assert.ok(true));\n";
  const dir = plant(t, { 'half.test.mjs': src });
  const r = await runPlanted(dir);
  assert.equal(r.bound, false, r.out.slice(-400));
  assert.notEqual(r.code, 0, r.out.slice(-600));
  assert.match(r.out, /test runner: RED -- 1 file/);
  assert.match(r.out, /^SHORT scripts\/lib\/half\.test\.mjs: declares 3 top-level test\(s\) but the run reported/m);
});

test('test.mjs (run): a test that blocks its thread is ended by the file clock as a named FAIL and a non-zero exit, never a pass, and the other file still runs', async (t) => {
  const dir = plant(t, {
    'block.test.mjs': HDR + "import fs from 'node:fs';\ntest('blocks the thread', () => { fs.writeFileSync('child.pid', String(process.pid)); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15000); });\n",
    'fine.test.mjs': HDR + "test('fine', () => assert.ok(true));\n",
  });
  const r = await runPlanted(dir);
  try { process.kill(Number(fs.readFileSync(path.join(dir, 'child.pid'), 'utf8')), 'SIGKILL'); } catch { /* gone, or never written */ }
  assert.equal(r.bound, false, 'the run did not end by itself\n' + r.out.slice(-400));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /^FAIL scripts\/lib\/block\.test\.mjs: killed at the file clock \(3000 ms\)/m);
  assert.match(r.out, /pass 1 · fail 1/);
});

test('plant: LOW-1 (re-targeted) a plant whose per-test clock is not above its deadline is refused on every host (the old survivors M12 at 3000 and M13 at 5000)', () => {
  const t = { after() {} };
  for (const testClock of [3000, 5000]) assert.throws(() => plant(t, { 'x.test.mjs': HDR }, { testClock, fileClock: 3000 }), /per-test > deadline > per-file/);
  assert.throws(() => plant(t, { 'x.test.mjs': HDR }, { fileClock: 20000, deadline: 20000 }), /per-test > deadline > per-file/);
});

test('test.mjs (run): a run that cannot start (an empty roster) is a named FAIL and a non-zero exit, never a silent pass', async (t) => {
  // nothing to put in a wave: the canon runner refuses an empty list
  const dir = plant(t, {});
  const r = await runPlanted(dir);
  assert.equal(r.bound, false, r.out.slice(-400));
  assert.notEqual(r.code, 0, r.out.slice(-600));
  assert.match(r.out, /FAIL test runner: the run did not start \(no test files were given\)/);
});
