// The child spawn plan of scripts/test.mjs (CWK-199's class). `node --test` spawns one child per test file;
// the heap cap rides NODE_OPTIONS in the ENV, which every per-file child inherits AND so does every process a
// test itself spawns (a hook or CLI run with spawnSync(process.execPath)): measured 2026-10-08 on Node 24.19
// (CoalMine 08b INSPECT), the runner also forwards an argv flag to the per-file children, but a process a test
// spawns gets the cap only from the env (2240 MB with the env form, 4288 MB with the flag on the argv). Node 24.19
// refuses --test-concurrency inside NODE_OPTIONS, so that flag, the clock and --test-force-exit ride the argv.
// The files run one at a time. Zone rule: CoalWorks dispatch-transport.md, ninth amendment, "THE GRANDCHILD
// HALF" (as corrected 2026-10-08). A caller's own heap flag is kept as set (their cap wins, never doubled), in any
// spelling Node accepts (dash or underscore per word; CoalTipple measured on Node 24 that --max_old_space_size=1024
// and --max-old_space-size=1024 both give the 1024 MB cap; the space form `--max-old-space-size 1024` is refused by
// Node, so it is not matched); any other NODE_OPTIONS value is kept and the cap appended.
//
// SHAPE: CoalMine's scripts/lib/test-spawn.mjs (93a14165, commit 6165316 on its r08b branch), which is CoalTipple's
// (4c9644e5) plus --test-force-exit and a whole-run deadline. NAMED DIVERGENCES FROM THAT SHAPE, two, both here on
// purpose: (1) the heap-flag match is CoalTipple's underscore-tolerant one (CoalMine's is the dash-only older form);
// (2) RUN_TIMEOUT_MS is this room's own number, 300000, not CoalMine's 600000, because this room's gate job in
// ci.yml has a 10-minute timeout and its suite is about half the length (see below).
//
// Why force-exit and a deadline (CoalMine 08b INSPECT M-1): a test that hangs past --test-timeout is reported failed,
// but its file's process stays alive while any handle (an interval, a server, a child) keeps its event loop running,
// so the run never ended and the finite clock did not bound the run. (1) --test-force-exit on the argv: the runner
// exits once all known tests have finished even if the event loop is still active. The trade: it also lets a LATE
// async failure after a test returned pass unreported. (2) RUN_TIMEOUT_MS and RUN_KILL_SIGNAL, a whole-run deadline
// scripts/test.mjs puts on its spawnSync, as the backstop for what (1) cannot reach (a test that blocks its thread
// synchronously, where neither the per-test clock nor force-exit can run). (3) the plan carries both.
//
// TEST_TIMEOUT_MS is the finite clock testing.md asks of every room's test entry (a hung test must fail, not hold
// the runner). Basis, measured 2026-10-08 on this box, serial, one file per child, heap-capped, the box about half
// busy with other seats: 31 files, min 0.31 s, median 1.47 s, max 29.6 s (scripts/secret-scan.test.mjs; next
// scripts/secret-gate.test.mjs 27.5 s, scripts/verify.test.mjs 13.4 s). 120000 is about four times the slowest FILE,
// and the value CoalTipple, CoalMine, CoalHearth and CoalWash use; this room's earlier 60000 was twice its older
// suite time and is not kept, so a slow CI runner has room. It is a per-test deadline: a synchronous block (a
// spawnSync that hangs) is cut by that call's own `timeout`, not by this flag.
//
// RUN_TIMEOUT_MS is the whole serial run: the 31 files sum to 124.8 s in the same measurement, so 300000 is 2.4
// times that reading (CoalMine's ratio is 2.2), and half the gate job's 10-minute timeout-minutes in ci.yml, so a
// stuck run ends here, loudly, before the job clock does. Not measured here: a CI runner's wall time (macOS and
// Windows runners are slower than this box; the first CI run after a push is that venue, and a deadline hit there
// is a number to raise, with the run's time beside it), Node 22 (the flag is documented from v22.0.0), and Linux or
// macOS, where the spawnSync timeout may leave a file process the runner had started.
export const TEST_TIMEOUT_MS = 120000;
export const RUN_TIMEOUT_MS = 300000;
export const RUN_KILL_SIGNAL = 'SIGKILL';
export const HEAP_FLAG = '--max-old-space-size=2048';

export function testSpawnPlan(tests, baseEnv) {
  const caller = baseEnv.NODE_OPTIONS || '';
  const nodeOptions = /(^|\s)--max[-_]old[-_]space[-_]size=/.test(caller) ? caller : `${caller} ${HEAP_FLAG}`.trim();
  return {
    args: ['--test', '--test-concurrency=1', '--test-force-exit', `--test-timeout=${TEST_TIMEOUT_MS}`, ...tests],
    env: { ...baseEnv, NODE_OPTIONS: nodeOptions },
    timeout: RUN_TIMEOUT_MS,
    killSignal: RUN_KILL_SIGNAL,
  };
}
