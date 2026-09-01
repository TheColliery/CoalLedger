// Hermetic spawn tests for scripts/configure.mjs (CWK-023): the real CLI is
// spawned as a child process against a sandboxed HOME/cwd, never imported —
// same shape as scripts/lib/hooks.test.mjs's runHook pattern, adapted for a
// CLI exit-code contract (scripts-quality.md §1: fail LOUD) instead of a
// hook's fail-silent one.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..');
const CLI = path.join(REPO, 'scripts', 'configure.mjs');

// home = a throwaway ~ (no global .coalledger.json -> global write lands clean)
// proj = the project dir the CLI runs from (cwd)
function sandbox() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clg-cfg-home-')));
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clg-cfg-proj-')));
  return { home, proj };
}
function clean(...dirs) { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); }

function run(args, { home, proj }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: proj,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: '' },
    timeout: 20000,
  });
}

test('configure: a valid write lands at the own-dir project path (.claude/coal/coalledger.json)', () => {
  const { home, proj } = sandbox();
  try {
    const r = run(['--language', 'th'], { home, proj });
    assert.strictEqual(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
    const target = path.join(proj, '.claude', 'coal', 'coalledger.json');
    assert.ok(fs.existsSync(target), 'config must be written at the own-dir default');
    const cfg = JSON.parse(fs.readFileSync(target, 'utf8'));
    assert.strictEqual(cfg.language, 'th');
  } finally { clean(home, proj); }
});

test('configure: --global writes ~/.claude/.coalledger.json, not the project config', () => {
  const { home, proj } = sandbox();
  try {
    const r = run(['--global', '--updateMode', 'auto'], { home, proj });
    assert.strictEqual(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
    const globalTarget = path.join(home, '.claude', '.coalledger.json');
    assert.ok(fs.existsSync(globalTarget), 'global config must land at ~/.claude/.coalledger.json');
    const cfg = JSON.parse(fs.readFileSync(globalTarget, 'utf8'));
    assert.strictEqual(cfg.updateMode, 'auto');
    assert.strictEqual(fs.existsSync(path.join(proj, '.claude', 'coal', 'coalledger.json')), false, 'a --global write must NOT also touch the project config');
  } finally { clean(home, proj); }
});

test('configure: an invalid enum value exits non-zero and writes NOTHING', () => {
  const { home, proj } = sandbox();
  try {
    const r = run(['--coalledgerMode', 'banana'], { home, proj });
    assert.notStrictEqual(r.status, 0, 'invalid enum must fail loud (scripts-quality.md §1)');
    assert.ok(r.stderr.includes('coalledgerMode'), 'the error must name the offending key');
    assert.strictEqual(fs.existsSync(path.join(proj, '.claude', 'coal', 'coalledger.json')), false, 'a rejected value must write nothing');
  } finally { clean(home, proj); }
});

test('configure: an unrecognised flag exits non-zero and writes NOTHING', () => {
  const { home, proj } = sandbox();
  try {
    const r = run(['--not-a-real-flag', 'x'], { home, proj });
    assert.notStrictEqual(r.status, 0, 'an unknown flag must fail loud');
    assert.ok(r.stderr.includes('Unrecognized option'));
    assert.strictEqual(fs.existsSync(path.join(proj, '.claude', 'coal', 'coalledger.json')), false, 'a rejected flag must write nothing');
  } finally { clean(home, proj); }
});

test('configure: a LEGACY-root config migrates on write, and the old file is removed', () => {
  const { home, proj } = sandbox();
  try {
    fs.writeFileSync(path.join(proj, '.coalledger.json'), JSON.stringify({ updateCheckDays: 30 }));
    const r = run(['--language', 'en'], { home, proj });
    assert.strictEqual(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
    const migrated = path.join(proj, '.claude', 'coal', 'coalledger.json');
    assert.ok(fs.existsSync(migrated), 'the config must land at the new own-dir location');
    const cfg = JSON.parse(fs.readFileSync(migrated, 'utf8'));
    assert.strictEqual(cfg.updateCheckDays, 30, 'the pre-existing value survives the migration');
    assert.strictEqual(cfg.language, 'en', 'the new CLI-set value is also present');
    assert.strictEqual(fs.existsSync(path.join(proj, '.coalledger.json')), false, 'the legacy root file must be removed after a successful migration');
    assert.ok(r.stdout.includes('Migrated the project config'), 'the migration must be announced, not silent');
  } finally { clean(home, proj); }
});

// --------------------------------------------------------------------------
// CWK-023 finding 1's own regression guard: an `.agents`-only project must
// never get a foreign `.claude/` planted by a fresh write. RED-FIRST,
// verified this session via `git stash push -- scripts/lib/config-load.mjs
// scripts/lib/config-load.test.mjs` (reverting ONLY the tracked loader files
// to their pre-CWK-023 committed state, leaving this untracked test file in
// place) then `node --test scripts/configure.test.mjs`: ALL SIX tests in
// this file failed — `ownDirDefault` does not exist on the pre-fix module
// (`SyntaxError: The requested module './lib/config-load.mjs' does not
// provide an export named 'ownDirDefault'`), so configure.mjs cannot even
// load, let alone plant the right directory. `git stash pop` restored the
// fix immediately after. That is a stronger RED than "resolves to the wrong
// path" — it proves this CLI is structurally built ON the fix, not merely
// coexisting with it. Not re-run live on every suite pass (stashing tracked
// source mid-run is its own hazard); this comment is the record.
// --------------------------------------------------------------------------
test('configure: an .agents-only project (no .claude/ dir anywhere) does NOT get a foreign .claude/ planted', () => {
  const { home, proj } = sandbox();
  try {
    fs.mkdirSync(path.join(proj, '.agents'), { recursive: true }); // the project already uses .agents, never .claude
    const r = run(['--language', 'th'], { home, proj });
    assert.strictEqual(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
    const agentsTarget = path.join(proj, '.agents', 'coal', 'coalledger.json');
    assert.ok(fs.existsSync(agentsTarget), 'the write must land under the agent dir the project already has');
    assert.strictEqual(fs.existsSync(path.join(proj, '.claude')), false, 'no foreign .claude/ may be planted into an .agents-only project');
  } finally { clean(home, proj); }
});
