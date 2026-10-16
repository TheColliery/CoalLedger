// The room's numbers for the wave runner, and the room's expectation check on what a run reported (09a commit C). scripts/lib/wave-run.mjs (adopted by blob id from the .github
// canon) ships NO number of its own: the heap cap, the clock per test, the clock per file and the whole-run deadline are flags the room passes, and these are this room's.
// This file replaces scripts/lib/test-spawn.mjs (08b, CWK-199): the canon runner now covers what that plan did (the heap cap in NODE_OPTIONS so a test's own spawns inherit it,
// --test-force-exit, a finite clock per test, a whole-run deadline that kills the tree, a signal-killed child read as a failure, never a pass) and adds the waves, the TAP
// reading and the stdout preload. The numbers moved here with their reasons. The serial plan did not move: the canon runner admits files in waves by the live machine reading, so on a
// busy box it runs about one file at a time anyway (22 to 32 holds per run below), and on a quiet one it overlaps files. This room's suite is safe to overlap (the three timed runs
// below passed 34 of 34 each time), but nothing here proves a file never touches shared state: that stays open.
//
// BASIS, measured 2026-10-09 on this box, node 24.19, under the wave runner, the box shared with other seats, n = 3 whole runs of the roster with 34 files in waves (09b put
// scripts/lib/wave-run.test.mjs, about 36 s, back into the waves, so the 09a basis of 33 files, median 173 s, max 176 s, no longer describes the roster): the maker 231 s, the
// reviewer 161 s and 264 s; wall time min 161 s, median 231 s, max 264 s. Per file (09a, n = 102): min 0.30 s, median 1.64 s, max 54.6 s (scripts/secret-scan.test.mjs; next
// scripts/secret-gate.test.mjs 48.0 s, scripts/lib/wave-run.test.mjs 36.1 s, scripts/verify.test.mjs 25.3 s). The whole-run deadline is 1.7 times the longest whole run, 1.7 x 264 s
// = 448.8 s, rounded to 450 s; the 300 s of 09a sat at 88% of the 264 s run (INSPECT 09b MEDIUM-1). Re-derive: time three runs of `node scripts/test.mjs` (the per-file times come
// from the runner's start and exit events).
// Not measured: a CI runner (macOS and Windows runners are slower; the first CI run after a push is that venue, and a deadline hit there is a number to raise with the run's time beside it),
// Node 22, Linux, macOS.

export const HEAP_MB = 2048;
export const TEST_TIMEOUT_MS = 120000; // per TEST (--test-timeout): about twice the slowest FILE measured (54.6 s), and the value the other rooms use
export const FILE_CLOCK_MS = 240000; // per FILE wall clock: 4.4 times the slowest file; it ends a hang before the first test, which --test-timeout never reaches, and the rest of the roster still runs
export const RUN_TIMEOUT_MS = 450000; // the waves: 1.7 times the longest whole run measured (264 s), rounded to 450 s. The waves stay inside the gate job's 10-minute timeout-minutes in ci.yml, so a stuck run ends in the runner, loudly, before the job clock does

// The expectation check (testing.md: a gate judges a run by the TAP test names it expects, never by the exit code and pass count alone).
// wave-run reads a file whose only result line names the file itself as VACUOUS (process.exit(0) before the tests, or inside the first), but names one gap open: a file whose
// test calls process.exit(0) AFTER another test already passed reports only the tests that finished, and reads as a PASS. This room closes that gap with a lower bound it can
// read from the file: every `test(` call that starts a line in column 0 is a top-level registration that runs unconditionally, so the TAP summary cannot report fewer tests
// than that count unless the file stopped before registering them. Generated tests (a loop, a helper) only add to the count, never subtract.
// The bound is a TEXT read of column-0 `test(` calls, so it has named limits (09b R2, the reviewer's 09a LOW-1):
// shortcut: a test registered through an alias (`t(...)`), `it(...)`, `await test(...)` or an indented `test(` inside a block counts as 0, so a file that mixes those with column-0 calls
//   is held only to the column-0 ones, and a file that uses ONLY those forms is caught by the "declares 0" guard in expectationFindings, not by the count; upgrade to a real
//   registration count (a TAP plan, or a parser) when a roster file legitimately mixes the forms and loses tests after an early exit.
// shortcut: a column-0 `test(` inside a block comment or a template string still counts, which can only over-count (a false SHORT, the safe direction: the gate goes red and a person
//   looks); upgrade if a roster file keeps commented-out column-0 `test(` examples.
export function declaredTopLevelTests(text) {
  const own = String(text).replace(/\r\n/g, '\n');
  const m = own.match(/^test(?:\.(?:skip|todo|only))?\(/gm);
  return m ? m.length : 0;
}

// results: the `results` array of runWaves (file, status, counts); read(file) returns the file's text or null. Returns one line per file that reported fewer tests than it declares.
export function expectationFindings(results, read) {
  const out = [];
  for (const r of results) {
    if (r.status !== 'PASS' && r.status !== 'SKIP') continue; // a red file is already red
    const text = read(r.file);
    if (typeof text !== 'string') continue;
    const declared = declaredTopLevelTests(text);
    const reported = r.counts ? r.counts.tests : 0;
    // R2: a file the bound counts as 0 is a file it holds to nothing, so a whole file switched to an alias, it() or await test() would read GREEN by accident. Every roster file
    // that passed must declare at least one test the bound can see; a file that cannot is named, never trusted.
    if (declared === 0) {
      out.push(`${r.name || r.file}: declares 0 top-level test(s) the lower bound can count but the run reported ${reported} (its tests are registered through a form the bound cannot see: an alias, it(), await test() or an indented call)`);
    }
    if (declared > reported) out.push(`${r.name || r.file}: declares ${declared} top-level test(s) but the run reported ${reported} (it stopped before registering the rest: an exit, a throw swallowed by the runner, or a hang the force-exit ended)`);
  }
  return out;
}
