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
import { createRequire } from 'node:module';
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
// Namespace campaign (#69+#39, owner-designated 2026-08-08): the update-check
// stamp's new home + the pre-campaign path it migrates from.
function stampPath(home) { return path.join(home, '.claude', 'coal', 'coalledger', 'update-check'); }
function oldStampPath(home) { return path.join(home, '.claude', '.coalledger-update-check'); }
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
    assert.strictEqual(fs.existsSync(stampPath(home)), false, 'no stamp in off mode');
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
    assert.ok(fs.existsSync(stampPath(home)), 'crash-safe stamp written to the new namespace-campaign home');
  } finally { clean(home, proj); }
});

test('update stamp: read-new-fallback-old — a recent OLD-path stamp still throttles (migration read)', () => {
  const { home, proj } = sandbox();
  try {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(oldStampPath(home), String(Date.now()));
    const r = run(proj, home);
    assertGraceful(r);
    assert.ok(!r.stdout.includes('[self-update due]'), 'a recent OLD-path stamp still throttles the check');
  } finally { clean(home, proj); }
});

test('update stamp: write-new-drop-old — a stale OLD-path stamp does not throttle, and gets migrated on write', () => {
  const { home, proj } = sandbox();
  try {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    const old = oldStampPath(home);
    fs.writeFileSync(old, String(Date.now() - 999 * 24 * 60 * 60 * 1000)); // ancient, past any throttle window
    const r = run(proj, home);
    assertGraceful(r);
    assert.ok(r.stdout.includes('[self-update due]'), 'a stale OLD-path stamp does not throttle -- due fires');
    assert.ok(fs.existsSync(stampPath(home)), 'the new path now holds the value');
    assert.strictEqual(fs.existsSync(old), false, 'the old path is deleted (no-old-version-leftover)');
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
    assert.strictEqual(fs.existsSync(stampPath(home)), false);
  } finally { clean(home, proj); }
});

// ---------------------------------------------------------------------------
// Antigravity adapter (hooks/ag-conductor.js) — hermetic spawn tests. Same
// three observable surfaces; plus the AG-specific state: the once-per-session
// marker under os.tmpdir()/coalledger (TMPDIR/TEMP/TMP sandboxed so real
// markers never leak in) and the sanctioned single-line injectSteps JSON emit
// (the current PreInvocation output contract, re-derived 2026-07-23 — the
// pilot-era additionalContext key is a dead letter and must never appear).
// ---------------------------------------------------------------------------

const AG_HOOK = path.join(REPO, 'hooks', 'ag-conductor.js');

function agSandbox() {
  const { home, proj } = sandbox();
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clg-tmp-')));
  return { home, proj, tmp };
}
function agRun(cwd, home, tmp, stdinText) {
  return spawnSync(process.execPath, [AG_HOOK, 'PreInvocation'], {
    cwd,
    input: stdinText,
    env: { ...process.env, HOME: home, USERPROFILE: home, TEMP: tmp, TMP: tmp, TMPDIR: tmp, CLAUDE_CONFIG_DIR: '' },
    encoding: 'utf8',
    timeout: 20000,
  });
}
function markerFiles(tmp) {
  const dir = path.join(tmp, 'coalledger');
  try { return fs.readdirSync(dir).filter((n) => n.endsWith('.marker')); } catch { return []; }
}
// Must mirror the hook's djb2 (test-only duplicate, for the plant test below).
function djb2(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0);
  return h.toString(36);
}
const payload = (sid, cwd) => JSON.stringify({ session_id: sid, cwd });

// The sanctioned AG PreInvocation output (contract re-derived 2026-07-23):
// exactly {"injectSteps":[{"ephemeralMessage": ...}]} — the key-set asserts
// also prove the dead additionalContext key never reappears.
function agInject(stdout) {
  const obj = JSON.parse(stdout.trim());
  assert.deepStrictEqual(Object.keys(obj), ['injectSteps'], 'injectSteps is the ONLY key (current AG PreInvocation output contract)');
  assert.strictEqual(obj.injectSteps.length, 1, 'exactly one injected step');
  assert.deepStrictEqual(Object.keys(obj.injectSteps[0]), ['ephemeralMessage'], 'ephemeralMessage (transient system message) is the step type');
  return obj.injectSteps[0].ephemeralMessage;
}

test('AG: first PreInvocation emits ONE-line injectSteps/ephemeralMessage JSON with the offers + creates the session marker; no self-update, no stamp', () => {
  const { home, proj, tmp } = agSandbox();
  try {
    const r = agRun(proj, home, tmp, payload('s-basic', proj));
    assertGraceful(r);
    const lines = r.stdout.split('\n').filter(Boolean);
    assert.strictEqual(lines.length, 1, `single-line JSON emit, got: ${r.stdout}`);
    const msg = agInject(lines[0]);
    assert.ok(msg.includes('[CoalLedger] docs-health canary suite installed'));
    for (const c of ALL_CANARIES) assert.ok(msg.includes(`- ${c} (`), `${c} offered on AG`);
    assert.ok(!msg.includes('[self-update due]'), 'KIND 1 is not ported to AG');
    assert.strictEqual(fs.existsSync(stampPath(home)), false, 'no CC update stamp consumed on AG');
    assert.strictEqual(markerFiles(tmp).length, 1, 'once-per-session marker created');
  } finally { clean(home, proj, tmp); }
});

test('AG: second PreInvocation of the same session is fully silent (marker latch)', () => {
  const { home, proj, tmp } = agSandbox();
  try {
    assertGraceful(agRun(proj, home, tmp, payload('s-latch', proj)));
    const r2 = agRun(proj, home, tmp, payload('s-latch', proj));
    assertGraceful(r2);
    assert.strictEqual(r2.stdout, '', 'no re-injection per model call');
    assert.strictEqual(markerFiles(tmp).length, 1);
  } finally { clean(home, proj, tmp); }
});

test('AG: a different session key injects again (per-session, not global)', () => {
  const { home, proj, tmp } = agSandbox();
  try {
    assertGraceful(agRun(proj, home, tmp, payload('s-one', proj)));
    const r2 = agRun(proj, home, tmp, payload('s-two', proj));
    assertGraceful(r2);
    assert.ok(agInject(r2.stdout).includes('[CoalLedger]'));
    assert.strictEqual(markerFiles(tmp).length, 2);
  } finally { clean(home, proj, tmp); }
});

test('AG: garbage stdin -> silent, exit 0, no marker (Phoenix #12)', () => {
  const { home, proj, tmp } = agSandbox();
  try {
    const r = agRun(proj, home, tmp, 'definitely not json');
    assertGraceful(r);
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(markerFiles(tmp).length, 0);
  } finally { clean(home, proj, tmp); }
});

test('AG: payload without a session key -> silent (an unkeyed injection would repeat per model call)', () => {
  const { home, proj, tmp } = agSandbox();
  try {
    const r = agRun(proj, home, tmp, JSON.stringify({ cwd: proj }));
    assertGraceful(r);
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(markerFiles(tmp).length, 0);
  } finally { clean(home, proj, tmp); }
});

test('AG: coalledgerMode off at the payload cwd -> no emit (marker still latches: config is read once per session)', () => {
  const { home, proj, tmp } = agSandbox();
  try {
    writeProjCfg(proj, { coalledgerMode: 'off' });
    const r = agRun(proj, home, tmp, payload('s-off', proj));
    assertGraceful(r);
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(markerFiles(tmp).length, 1, 'marker before config read (spares per-call imports)');
  } finally { clean(home, proj, tmp); }
});

test('AG: manual mode -> silent (offers gated; the self-update nudge is deliberately not ported)', () => {
  const { home, proj, tmp } = agSandbox();
  try {
    // UMB-133: configured at the CANONICAL path. This test used a ROOT-legacy
    // config, which now (correctly) emits the one-line migration notice even in
    // manual mode — covered by its own test below. The legacy anchor sandbox()
    // drops in stays, shadowed by the canonical file (canonical wins, no notice).
    const canon = path.join(proj, '.claude', 'coal', 'coalledger.json');
    fs.mkdirSync(path.dirname(canon), { recursive: true });
    fs.writeFileSync(canon, JSON.stringify({ coalledgerMode: 'manual' }), 'utf8');
    const r = agRun(proj, home, tmp, payload('s-manual', proj));
    assertGraceful(r);
    assert.strictEqual(r.stdout, '');
  } finally { clean(home, proj, tmp); }
});

test('AG: payload.cwd is authoritative for config — spawn cwd elsewhere, project config still honored', () => {
  const { home, proj, tmp } = agSandbox();
  try {
    writeProjCfg(proj, { docLeak: false });
    const r = agRun(home, home, tmp, payload('s-cwd', proj)); // spawn cwd = home, NOT the project
    assertGraceful(r);
    const msg = agInject(r.stdout);
    assert.ok(msg.includes('- doc-structure ('), 'offers present');
    assert.ok(!msg.includes('- doc-leak ('), 'docLeak:false read from the payload cwd, not the spawn cwd');
  } finally { clean(home, proj, tmp); }
});

// CURRENT AG spec payload (re-derived 2026-07-23): conversationId +
// workspacePaths[] — no cwd, no session_id. The adapter must key the marker on
// conversationId and feed workspacePaths[0] into loadMergedConfig({ cwd }).
test('AG: current-spec payload (conversationId + workspacePaths) -> config honored from workspacePaths[0], conversationId latches', () => {
  const { home, proj, tmp } = agSandbox();
  try {
    writeProjCfg(proj, { docLeak: false });
    const stdin = JSON.stringify({ conversationId: 'conv-spec', workspacePaths: [proj] });
    const r = agRun(home, home, tmp, stdin); // spawn cwd = home, NOT the project
    assertGraceful(r);
    const msg = agInject(r.stdout);
    assert.ok(msg.includes('- doc-structure ('), 'a current-spec payload (no cwd/session_id) still injects');
    assert.ok(!msg.includes('- doc-leak ('), 'workspacePaths[0] drives the project-config walk (the current spec ships no cwd field)');
    const r2 = agRun(home, home, tmp, stdin);
    assertGraceful(r2);
    assert.strictEqual(r2.stdout, '', 'conversationId keys the once-per-session latch');
    assert.strictEqual(markerFiles(tmp).length, 1);
  } finally { clean(home, proj, tmp); }
});

test('AG: pre-planted marker file (EEXIST) -> fail-closed, no emit', () => {
  const { home, proj, tmp } = agSandbox();
  try {
    const markerDir = path.join(tmp, 'coalledger');
    fs.mkdirSync(markerDir, { recursive: true });
    fs.writeFileSync(path.join(markerDir, `ag-conductor-${djb2('s-plant')}.marker`), '');
    const r = agRun(proj, home, tmp, payload('s-plant', proj));
    assertGraceful(r);
    assert.strictEqual(r.stdout, '', 'planted marker suppresses the emit (wx create fails atomically)');
  } finally { clean(home, proj, tmp); }
});

test('AG: unwritable tmp (tmpdir points at a FILE) -> fail-closed silent, exit 0', () => {
  const { home, proj, tmp } = agSandbox();
  const asFile = path.join(tmp, 'not-a-dir');
  try {
    fs.writeFileSync(asFile, '');
    const r = agRun(proj, home, asFile, payload('s-nowrite', proj));
    assertGraceful(r);
    assert.strictEqual(r.stdout, '', 'marker cannot persist -> advisory payload skipped (fail-closed)');
  } finally { clean(home, proj, tmp); }
});

test('AG: language lock rides the emit', () => {
  const { home, proj, tmp } = agSandbox();
  try {
    writeProjCfg(proj, { language: 'th' });
    const r = agRun(proj, home, tmp, payload('s-lang', proj));
    assertGraceful(r);
    assert.ok(agInject(r.stdout).includes('(language=th'), r.stdout);
  } finally { clean(home, proj, tmp); }
});

// ---------------------------------------------------------------------------
// UMB-133 — the config-path notices, through BOTH conductors. buildOffers takes
// them as a third parameter (default []), each caller computes them from its
// own cwd, so the one shared assembly serves CC and AG by construction.
// One discriminating assertion per test.
// ---------------------------------------------------------------------------
const CANON_REL = '.claude/coal/coalledger.json';
const ignoredLine = (p) => `[CoalLedger] IGNORED: ${p} is not a config path; canonical = ${CANON_REL}`;
const legacyLine = (p) => `[CoalLedger] LEGACY: ${p} is a deprecated config path (still read); move it to ${CANON_REL}`;
function writeCanonCfg(proj, cfg) {
  const f = path.join(proj, '.claude', 'coal', 'coalledger.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(cfg), 'utf8');
}

test('UMB-133 CC: a LEGACY-anchored project (auto mode) gets the ONE migration line', () => {
  const { home, proj } = sandbox(); // sandbox() anchors the project with the ROOT legacy .coalledger.json
  try {
    const r = run(proj, home);
    assertGraceful(r);
    assert.ok(r.stdout.split('\n').includes(legacyLine(path.join(proj, '.coalledger.json'))), r.stdout);
  } finally { clean(home, proj); }
});

test('UMB-133 CC: a config at a path nothing reads is NAMED with the exact IGNORED line', () => {
  const { home, proj } = sandbox();
  try {
    const stray = path.join(proj, 'coalledger.json'); // the dropped-dot typo
    fs.writeFileSync(stray, '{ "coalledgerMode": "off" }');
    const r = run(proj, home);
    assertGraceful(r);
    assert.ok(r.stdout.split('\n').includes(ignoredLine(stray)), r.stdout);
  } finally { clean(home, proj); }
});

test('UMB-133 CC: silence — a canonical config and no stray file -> NO notice line', () => {
  const { home, proj } = sandbox();
  try {
    fs.rmSync(path.join(proj, '.coalledger.json')); // drop the legacy anchor
    writeCanonCfg(proj, {});
    const r = run(proj, home);
    assertGraceful(r);
    assert.strictEqual(/^\[CoalLedger\] (LEGACY|IGNORED): /m.test(r.stdout), false, r.stdout);
  } finally { clean(home, proj); }
});

test('UMB-133 CC: MANUAL mode still says so — the notice is the only config line, offers stay silent', () => {
  const { home, proj } = sandbox();
  try {
    writeProjCfg(proj, { coalledgerMode: 'manual' }); // a ROOT legacy config
    const r = run(proj, home);
    assertGraceful(r);
    assert.ok(r.stdout.split('\n').includes(legacyLine(path.join(proj, '.coalledger.json'))), r.stdout);
  } finally { clean(home, proj); }
});

test('UMB-133 CC: the Phoenix #13 CEILING — mode off stays fully silent even with a stray file present', () => {
  const { home, proj } = sandbox();
  try {
    writeProjCfg(proj, { coalledgerMode: 'off' });
    fs.writeFileSync(path.join(proj, 'coalledger.json'), '{}');
    const r = run(proj, home);
    assertGraceful(r);
    assert.strictEqual(r.stdout, '');
  } finally { clean(home, proj); }
});

test('UMB-133 CC: a config at the NESTED legacy is honoured — its VALUES reach the conductor (mode off there -> silent)', () => {
  const { home, proj } = sandbox();
  try {
    fs.rmSync(path.join(proj, '.coalledger.json'));
    const nested = path.join(proj, '.claude', '.coalledger.json');
    fs.mkdirSync(path.dirname(nested), { recursive: true });
    fs.writeFileSync(nested, JSON.stringify({ coalledgerMode: 'off' }));
    const r = run(proj, home);
    assertGraceful(r);
    assert.strictEqual(r.stdout, '', 'before UMB-133 this file was silently dead and the conductor ran in auto mode');
  } finally { clean(home, proj); }
});

test('UMB-133 AG: MANUAL mode with a LEGACY config emits the migration line inside the one-line injectSteps JSON', () => {
  const { home, proj, tmp } = agSandbox();
  try {
    writeProjCfg(proj, { coalledgerMode: 'manual' }); // a ROOT legacy config
    const r = agRun(proj, home, tmp, payload('s-legacy', proj));
    assertGraceful(r);
    assert.ok(agInject(r.stdout.split('\n').filter(Boolean)[0]).split('\n').includes(legacyLine(path.join(proj, '.coalledger.json'))), r.stdout);
  } finally { clean(home, proj, tmp); }
});

test('UMB-133 AG: a stray file is NAMED, computed from the PAYLOAD workspace — spawn cwd elsewhere', () => {
  const { home, proj, tmp } = agSandbox();
  try {
    const stray = path.join(proj, '.claude', 'coalledger.json'); // missing coal/
    fs.mkdirSync(path.dirname(stray), { recursive: true });
    fs.writeFileSync(stray, '{}');
    const r = agRun(home, home, tmp, payload('s-stray', proj)); // spawn cwd = home, NOT the project
    assertGraceful(r);
    assert.ok(agInject(r.stdout.split('\n').filter(Boolean)[0]).split('\n').includes(ignoredLine(stray)), r.stdout);
  } finally { clean(home, proj, tmp); }
});

test('UMB-133 AG: the Phoenix #13 CEILING — mode off stays fully silent even with a stray file present', () => {
  const { home, proj, tmp } = agSandbox();
  try {
    writeProjCfg(proj, { coalledgerMode: 'off' });
    fs.writeFileSync(path.join(proj, 'coalledger.json'), '{}');
    const r = agRun(proj, home, tmp, payload('s-off-stray', proj));
    assertGraceful(r);
    assert.strictEqual(r.stdout, '');
  } finally { clean(home, proj, tmp); }
});

// buildOffers' third parameter, directly (the shared assembly both platforms call).
const require_ = createRequire(import.meta.url);
const { buildOffers: buildOffersDirect } = require_(path.join(REPO, 'hooks', 'coalledger-conductor.js'));
const passthroughRead = (cfg, k) => cfg[k];
// The third parameter is a THUNK since bounce-1 F4 (an array is no longer
// accepted — see buildOffers' own comment for why the union was refused).
test('UMB-133 buildOffers: the notices are appended AFTER the offer block', () => {
  const out = buildOffersDirect({ coalledgerMode: 'auto', disabledCanaries: [], docLeak: true }, passthroughRead, () => ['N1', 'N2']);
  assert.deepStrictEqual(out.slice(-2), ['N1', 'N2']);
});

test('UMB-133 buildOffers: a caller passing NO third argument is unchanged (no thunk = no notices, every existing caller stays valid)', () => {
  const cfg = { coalledgerMode: 'manual', disabledCanaries: [], docLeak: true };
  assert.deepStrictEqual(buildOffersDirect(cfg, passthroughRead), []);
});

test('UMB-133 buildOffers: gated fully off returns null WITHOUT surfacing notices (the consent gate stays)', () => {
  assert.strictEqual(buildOffersDirect({ coalledgerMode: 'off', disabledCanaries: [] }, passthroughRead, () => ['N1']), null);
});

// ---------------------------------------------------------------------------
// UMB-133 bounce-1 F4: the notices are LAZY. Building them costs a root walk
// plus up to ten stats, and a conductor gated fully off returns null before it
// ever uses them — so an off-mode user was paying for output nobody sees
// ("silent ✓, free ✗"). The thunk is resolved INSIDE the one shared gate, past
// both null-returns; the mode/disabled check is NOT duplicated in the two
// callers, which is the whole reason buildOffers is shared. Phoenix #4's
// fail-silent wrap moves with the call.
// One discriminating assertion per test.
// ---------------------------------------------------------------------------
test('UMB-133 F4: the notices THUNK is resolved past the gates and appended after the offer block', () => {
  let calls = 0;
  const out = buildOffersDirect({ coalledgerMode: 'auto', disabledCanaries: [], docLeak: true }, passthroughRead, () => { calls++; return ['N1']; });
  assert.deepStrictEqual([calls, out.slice(-1)], [1, ['N1']]);
});

test('UMB-133 F4: a THROWING notices thunk never reaches the caller (Phoenix #4 travels with the call)', () => {
  const cfg = { coalledgerMode: 'manual', disabledCanaries: [], docLeak: true };
  assert.deepStrictEqual(buildOffersDirect(cfg, passthroughRead, () => { throw new Error('boom'); }), []);
});

test('UMB-133 F4: mode off never RESOLVES the thunk — the probe is not PAID, not merely not printed (REGRESSION GUARD: not discriminating on its own, it passed before the fix too)', () => {
  let calls = 0;
  buildOffersDirect({ coalledgerMode: 'off', disabledCanaries: [] }, passthroughRead, () => { calls++; return ['N1']; });
  assert.strictEqual(calls, 0);
});

test('UMB-133 F4: a conductor silenced through disabledCanaries never resolves the thunk either (the second gate)', () => {
  let calls = 0;
  buildOffersDirect({ coalledgerMode: 'auto', disabledCanaries: ['conductor'] }, passthroughRead, () => { calls++; return ['N1']; });
  assert.strictEqual(calls, 0);
});

test('UMB-133 F4: BOTH conductor callers pass a THUNK, never a precomputed array (the defect lived in the CALLERS, not the assembly)', () => {
  const eager = [];
  for (const rel of [path.join('hooks', 'coalledger-conductor.js'), path.join('hooks', 'ag-conductor.js')]) {
    const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
    if (!/buildOffers\(cfg, clampedRead, \(\) => configNotices\(/.test(src)) eager.push(rel);
  }
  assert.deepStrictEqual(eager, []);
});
