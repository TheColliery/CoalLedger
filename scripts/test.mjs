#!/usr/bin/env node
// CoalLedger test runner — the canonical gate suite. Enumerates EVERY test file
// explicitly and FAILS LOUD on drift in BOTH directions (listed-but-missing,
// on-disk-but-unlisted). Mirrors the CoalTipple/CoalWash runner (node --test
// with a directory arg proved unreliable on Node 24; a missing listed file must
// fail loud, never silently zero-match).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TESTS = [
  'scripts/lib/jsonc.test.mjs',
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
    // R12 bounce 1 F7: testing.md's finite-clock MUST -- a node:test test has NO timeout
    // by default, so a single hung child (a `git` spawn blocked on a credential prompt, a
    // stale index.lock) hangs the whole suite with nothing to report it as a failure. 60s
    // per test is ~2x this room's measured full-suite wall time (duration_ms ~27000 at
    // this writing, re-derive rather than trust this comment) -- generous for one test,
    // still far short of ci.yml's 10-minute job bound (CWK-154 (2)).
    const r = spawnSync(process.execPath, ['--test', '--test-timeout=60000', ...TESTS], { cwd: repo, stdio: 'inherit' });
    process.exitCode = r.status ?? 1;
  }
}
