#!/usr/bin/env node
// CoalLedger test runner — the canonical gate suite. Enumerates EVERY test file
// explicitly and FAILS LOUD on drift in BOTH directions (listed-but-missing,
// on-disk-but-unlisted). Mirrors the CoalTipple/CoalWash runner (node --test
// with a directory arg proved unreliable on Node 24; a missing listed file must
// fail loud, never silently zero-match).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TESTS = [
  'scripts/lib/jsonc.test.mjs',
  'scripts/lib/wave-run.test.mjs',
  'scripts/lib/test-plan.test.mjs',
  'scripts/lib/config-schema.test.mjs',
  'scripts/lib/config-load.test.mjs',
  'scripts/lib/md-ast.test.mjs',
  'scripts/lib/md-checks.test.mjs',
  'scripts/lib/conductor.test.mjs',
  'scripts/lib/hooks.test.mjs',
  'scripts/lib/desc-cap.test.mjs',
  'scripts/lib/claude-ai-trim.test.mjs',
  'scripts/lib/build-claude-ai-zips.test.mjs',
  'scripts/lib/config-keys.test.mjs',
  'scripts/lib/pointer-check.test.mjs',
  'scripts/lib/git-env.test.mjs',
  'scripts/lib/git-env-census.test.mjs',
  'scripts/lib/git-env-pins.test.mjs',
  'scripts/lib/repo-fs.test.mjs',
  'scripts/lib/emdash.test.mjs',
  'scripts/lib/lang-mechanics.test.mjs',
  'scripts/lib/main-module-guard.test.mjs',
  'scripts/lib/release-shape.test.mjs',
  'scripts/lib/asset-upload-mode.test.mjs',
  'scripts/lib/release-prune.test.mjs',
  'scripts/configure.test.mjs',
  'scripts/build-plugin.test.mjs',
  'scripts/verify.test.mjs',
  'scripts/cli-guard.test.mjs',
  'scripts/secret-scan.test.mjs',
  'scripts/secret-gate.test.mjs',
  'scripts/release-notes.test.mjs',
  'scripts/verify-release-shape.test.mjs',
  'scripts/decide-upload.test.mjs',
  'scripts/prune-release-zips.test.mjs',
];

// Top-level `return` is a SyntaxError in a real ESM module (unlike CJS, which
// wraps a file in a function) -- so each guard below nests the rest of the
// script in its `else` rather than early-returning. process.exit() would
// truncate pending stdout writes (node/runtime.md §7, CWK-071); exitCode +
// natural fall-through preserves the exact same three outcomes.
const missing = TESTS.filter((t) => !fs.existsSync(path.join(repo, t)));
if (missing.length) {
  console.error(`test runner: ${missing.length} listed test file(s) MISSING — ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  const onDisk = [];
  for (const dir of ['scripts', 'scripts/lib', 'hooks']) {
    for (const f of fs.readdirSync(path.join(repo, dir))) {
      if (f.endsWith('.test.mjs') || f.endsWith('.test.js')) onDisk.push(`${dir}/${f}`);
    }
  }
  const orphans = onDisk.filter((f) => !TESTS.includes(f));
  if (orphans.length) {
    console.error(`test runner: ${orphans.length} on-disk test(s) NOT in the suite — ${orphans.join(', ')}. Add to scripts/test.mjs.`);
    process.exitCode = 1;
  } else {
    // 09a: the run is the canon wave runner (scripts/lib/wave-run.mjs, adopted by blob id from the .github canon): one `node --test --test-reporter=tap` child per file, the
    // next admitted only while a fresh machine reading says BREATHE (machine-reading.mjs, CoalFace's file), under the room's heap cap (scripts/lib/test-plan.mjs; the cap rides
    // NODE_OPTIONS so a test's own spawns inherit it), a finite clock per test and per file, a whole-run deadline that kills the tree, and stdout-sync.mjs as a preload so a
    // force-exited file keeps its tail. A file is judged by its TAP, never by its exit code alone: a file that exits 0 before its tests register is VACUOUS and the run is RED
    // (testing.md; measured on Node 24.19: process.exit(0) there prints "# pass 1" and exits 0). The room adds one check the canon names as open: expectationFindings, a lower bound
    // on the tests a PASS file must report. Dynamic and inside the step that needs it, per node/runtime.md section 1 (a gate entry imports node builtins only at the top).
    const { runWaves, summarize } = await import(pathToFileURL(path.join(repo, 'scripts', 'lib', 'wave-run.mjs')).href);
    const plan = await import(pathToFileURL(path.join(repo, 'scripts', 'lib', 'test-plan.mjs')).href);
    let run = null;
    try {
      run = await runWaves({ files: TESTS.filter((f) => !plan.DIRECT_FILES.includes(f)), cwd: repo, env: process.env, heapMb: plan.HEAP_MB, fileTimeoutMs: plan.TEST_TIMEOUT_MS, fileClockMs: plan.FILE_CLOCK_MS, deadlineMs: plan.RUN_TIMEOUT_MS });
    } catch (e) {
      console.error(`FAIL test runner: the run did not start (${e && e.message ? e.message : 'error'})`);
      process.exitCode = 1;
    }
    if (run) {
      // the canon's own runner test is run directly (scripts/lib/test-plan.mjs, DIRECT_FILES: a named divergence), then every file is put back in roster order for ONE reconciled summary
      const byFile = new Map(run.results.map((r) => [r.file, r]));
      for (const f of plan.DIRECT_FILES) if (TESTS.includes(f)) byFile.set(f, plan.runDirect(f, { cwd: repo, env: process.env }));
      run.results = TESTS.map((f) => byFile.get(f));
      run.summary = summarize(run.results, TESTS.length);
      run.exitCode = run.summary.red ? 1 : 0;
      for (const r of run.results) {
        if (r.status === 'PASS' || r.status === 'SKIP') continue;
        console.log(`${r.status} ${r.name}: ${r.reason}`);
        if (r.stdout || r.stderr) console.error(`--- ${r.name} (${r.status}) ---
${r.stdout ?? ''}${r.stderr ?? ''}`);
      }
      const short = plan.expectationFindings(run.results, (f) => { try { return fs.readFileSync(path.join(repo, f), 'utf8'); } catch { return null; } });
      for (const s of short) console.log(`SHORT ${s}`);
      console.log(run.summary.line);
      if (short.length) console.log(`test runner: RED -- ${short.length} file(s) reported fewer tests than they declare (SHORT lines above)`);
      process.exitCode = run.exitCode !== 0 || short.length ? 1 : 0;
    }
  }
}
