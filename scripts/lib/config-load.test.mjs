import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { globalConfigPath, findProjectRoot, loadMergedConfig } from './config-load.mjs';

// realpath'd sandboxes: on macOS os.tmpdir() is a symlink (/var -> /private/var);
// resolving here keeps assertions in the same physical form the walk sees.
function sandbox() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cl-home-')));
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cl-proj-')));
  return { home, proj };
}
function clean(...dirs) {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

test('globalConfigPath honors an explicit home', () => {
  const { home, proj } = sandbox();
  try {
    assert.strictEqual(globalConfigPath(home), path.join(home, '.claude', '.coalledger.json'));
  } finally { clean(home, proj); }
});

test('project config overlays global key-by-key (flat merge)', () => {
  const { home, proj } = sandbox();
  try {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', '.coalledger.json'), '{ "updateCheckDays": 30, "docLeak": true }');
    fs.writeFileSync(path.join(proj, '.coalledger.json'), '// project override\n{ "updateCheckDays": 7 }');
    const cfg = loadMergedConfig({ cwd: proj, home });
    assert.strictEqual(cfg.updateCheckDays, 7, 'project wins');
    assert.strictEqual(cfg.docLeak, true, 'global keys survive');
  } finally { clean(home, proj); }
});

test('the project walk finds the root from a nested cwd and STOPS at home', () => {
  const { home, proj } = sandbox();
  try {
    fs.writeFileSync(path.join(proj, '.coalledger.json'), '{ "updateCheckDays": 7 }');
    const nested = path.join(proj, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    assert.strictEqual(findProjectRoot(nested, home), proj);
    // a dir under home with NO marker anywhere below home: never escapes above home
    const bare = path.join(home, 'work', 'deep');
    fs.mkdirSync(bare, { recursive: true });
    assert.strictEqual(findProjectRoot(bare, home), bare, 'no marker -> falls back to startDir, never above home');
  } finally {
    clean(home, proj);
  }
});

test('a .git marker also roots the project', () => {
  const { home, proj } = sandbox();
  try {
    fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
    const nested = path.join(proj, 'src');
    fs.mkdirSync(nested);
    assert.strictEqual(findProjectRoot(nested, home), proj);
  } finally { clean(home, proj); }
});

test('corrupt, BOM-prefixed, or missing config degrades to {} (never throws)', () => {
  const { home, proj } = sandbox();
  try {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', '.coalledger.json'), '{ not json');
    assert.deepStrictEqual(loadMergedConfig({ cwd: proj, home }), {});
    fs.writeFileSync(path.join(home, '.claude', '.coalledger.json'), String.fromCharCode(0xfeff) + '{ "updateCheckDays": 9 }');
    assert.strictEqual(loadMergedConfig({ cwd: proj, home }).updateCheckDays, 9, 'BOM stripped');
    fs.rmSync(path.join(home, '.claude', '.coalledger.json'));
    assert.deepStrictEqual(loadMergedConfig({ cwd: proj, home }), {});
  } finally { clean(home, proj); }
});

test('a poisoned project config cannot pollute Object.prototype through the merge', () => {
  const { home, proj } = sandbox();
  try {
    fs.writeFileSync(path.join(proj, '.coalledger.json'), '{ "__proto__": { "polluted": true }, "updateCheckDays": 5 }');
    const cfg = loadMergedConfig({ cwd: proj, home });
    assert.strictEqual(cfg.updateCheckDays, 5);
    assert.strictEqual(Object.prototype.polluted, undefined);
  } finally { clean(home, proj); }
});

// --------------------------------------------------------------------------
// Config-cascade clamp (hooks-safety.md §9). The project .coalledger.json
// ARRIVES WITH A CLONED REPO and is untrusted: for the hook-read keys that gate
// consent / spend / an outward action it may QUIETEN, never ESCALATE.
// --------------------------------------------------------------------------

function cascade(home, proj, globalCfg, projectCfg) {
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.coalledger.json'), JSON.stringify(globalCfg));
  fs.writeFileSync(path.join(proj, '.coalledger.json'), JSON.stringify(projectCfg));
  return loadMergedConfig({ cwd: proj, home });
}

test('clamp: a cloned project cannot escalate coalledgerMode off -> auto', () => {
  const { home, proj } = sandbox();
  try {
    assert.strictEqual(cascade(home, proj, { coalledgerMode: 'off' }, { coalledgerMode: 'auto' }).coalledgerMode, 'off');
    // manual is also louder than off
    assert.strictEqual(cascade(home, proj, { coalledgerMode: 'off' }, { coalledgerMode: 'manual' }).coalledgerMode, 'off');
  } finally { clean(home, proj); }
});

test('clamp: a project may QUIETEN coalledgerMode auto -> off (the allowed direction)', () => {
  const { home, proj } = sandbox();
  try {
    assert.strictEqual(cascade(home, proj, { coalledgerMode: 'auto' }, { coalledgerMode: 'off' }).coalledgerMode, 'off');
    assert.strictEqual(cascade(home, proj, { coalledgerMode: 'auto' }, { coalledgerMode: 'manual' }).coalledgerMode, 'manual');
  } finally { clean(home, proj); }
});

test('clamp: a cloned project cannot escalate updateMode off -> auto (spend + outward check)', () => {
  const { home, proj } = sandbox();
  try {
    assert.strictEqual(cascade(home, proj, { updateMode: 'off' }, { updateMode: 'auto' }).updateMode, 'off');
    assert.strictEqual(cascade(home, proj, { updateMode: 'ask' }, { updateMode: 'auto' }).updateMode, 'ask');
    assert.strictEqual(cascade(home, proj, { updateMode: 'auto' }, { updateMode: 'off' }).updateMode, 'off', 'quietening still allowed');
  } finally { clean(home, proj); }
});

test('clamp: CASE-FOLDED — a project "AUTO"/"Off" cannot slip past the lookup (CoalWash H5)', () => {
  const { home, proj } = sandbox();
  try {
    // the schema validates enums case-insensitively, so the clamp must too or
    // the mismatched case falls through to the plain overlay and escalates
    assert.strictEqual(cascade(home, proj, { updateMode: 'off' }, { updateMode: 'AUTO' }).updateMode, 'off');
    assert.strictEqual(cascade(home, proj, { coalledgerMode: 'Off' }, { coalledgerMode: 'Auto' }).coalledgerMode, 'Off');
  } finally { clean(home, proj); }
});

test('clamp: disabledCanaries UNIONs — a project cannot re-enable what global silenced', () => {
  const { home, proj } = sandbox();
  try {
    // ["all"] is the documented silence-everything switch; an empty project list must not revive it
    assert.deepStrictEqual(cascade(home, proj, { disabledCanaries: ['all'] }, { disabledCanaries: [] }).disabledCanaries, ['all']);
    const both = cascade(home, proj, { disabledCanaries: ['doc-leak'] }, { disabledCanaries: ['doc-rot'] }).disabledCanaries;
    assert.deepStrictEqual([...both].sort(), ['doc-leak', 'doc-rot'], 'a project may add more, never remove');
  } finally { clean(home, proj); }
});

test('clamp: an EXPLICIT global is required — with no global key the project is free', () => {
  const { home, proj } = sandbox();
  try {
    assert.strictEqual(cascade(home, proj, {}, { coalledgerMode: 'auto' }).coalledgerMode, 'auto');
    assert.strictEqual(cascade(home, proj, {}, { updateMode: 'auto' }).updateMode, 'auto');
  } finally { clean(home, proj); }
});

test('clamp: docLeak is a BOOLEAN GATE — a project cannot re-enable a globally-off canary offer', () => {
  const { home, proj } = sandbox();
  try {
    // §9: a boolean gating a CAPABILITY is an enum of two; `false` is the safer
    // index. docLeak sits on the SAME conductor filter as disabledCanaries and
    // suppresses the same offer, so guarding one without the other was arbitrary.
    assert.strictEqual(cascade(home, proj, { docLeak: false }, { docLeak: true }).docLeak, false);
    assert.strictEqual(cascade(home, proj, { docLeak: true }, { docLeak: false }).docLeak, false, 'quietening still allowed');
    assert.strictEqual(cascade(home, proj, {}, { docLeak: true }).docLeak, true, 'no explicit global -> project free');
  } finally { clean(home, proj); }
});

test('clamp: docsDriftNudge stays UNCLAMPED — deliberate, by BLAST not type (§9)', () => {
  const { home, proj } = sandbox();
  try {
    // Same TYPE as docLeak, different BLAST: it suppresses one quiet model-only
    // line — no offer, no scan, no spend. Re-enabling it in a single project is
    // a legitimate use. This test exists so the asymmetry is deliberate and
    // locked, not an oversight someone "fixes" later.
    assert.strictEqual(cascade(home, proj, { docsDriftNudge: false }, { docsDriftNudge: true }).docsDriftNudge, true);
  } finally { clean(home, proj); }
});

test('clamp: non-consent keys stay PLAIN project-wins (no over-clamping)', () => {
  const { home, proj } = sandbox();
  try {
    const cfg = cascade(home, proj,
      { updateCheckDays: 30, language: 'en', severityFloor: 'critical', quickVsFull: 'quick', publicMode: false },
      { updateCheckDays: 7, language: 'th', severityFloor: 'low', quickVsFull: 'full', publicMode: true });
    assert.strictEqual(cfg.updateCheckDays, 7, 'numeric spend-RATE: considered and DECLINED by §9, stays plain');
    assert.strictEqual(cfg.language, 'th');
    assert.strictEqual(cfg.severityFloor, 'low');
    assert.strictEqual(cfg.quickVsFull, 'full', 'agent-read, never passes this merge — see the schema/template note');
    assert.strictEqual(cfg.publicMode, true);
  } finally { clean(home, proj); }
});

test('clamp: a genuinely unknown enum value falls through to the overlay (schema clamps downstream)', () => {
  const { home, proj } = sandbox();
  try {
    assert.strictEqual(cascade(home, proj, { updateMode: 'off' }, { updateMode: 'banana' }).updateMode, 'banana');
  } finally { clean(home, proj); }
});
