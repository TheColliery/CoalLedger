// MED-3 (r34 INSPECT): every guarded script in this room compared
// import.meta.url (the loader's REALPATH of the entry) against a merely
// path.resolve'd process.argv[1] -- a LEXICAL compare that FAILS OPEN
// through a junction or a symlinked ~/.claude: the entry point's own CLI
// block silently never runs, printing nothing and exiting 0, which reads as
// a clean bill. This room paid for the identical lexical-vs-realpath defect
// at CWK-078.
//
// These tests run each of the six guarded scripts THROUGH A REAL JUNCTION
// and assert the CLI actually fired (its normal exit code / output), never
// the old silent-success shape. Junction creation is PROBED once; if
// refused, every junction-dependent test SKIPS VISIBLY (t.skip with the
// reason), never a bare return -- and each test carries exactly ONE
// skippable leg (this room's own hard-won rule: a test mixing an
// unconditional assertion with a capability-gated one hides the
// unconditional assertions the moment the capability is absent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function probeJunction() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clg-junction-probe-'));
  const target = path.join(tmp, 'target');
  const link = path.join(tmp, 'link');
  fs.mkdirSync(target);
  try {
    fs.symlinkSync(target, link, 'junction');
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.code || e.message };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
const JUNCTION = probeJunction();

// baseDir is junctioned (never copied); relScript is resolved through the
// junction, so import.meta.url and process.argv[1] genuinely disagree
// lexically and can only reconcile through fs.realpathSync.native.
function runThroughJunction(baseDir, relScript, args, spawnOpts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clg-junction-'));
  const link = path.join(tmp, 'via-junction');
  try {
    fs.symlinkSync(baseDir, link, 'junction');
    return spawnSync(process.execPath, [path.join(link, relScript), ...args], { encoding: 'utf8', ...spawnOpts });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('configure.mjs: --help through a junction still exits 0 and prints (the guard fired)', (t) => {
  if (!JUNCTION.ok) { t.skip(`junction unavailable on this box: ${JUNCTION.reason}`); return; }
  const r = runThroughJunction(path.join(repo, 'scripts'), 'configure.mjs', ['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /CoalLedger Configurator Utility/);
});

test('build-plugin.mjs: --check through a junction still exits 0 and prints the dist-parity line (the guard fired)', (t) => {
  if (!JUNCTION.ok) { t.skip(`junction unavailable on this box: ${JUNCTION.reason}`); return; }
  const r = runThroughJunction(path.join(repo, 'scripts'), 'build-plugin.mjs', ['--check']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /plugin\/ dist in sync with source\./);
});

test('build-claude-ai-zips.mjs: through a junction, its own early-exit branch still fires (not silent exit 0)', (t) => {
  if (!JUNCTION.ok) { t.skip(`junction unavailable on this box: ${JUNCTION.reason}`); return; }
  // Isolated copy with NO plugin/ dir, same shape as cli-guard.test.mjs's
  // own safe fixture -- proves the GUARD, never touches the real repo.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clg-junction-zip-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scripts', 'lib'), { recursive: true });
    fs.cpSync(path.join(repo, 'scripts', 'build-claude-ai-zips.mjs'), path.join(tmp, 'scripts', 'build-claude-ai-zips.mjs'));
    fs.cpSync(path.join(repo, 'scripts', 'lib', 'desc-cap.mjs'), path.join(tmp, 'scripts', 'lib', 'desc-cap.mjs'));
    fs.cpSync(path.join(repo, 'scripts', 'lib', 'claude-ai-trim.mjs'), path.join(tmp, 'scripts', 'lib', 'claude-ai-trim.mjs'));
    const r = runThroughJunction(path.join(tmp, 'scripts'), 'build-claude-ai-zips.mjs', []);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /does not exist/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('md-checks.mjs: a scan through a junction still finds the planted fixture defects (the guard fired)', (t) => {
  if (!JUNCTION.ok) { t.skip(`junction unavailable on this box: ${JUNCTION.reason}`); return; }
  const fixture = path.join(repo, 'scripts', 'fixtures', 'defects-structure.md');
  const r = runThroughJunction(path.join(repo, 'scripts', 'lib'), 'md-checks.mjs', [fixture]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^[1-9]\d* finding\(s\) across 1 file\(s\)$/m);
});

test('emdash.mjs: --selftest through a junction still runs and reports PASS (the guard fired)', (t) => {
  if (!JUNCTION.ok) { t.skip(`junction unavailable on this box: ${JUNCTION.reason}`); return; }
  const r = runThroughJunction(path.join(repo, 'scripts', 'lib'), 'emdash.mjs', ['--selftest']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /SELFTEST: PASS/);
});

test('lang-mechanics.mjs: a scan through a junction still finds a planted ZH defect (the guard fired)', (t) => {
  if (!JUNCTION.ok) { t.skip(`junction unavailable on this box: ${JUNCTION.reason}`); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clg-junction-lang-'));
  try {
    const f = path.join(tmp, 'a.md');
    fs.writeFileSync(f, '你好,再见\n');
    const r = runThroughJunction(path.join(repo, 'scripts', 'lib'), 'lang-mechanics.mjs', [f]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^1 finding\(s\) across 1 file\(s\)$/m);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
