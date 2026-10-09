#!/usr/bin/env node
// CoalLedger test runner — the canonical gate suite. Enumerates EVERY test file
// explicitly and FAILS LOUD on drift in BOTH directions (listed-but-missing,
// on-disk-but-unlisted). Mirrors the CoalTipple/CoalWash runner (node --test
// with a directory arg proved unreliable on Node 24; a missing listed file must
// fail loud, never silently zero-match).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TESTS = [
  'scripts/lib/jsonc.test.mjs',
  'scripts/lib/test-spawn.test.mjs',
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
    // CWK-199: the child spawn (heap cap in the env, files one at a time, a finite per-test clock, --test-force-exit and a
    // whole-run deadline) is one plan in scripts/lib/test-spawn.mjs, which carries the measurements and the reasons.
    // Dynamic and inside the step that needs it, per node/runtime.md section 1 (a gate entry imports node builtins only at the top).
    const { testSpawnPlan, exitCodeOf } = await import(pathToFileURL(path.join(repo, 'scripts', 'lib', 'test-spawn.mjs')).href);
    const plan = testSpawnPlan(TESTS, process.env);
    const r = spawnSync(process.execPath, plan.args, { cwd: repo, stdio: 'inherit', env: plan.env, timeout: plan.timeout, killSignal: plan.killSignal });
    // A whole-run deadline is a LOUD failure (a named FAIL line, non-zero), never a silent pass or an unbounded wait.
    if (r.error) {
      console.error(`FAIL test runner: the run did not finish (${r.error.code || r.error.message}); the whole-run deadline is ${plan.timeout} ms (scripts/lib/test-spawn.mjs RUN_TIMEOUT_MS)`);
      process.exitCode = 1;
    } else {
      process.exitCode = exitCodeOf(r);
    }
  }
}
