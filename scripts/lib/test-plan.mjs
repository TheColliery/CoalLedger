// The room's numbers for the wave runner, and the room's expectation check on what a run reported (09a commit C). scripts/lib/wave-run.mjs (adopted by blob id from the .github
// canon) ships NO number of its own: the heap cap, the clock per test, the clock per file and the whole-run deadline are flags the room passes, and these are this room's.
// This file replaces scripts/lib/test-spawn.mjs (08b, CWK-199): the canon runner now covers what that plan did (the heap cap in NODE_OPTIONS so a test's own spawns inherit it,
// --test-force-exit, a finite clock per test, a whole-run deadline that kills the tree, a signal-killed child read as a failure, never a pass) and adds the waves, the TAP
// reading and the stdout preload. The numbers moved here with their reasons. The serial plan did not move: the canon runner admits files in waves by the live machine reading, so on a
// busy box it runs about one file at a time anyway (22 to 32 holds per run below), and on a quiet one it overlaps files. This room's suite is safe to overlap (the three timed runs
// below passed 33 of 33 each time), but nothing here proves a file never touches shared state: that stays open.
//
// BASIS, measured 2026-10-09 on this box, node 24.19, under the wave runner, n = 3 whole runs of the roster (33 files in waves, plus the one the runner then ran directly, which 09b put back into the waves; the basis is the 09a measurement), the box shared with other
// seats (the readings held 22, 28 and 32 times): wall time min 151.4 s, median 172.8 s, max 176.0 s; per file, n = 102, min 0.30 s, median 1.64 s, max 54.6 s (scripts/secret-scan.test.mjs; next
// scripts/secret-gate.test.mjs 48.0 s, scripts/lib/wave-run.test.mjs 36.1 s, scripts/verify.test.mjs 25.3 s). Re-derive: time three runs of `node scripts/test.mjs` (the per-file times come from the runner's start and exit events).
// Not measured: a CI runner (macOS and Windows runners are slower; the first CI run after a push is that venue, and a deadline hit there is a number to raise with the run's time beside it),
// Node 22, Linux, macOS.

export const HEAP_MB = 2048;
export const TEST_TIMEOUT_MS = 120000; // per TEST (--test-timeout): about twice the slowest FILE measured (54.6 s), and the value the other rooms use
export const FILE_CLOCK_MS = 240000; // per FILE wall clock: 4.4 times the slowest file; it ends a hang before the first test, which --test-timeout never reaches, and the rest of the roster still runs
export const RUN_TIMEOUT_MS = 300000; // the waves: 1.7 times the longest whole run measured (176 s). The waves stay inside the gate job's 10-minute timeout-minutes in ci.yml, so a stuck run ends in the runner, loudly, before the job clock does

// The expectation check (testing.md: a gate judges a run by the TAP test names it expects, never by the exit code and pass count alone).
// wave-run reads a file whose only result line names the file itself as VACUOUS (process.exit(0) before the tests, or inside the first), but names one gap open: a file whose
// test calls process.exit(0) AFTER another test already passed reports only the tests that finished, and reads as a PASS. This room closes that gap with a lower bound it can
// read from the file: every `test(` call that starts a line in column 0 is a top-level registration that runs unconditionally, so the TAP summary cannot report fewer tests
// than that count unless the file stopped before registering them. Generated tests (a loop, a helper) only add to the count, never subtract.
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
    if (declared > reported) out.push(`${r.name || r.file}: declares ${declared} top-level test(s) but the run reported ${reported} (it stopped before registering the rest: an exit, a throw swallowed by the runner, or a hang the force-exit ended)`);
  }
  return out;
}
