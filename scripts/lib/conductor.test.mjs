// Hermetic spawn tests for hooks/coalledger-conductor.js (hooks-safety.md §7):
// spawn the REAL hook as a child process with a sandboxed HOME/TEMP/cwd so real
// session state and the real ~/.claude/.coalledger.json can never leak in.
// Every case asserts the three observable surfaces:
//   (1) exit code 0 on every path (Phoenix #4);
//   (2) stderr silent — stdout only on the sanctioned SessionStart channel;
//   (3) the expected state effect (update stamp written, or nothing).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const HOOK = path.join(REPO, 'hooks', 'coalledger-conductor.js');

function sandbox() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clg-home-')));
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clg-proj-')));
  // root the project (found by the stop-at-home walk) without overriding config
  fs.writeFileSync(path.join(proj, '.coalledger.json'), '{}');
  return { home, proj };
}
function clean(...dirs) {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}
function run(cwd, home) {
  return spawnSync(process.execPath, [HOOK], {
    cwd,
    env: { ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, CLAUDE_CONFIG_DIR: '' },
    encoding: 'utf8',
    timeout: 20000,
  });
}
function writeProjCfg(proj, cfg) {
  fs.writeFileSync(path.join(proj, '.coalledger.json'), JSON.stringify(cfg), 'utf8');
}
function assertGraceful(r) {
  assert.strictEqual(r.status, 0, `hook must exit 0 (stderr: ${r.stderr})`);
  assert.strictEqual(r.stderr, '', 'hook must be silent on stderr (Phoenix #13)');
  assert.strictEqual(r.signal, null, 'hook must not be killed by a signal');
}

test('coalledgerMode off: fully silent (update scheduling included)', () => {
  const { home, proj } = sandbox();
  try {
    writeProjCfg(proj, { coalledgerMode: 'off' });
    const r = run(proj, home);
    assertGraceful(r);
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(fs.existsSync(path.join(home, '.claude', '.coalledger-update-check')), false, 'no stamp in off mode');
  } finally { clean(home, proj); }
});

const ALL_CANARIES = ['doc-structure', 'doc-grounding', 'doc-standard', 'doc-rot', 'doc-consistency', 'doc-quality', 'doc-leak'];

test('default boot: all 6+1 canaries offered + update-due directive with the gold never-assume wording', () => {
  const { home, proj } = sandbox();
  try {
    const r = run(proj, home);
    assertGraceful(r);
    assert.ok(r.stdout.includes('[CoalLedger] docs-health canary suite installed'), r.stdout);
    for (const c of ALL_CANARIES) assert.ok(r.stdout.includes(`- ${c} (`), `${c} is offered`);
    assert.ok(r.stdout.includes('Domain entry'), 'the offer-on-domain-entry rule is stated once');
    assert.ok(r.stdout.includes('question tool'), 'offers ride the agent question-box');
    assert.ok(r.stdout.includes('[self-update due]'));
    assert.ok(r.stdout.includes('never assume'), 'gold no-external-assumption wording');
    assert.ok(fs.existsSync(path.join(home, '.claude', '.coalledger-update-check')), 'crash-safe stamp written');
  } finally { clean(home, proj); }
});

test('docLeak false: the doc-leak offer is gated out, the other six still inject', () => {
  const { home, proj } = sandbox();
  try {
    writeProjCfg(proj, { docLeak: false, updateMode: 'off' });
    const r = run(proj, home);
    assertGraceful(r);
    assert.ok(!r.stdout.includes('- doc-leak ('), 'doc-leak silent when the gate is off');
    for (const c of ALL_CANARIES.filter((x) => x !== 'doc-leak')) assert.ok(r.stdout.includes(`- ${c} (`), `${c} still offered`);
  } finally { clean(home, proj); }
});

test("disabledCanaries ['doc-grounding'] drops only that offer", () => {
  const { home, proj } = sandbox();
  try {
    writeProjCfg(proj, { disabledCanaries: ['doc-grounding'], updateMode: 'off' });
    const r = run(proj, home);
    assertGraceful(r);
    assert.ok(!r.stdout.includes('- doc-grounding ('), r.stdout);
    for (const c of ALL_CANARIES.filter((x) => x !== 'doc-grounding')) assert.ok(r.stdout.includes(`- ${c} (`), `${c} still offered`);
  } finally { clean(home, proj); }
});

test('update stamp throttles: second boot inside the window emits no update line', () => {
  const { home, proj } = sandbox();
  try {
    const r1 = run(proj, home);
    assertGraceful(r1);
    assert.ok(r1.stdout.includes('[self-update due]'));
    const r2 = run(proj, home);
    assertGraceful(r2);
    assert.ok(!r2.stdout.includes('[self-update due]'), 'inside the window: no re-nag');
    assert.ok(r2.stdout.includes('doc-structure'), 'canary offers still inject');
  } finally { clean(home, proj); }
});

test('manual mode: no canary offers, but the self-update scheduler still runs', () => {
  const { home, proj } = sandbox();
  try {
    writeProjCfg(proj, { coalledgerMode: 'manual' });
    const r = run(proj, home);
    assertGraceful(r);
    assert.ok(!r.stdout.includes('doc-structure'), 'no offers in manual mode');
    assert.ok(r.stdout.includes('[self-update due]'));
  } finally { clean(home, proj); }
});

test("disabledCanaries ['all'] silences the conductor entirely", () => {
  const { home, proj } = sandbox();
  try {
    writeProjCfg(proj, { disabledCanaries: ['all'] });
    const r = run(proj, home);
    assertGraceful(r);
    assert.strictEqual(r.stdout, '');
  } finally { clean(home, proj); }
});

test("disabledCanaries ['doc-structure'] drops its offer but keeps the conductor", () => {
  const { home, proj } = sandbox();
  try {
    writeProjCfg(proj, { disabledCanaries: ['doc-structure'], updateMode: 'off' });
    const r = run(proj, home);
    assertGraceful(r);
    assert.ok(!r.stdout.includes('- doc-structure'), r.stdout);
  } finally { clean(home, proj); }
});

test('language lock is appended (prose adapts, terms stay verbatim)', () => {
  const { home, proj } = sandbox();
  try {
    writeProjCfg(proj, { language: 'th' });
    const r = run(proj, home);
    assertGraceful(r);
    assert.ok(r.stdout.includes('(language=th'), r.stdout);
  } finally { clean(home, proj); }
});

test('corrupt project config self-heals to defaults: offers still inject, exit 0 (Phoenix #12)', () => {
  const { home, proj } = sandbox();
  try {
    fs.writeFileSync(path.join(proj, '.coalledger.json'), '{ definitely not json', 'utf8');
    const r = run(proj, home);
    assertGraceful(r);
    assert.ok(r.stdout.includes('doc-structure'));
  } finally { clean(home, proj); }
});

test('updateMode off: canary offers inject, no update line, no stamp', () => {
  const { home, proj } = sandbox();
  try {
    writeProjCfg(proj, { updateMode: 'off' });
    const r = run(proj, home);
    assertGraceful(r);
    assert.ok(r.stdout.includes('doc-structure'));
    assert.ok(!r.stdout.includes('[self-update due]'));
    assert.strictEqual(fs.existsSync(path.join(home, '.claude', '.coalledger-update-check')), false);
  } finally { clean(home, proj); }
});
