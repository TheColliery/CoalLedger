// Hermetic spawn tests for the docs memory-drift hook pair (hooks-safety.md §7):
// spawn the REAL hooks as child processes with a sandboxed HOME/TEMP/cwd so real
// session state and the real ~/.claude/.coalledger.json can never leak in. Each
// case asserts the three observable surfaces (hooks-safety.md §7):
//   (1) exit code 0 on every path (Phoenix #4);
//   (2) stderr silent — stdout only on the sanctioned channel (Phoenix #13);
//   (3) the expected state effect (.docs recorded, .docmemmoved satisfier, the
//       quiet systemMessage emit, or nothing).
//
// The pair mirrors CoalMine's rot-canary-touch/-stop, reversed for DOCS:
//   coalledger-doctrack.js  (PostToolUse) records DOC edits + the MEMORY.md satisfier
//   coalledger-drift-stop.js (Stop)       emits ONE quiet drift note, or nothing
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const TRACK = path.join(REPO, 'hooks', 'coalledger-doctrack.js');
const STOP = path.join(REPO, 'hooks', 'coalledger-drift-stop.js');

// A sandbox with three DISTINCT dirs, all siblings under the real os.tmpdir():
//   home = a throwaway ~ (no global .coalledger.json → factory defaults)
//   tmp  = the hook's os.tmpdir() (state lives here; the exclude guard uses it)
//   proj = the project dir (OUTSIDE tmp, so its files are not "under tmpdir");
//          rooted by a .coalledger.json marker for findProjectRoot's stop-walk.
// realpathSync everywhere so macOS /var→/private/var never breaks a lexical compare.
function sandbox() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clg-home-')));
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clg-tmp-')));
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clg-proj-')));
  fs.writeFileSync(path.join(proj, '.coalledger.json'), '{}');
  return { home, tmp, proj };
}
function clean(...dirs) { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); }
function writeProjCfg(proj, cfg) { fs.writeFileSync(path.join(proj, '.coalledger.json'), JSON.stringify(cfg), 'utf8'); }
function withMemory(proj) { fs.writeFileSync(path.join(proj, 'MEMORY.md'), '# project memory\n'); }

function runHook(script, input, tmp, home, cwd) {
  // TEMP/TMP/TMPDIR → the hook's os.tmpdir(); USERPROFILE/HOME → the sandbox ~.
  return spawnSync(process.execPath, [script], {
    input,
    encoding: 'utf8',
    cwd: cwd || tmp,
    env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp, USERPROFILE: home, HOME: home, CLAUDE_CONFIG_DIR: '' },
    timeout: 20000,
  });
}
const trackPayload = (sid, file, cwd) => JSON.stringify({ session_id: sid, cwd, tool_input: { file_path: file } });
const stopPayload = (sid, cwd, extra = {}) => JSON.stringify({ session_id: sid, cwd, ...extra });

function assertGraceful(r) {
  assert.strictEqual(r.status, 0, `hook must exit 0 (stderr: ${r.stderr})`);
  assert.strictEqual(r.stderr, '', 'hook must be silent on stderr (Phoenix #13)');
  assert.strictEqual(r.signal, null, 'hook must not be killed by a signal');
}
// Parse a Stop emit and answer "did it carry the quiet drift note?"
// board #82: the note rides `systemMessage`, never hookSpecificOutput.
// additionalContext — the latter forces an extra agent turn on Stop that
// eats the real `result` under -p --output-format json. Assert both the
// shape used and the shape's ABSENCE, so a future "simplification" back to
// additionalContext fails loud here instead of shipping silently.
function driftEmitted(stdout) {
  const out = JSON.parse((stdout || '{}').trim() || '{}');
  assert.ok(!('decision' in out), 'the docs-drift nudge is QUIET — never decision:block');
  assert.ok(!('hookSpecificOutput' in out), 'board #82: additionalContext on Stop forces a phantom second agent turn — never emit it here');
  return !!(typeof out.systemMessage === 'string' && out.systemMessage.includes('Docs memory-drift'));
}

// --------------------------------------------------------------------------
// Tracker (coalledger-doctrack.js)
// --------------------------------------------------------------------------

test('tracker records a DOC edit into .docs and exits 0', () => {
  const { home, tmp, proj } = sandbox();
  try {
    const r = runHook(TRACK, trackPayload('T1', path.join(proj, 'README.md'), proj), tmp, home, proj);
    assertGraceful(r);
    const docs = path.join(tmp, 'coalledger-T1.docs');
    assert.ok(fs.existsSync(docs), '.docs must be created');
    assert.ok(fs.readFileSync(docs, 'utf8').includes('README.md'));
  } finally { clean(home, tmp, proj); }
});

test('tracker IGNORES a code edit (.js is CoalMine\'s, not CoalLedger\'s — the disjoint no-clash rule)', () => {
  const { home, tmp, proj } = sandbox();
  try {
    const r = runHook(TRACK, trackPayload('T2', path.join(proj, 'app.js'), proj), tmp, home, proj);
    assertGraceful(r);
    assert.strictEqual(fs.existsSync(path.join(tmp, 'coalledger-T2.docs')), false, 'a code file is never a docs-trigger');
    assert.strictEqual(fs.existsSync(path.join(tmp, 'coalledger-T2.docmemmoved')), false);
  } finally { clean(home, tmp, proj); }
});

test('tracker treats MEMORY.md as the SATISFIER (.docmemmoved), never a docs-trigger', () => {
  const { home, tmp, proj } = sandbox();
  try {
    const r = runHook(TRACK, trackPayload('T3', path.join(proj, 'MEMORY.md'), proj), tmp, home, proj);
    assertGraceful(r);
    assert.ok(fs.existsSync(path.join(tmp, 'coalledger-T3.docmemmoved')), 'MEMORY.md writes the satisfier marker');
    assert.strictEqual(fs.existsSync(path.join(tmp, 'coalledger-T3.docs')), false, 'MEMORY.md (a .md) is the record, not doc work');
  } finally { clean(home, tmp, proj); }
});

test('tracker dedups the same doc edited twice (one line)', () => {
  const { home, tmp, proj } = sandbox();
  try {
    runHook(TRACK, trackPayload('T4', path.join(proj, 'README.md'), proj), tmp, home, proj);
    runHook(TRACK, trackPayload('T4', path.join(proj, 'README.md'), proj), tmp, home, proj);
    const lines = fs.readFileSync(path.join(tmp, 'coalledger-T4.docs'), 'utf8').split('\n').filter(Boolean);
    assert.strictEqual(lines.length, 1, 'the same doc is recorded once');
  } finally { clean(home, tmp, proj); }
});

test('tracker ACCUMULATES two DIFFERENT docs across a session (board U13/F2: proves the lstat symlink guard did not break append-accumulate semantics)', () => {
  const { home, tmp, proj } = sandbox();
  try {
    runHook(TRACK, trackPayload('T5', path.join(proj, 'README.md'), proj), tmp, home, proj);
    runHook(TRACK, trackPayload('T5', path.join(proj, 'GUIDE.md'), proj), tmp, home, proj);
    const lines = fs.readFileSync(path.join(tmp, 'coalledger-T5.docs'), 'utf8').split('\n').filter(Boolean);
    assert.strictEqual(lines.length, 2, 'both docs recorded, not just the first (the wx trap named in the code comment)');
    assert.ok(lines.some((l) => l.includes('README.md')));
    assert.ok(lines.some((l) => l.includes('GUIDE.md')));
  } finally { clean(home, tmp, proj); }
});

test('tracker EXCLUDES a doc resident under os.tmpdir() (lab/scratch never ships) — code and MEMORY.md alike', () => {
  const { home, tmp, proj } = sandbox();
  try {
    // A .md and a MEMORY.md living INSIDE the hook's os.tmpdir() (= tmp).
    const r1 = runHook(TRACK, trackPayload('J1', path.join(tmp, 'scratch.md'), proj), tmp, home, proj);
    assertGraceful(r1);
    assert.strictEqual(fs.existsSync(path.join(tmp, 'coalledger-J1.docs')), false, 'a tmp-resident doc is excluded');
    const r2 = runHook(TRACK, trackPayload('J2', path.join(tmp, 'MEMORY.md'), proj), tmp, home, proj);
    assertGraceful(r2);
    assert.strictEqual(fs.existsSync(path.join(tmp, 'coalledger-J2.docmemmoved')), false, 'a tmp-resident MEMORY.md sets no satisfier');
  } finally { clean(home, tmp, proj); }
});

// CWK-054/MED-1 (split per LOW-2: one skippable-or-throwing assertion class
// per behaviour — the original single test's two assertions were SEQUENTIAL,
// so a sabotage that throws on the trigger assertion never reaches the
// satisfier one; INSPECT had to close that gap by probe, not by the suite.
// Two independent tests now, each sabotage-provable on its own: reverting
// doctrack.js's predicate to `if (isUnderTmpdir(normF)) return;` (dropping
// `&& !isUnderTmpdir(findProjectRootLocal(baseDir))`) makes BOTH go red on
// their own assertion line — verified this session, not merely asserted.
test('tracker RECORDS a doc when the PROJECT ITSELF is rooted under os.tmpdir() — board CWK-054/MED-1 (trigger)', () => {
  const { home, tmp, proj } = sandbox();
  try {
    // A CI runner workspace / %TEMP%/claude/<project>/ / container build dir:
    // the WHOLE project lives under the hook's own os.tmpdir(), .git marking
    // it as a real project root (findProjectRootLocal's own marker set).
    // isUnderTmpdir(file) alone would exclude every doc here — the exact
    // defect INSPECT reproduced (probe054.mjs row 2, byte-identical to a
    // true-clean session).
    const tmpProj = path.join(tmp, 'ciworkspace', 'proj');
    fs.mkdirSync(path.join(tmpProj, '.git'), { recursive: true });
    const doc = path.join(tmpProj, 'README.md');
    fs.writeFileSync(doc, '# r\n');
    const r1 = runHook(TRACK, trackPayload('K1', doc, tmpProj), tmp, home, tmpProj);
    assertGraceful(r1);
    const docsFile = path.join(tmp, 'coalledger-K1.docs');
    assert.ok(fs.existsSync(docsFile), 'a doc in a tmp-ROOTED PROJECT must still be tracked (the project is real, only its location is under tmp)');
    assert.ok(fs.readFileSync(docsFile, 'utf8').includes('README.md'));
  } finally { clean(home, tmp, proj); }
});

test('tracker sets the MEMORY.md satisfier when the PROJECT ITSELF is rooted under os.tmpdir() — board CWK-054/MED-1 (satisfier)', () => {
  const { home, tmp, proj } = sandbox();
  try {
    // Independent of the trigger test above — its own tmp-rooted project, own
    // sid — so this branch fails (or passes) entirely on its own assertion,
    // never masked by an earlier throw in the same test. The satisfier sits
    // behind the SAME shared gate as the trigger; it must stay consistent
    // with it or a tmp-rooted session could record drift but never clear it.
    const tmpProj = path.join(tmp, 'ciworkspace', 'proj2');
    fs.mkdirSync(path.join(tmpProj, '.git'), { recursive: true });
    const mem = path.join(tmpProj, 'MEMORY.md');
    fs.writeFileSync(mem, '# mem\n');
    const r2 = runHook(TRACK, trackPayload('K2', mem, tmpProj), tmp, home, tmpProj);
    assertGraceful(r2);
    assert.ok(fs.existsSync(path.join(tmp, 'coalledger-K2.docmemmoved')), 'MEMORY.md in a tmp-rooted project must still set the satisfier');
  } finally { clean(home, tmp, proj); }
});

test('tracker: a <tmp>-PREFIX sibling dir is NOT wrongly excluded (boundary-safe)', () => {
  const { home, tmp, proj } = sandbox();
  const sibling = tmp + 'X'; // shares the tmp prefix but is a different dir
  try {
    fs.mkdirSync(sibling, { recursive: true });
    const r = runHook(TRACK, trackPayload('J3', path.join(sibling, 'README.md'), proj), tmp, home, proj);
    assertGraceful(r);
    assert.ok(fs.existsSync(path.join(tmp, 'coalledger-J3.docs')), '"<tmp>X" must not match "<tmp>"');
  } finally { clean(home, tmp, proj, sibling); }
});

test('tracker: garbage stdin → exit 0, silent, no state (Phoenix #12)', () => {
  const { home, tmp, proj } = sandbox();
  try {
    const r = runHook(TRACK, 'definitely not json', tmp, home, proj);
    assertGraceful(r);
    assert.strictEqual(fs.readdirSync(tmp).filter((f) => f.startsWith('coalledger-')).length, 0);
  } finally { clean(home, tmp, proj); }
});

test('tracker: a traversal-shaped session_id records nothing outside the sandbox (Phoenix #10)', () => {
  const { home, tmp, proj } = sandbox();
  const evil = '../../../etc/clg-doctrack-target';
  const escaped = path.join(tmp, 'coalledger-' + evil) + '.docs'; // would resolve OUTSIDE tmp
  try {
    const r = runHook(TRACK, trackPayload(evil, path.join(proj, 'README.md'), proj), tmp, home, proj);
    assertGraceful(r);
    assert.strictEqual(fs.existsSync(escaped), false, 'a traversal sid must escape nothing');
  } finally { clean(home, tmp, proj); }
});

// --------------------------------------------------------------------------
// Stop nudge (coalledger-drift-stop.js) — end-to-end with the real tracker
// --------------------------------------------------------------------------

test('Stop emits the QUIET drift note when docs changed, MEMORY.md was not updated, and a root MEMORY.md exists', () => {
  const { home, tmp, proj } = sandbox();
  try {
    withMemory(proj);
    runHook(TRACK, trackPayload('D1', path.join(proj, 'README.md'), proj), tmp, home, proj);
    const r = runHook(STOP, stopPayload('D1', proj), tmp, home, proj);
    assertGraceful(r);
    assert.ok(driftEmitted(r.stdout), `expected the quiet systemMessage note, got: ${r.stdout}`);
    // once-per-session: state cleaned up after the emit
    assert.strictEqual(fs.existsSync(path.join(tmp, 'coalledger-D1.docs')), false, 'state cleaned after emit');
  } finally { clean(home, tmp, proj); }
});

test('Stop emits via systemMessage, never hookSpecificOutput.additionalContext (board #82 — the latter forces a second agent turn under -p and eats the real result)', () => {
  const { home, tmp, proj } = sandbox();
  try {
    withMemory(proj);
    runHook(TRACK, trackPayload('D1c', path.join(proj, 'README.md'), proj), tmp, home, proj);
    const r = runHook(STOP, stopPayload('D1c', proj), tmp, home, proj);
    assertGraceful(r);
    const out = JSON.parse(r.stdout.trim());
    // (a) the sanctioned advisory still fires — nothing was muted.
    assert.strictEqual(typeof out.systemMessage, 'string', `systemMessage must be present, got: ${r.stdout}`);
    assert.ok(out.systemMessage.length > 0, 'systemMessage must be non-empty');
    // (b) the specific field proven to force the phantom second turn is gone.
    assert.ok(!('hookSpecificOutput' in out), `hookSpecificOutput must be absent, got: ${r.stdout}`);
    assert.ok(!('decision' in out), `decision must be absent, got: ${r.stdout}`);
  } finally { clean(home, tmp, proj); }
});

test('Stop drift note ROUTES the action (board #25): still names the fact, no longer commands a forbidden write', () => {
  const { home, tmp, proj } = sandbox();
  try {
    withMemory(proj);
    runHook(TRACK, trackPayload('D1b', path.join(proj, 'README.md'), proj), tmp, home, proj);
    const r = runHook(STOP, stopPayload('D1b', proj), tmp, home, proj);
    assertGraceful(r);
    assert.ok(driftEmitted(r.stdout), `expected the quiet systemMessage note, got: ${r.stdout}`);
    const out = JSON.parse(r.stdout);
    const line = out.systemMessage;
    assert.ok(line.includes('report the drift'), `expected the station-worker routing clause, got: ${line}`);
    assert.ok(!line.includes('if this doc work is worth keeping, update the project MEMORY/status line before ending'), `the old unconditional imperative must be GONE, not just supplemented, got: ${line}`);
  } finally { clean(home, tmp, proj); }
});

test('Stop is SILENT when MEMORY.md WAS updated this session (the satisfier clears the drift)', () => {
  const { home, tmp, proj } = sandbox();
  try {
    withMemory(proj);
    runHook(TRACK, trackPayload('D2', path.join(proj, 'README.md'), proj), tmp, home, proj); // .docs
    runHook(TRACK, trackPayload('D2', path.join(proj, 'MEMORY.md'), proj), tmp, home, proj); // .docmemmoved
    const r = runHook(STOP, stopPayload('D2', proj), tmp, home, proj);
    assertGraceful(r);
    assert.strictEqual(driftEmitted(r.stdout), false, 'record updated → no nudge');
  } finally { clean(home, tmp, proj); }
});

test('Stop is SILENT when the project has no root MEMORY.md (it does not use the convention)', () => {
  const { home, tmp, proj } = sandbox();
  try {
    // no withMemory(proj)
    runHook(TRACK, trackPayload('D3', path.join(proj, 'README.md'), proj), tmp, home, proj);
    const r = runHook(STOP, stopPayload('D3', proj), tmp, home, proj);
    assertGraceful(r);
    assert.strictEqual(driftEmitted(r.stdout), false, 'no MEMORY.md convention → no nudge');
  } finally { clean(home, tmp, proj); }
});

test('Stop is SILENT when no docs were recorded (a code-only or empty session)', () => {
  const { home, tmp, proj } = sandbox();
  try {
    withMemory(proj);
    const r = runHook(STOP, stopPayload('D4', proj), tmp, home, proj); // tracker never ran
    assertGraceful(r);
    assert.strictEqual(driftEmitted(r.stdout), false, 'no doc work → no nudge');
  } finally { clean(home, tmp, proj); }
});

test('Stop off-switch: docsDriftNudge=false silences the nudge', () => {
  const { home, tmp, proj } = sandbox();
  try {
    withMemory(proj);
    runHook(TRACK, trackPayload('D5', path.join(proj, 'README.md'), proj), tmp, home, proj);
    writeProjCfg(proj, { docsDriftNudge: false });
    const r = runHook(STOP, stopPayload('D5', proj), tmp, home, proj);
    assertGraceful(r);
    assert.strictEqual(driftEmitted(r.stdout), false, 'docsDriftNudge:false → silent');
  } finally { clean(home, tmp, proj); }
});

test('Stop off-switch: coalledgerMode=off silences the nudge', () => {
  const { home, tmp, proj } = sandbox();
  try {
    withMemory(proj);
    runHook(TRACK, trackPayload('D6', path.join(proj, 'README.md'), proj), tmp, home, proj);
    writeProjCfg(proj, { coalledgerMode: 'off' });
    const r = runHook(STOP, stopPayload('D6', proj), tmp, home, proj);
    assertGraceful(r);
    assert.strictEqual(driftEmitted(r.stdout), false, 'master off → silent');
  } finally { clean(home, tmp, proj); }
});

test("Stop off-switch: disabledCanaries ['all'] silences the nudge", () => {
  const { home, tmp, proj } = sandbox();
  try {
    withMemory(proj);
    runHook(TRACK, trackPayload('D7', path.join(proj, 'README.md'), proj), tmp, home, proj);
    writeProjCfg(proj, { disabledCanaries: ['all'] });
    const r = runHook(STOP, stopPayload('D7', proj), tmp, home, proj);
    assertGraceful(r);
    assert.strictEqual(driftEmitted(r.stdout), false, "['all'] → silent");
  } finally { clean(home, tmp, proj); }
});

test('Stop: stop_hook_active loop guard → no emit', () => {
  const { home, tmp, proj } = sandbox();
  try {
    withMemory(proj);
    runHook(TRACK, trackPayload('D8', path.join(proj, 'README.md'), proj), tmp, home, proj);
    const r = runHook(STOP, stopPayload('D8', proj, { stop_hook_active: true }), tmp, home, proj);
    assertGraceful(r);
    assert.strictEqual(driftEmitted(r.stdout), false, 'a re-entrant stop must not re-nudge');
  } finally { clean(home, tmp, proj); }
});

test('Stop is idempotent: a second stop of the same session does not re-emit (state cleaned)', () => {
  const { home, tmp, proj } = sandbox();
  try {
    withMemory(proj);
    runHook(TRACK, trackPayload('D9', path.join(proj, 'README.md'), proj), tmp, home, proj);
    const r1 = runHook(STOP, stopPayload('D9', proj), tmp, home, proj);
    assert.ok(driftEmitted(r1.stdout));
    const r2 = runHook(STOP, stopPayload('D9', proj), tmp, home, proj);
    assertGraceful(r2);
    assert.strictEqual(driftEmitted(r2.stdout), false, 'state gone → no second nudge');
  } finally { clean(home, tmp, proj); }
});

// REGRESSION (review 2026-07-25, HIGH): CC's Stop fires per RESPONSE, not once
// per session, so the SATISFIER must survive the stop that consumed it. The
// earlier cleanup() wiped .docmemmoved at every stop → a turn-2 doc edit
// nudged falsely in a session where MEMORY.md demonstrably WAS updated. The
// pre-existing stop tests were blind to it: none interleaves an edit BETWEEN
// two stops (D9 = two stops, no edit between).
test('Stop: the satisfier SURVIVES a stop — MEMORY.md in turn 1 keeps turn 2 silent (per-response Stop cadence)', () => {
  const { home, tmp, proj } = sandbox();
  try {
    withMemory(proj);
    // turn 1: record updated + doc edited → stop is correctly silent
    runHook(TRACK, trackPayload('R1', path.join(proj, 'MEMORY.md'), proj), tmp, home, proj);
    runHook(TRACK, trackPayload('R1', path.join(proj, 'README.md'), proj), tmp, home, proj);
    const r1 = runHook(STOP, stopPayload('R1', proj), tmp, home, proj);
    assertGraceful(r1);
    assert.strictEqual(driftEmitted(r1.stdout), false, 'turn 1: record updated → silent');
    // turn 2: MORE doc work, same session, MEMORY.md already updated
    runHook(TRACK, trackPayload('R1', path.join(proj, 'GUIDE.md'), proj), tmp, home, proj);
    const r2 = runHook(STOP, stopPayload('R1', proj), tmp, home, proj);
    assertGraceful(r2);
    assert.strictEqual(driftEmitted(r2.stdout), false, 'turn 2 must NOT nudge — the session DID update MEMORY.md');
  } finally { clean(home, tmp, proj); }
});

test('Stop: garbage stdin → exit 0, silent (Phoenix #12)', () => {
  const { home, tmp, proj } = sandbox();
  try {
    const r = runHook(STOP, 'definitely not json', tmp, home, proj);
    assertGraceful(r);
    assert.strictEqual(r.stdout, '', 'no output on garbage input');
  } finally { clean(home, tmp, proj); }
});

// --------------------------------------------------------------------------
// The whole no-clash story, end to end.
// --------------------------------------------------------------------------

test('disjoint end-to-end: a session editing BOTH code and a doc — CL records only the doc, and drifts on it', () => {
  const { home, tmp, proj } = sandbox();
  try {
    withMemory(proj);
    runHook(TRACK, trackPayload('MIX', path.join(proj, 'app.js'), proj), tmp, home, proj);     // CM's job — CL ignores
    runHook(TRACK, trackPayload('MIX', path.join(proj, 'GUIDE.md'), proj), tmp, home, proj);   // CL records
    const docs = fs.readFileSync(path.join(tmp, 'coalledger-MIX.docs'), 'utf8');
    assert.ok(docs.includes('GUIDE.md'), 'the doc is recorded');
    assert.ok(!docs.includes('app.js'), 'the code file is NOT in CL\'s state (disjoint from CoalMine)');
    const r = runHook(STOP, stopPayload('MIX', proj), tmp, home, proj);
    assertGraceful(r);
    assert.ok(driftEmitted(r.stdout), 'the doc half drives CL\'s nudge; the code half is CoalMine\'s');
  } finally { clean(home, tmp, proj); }
});
