import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globalConfigPath, findProjectRoot, projectConfigCandidates, projectConfigPath, loadMergedConfig } from './config-load.mjs';

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

// --------------------------------------------------------------------------
// Namespace campaign (#69+#39, owner-designated 2026-08-08): per-project
// config moves under an agent dir. Read order: own-dir (.claude) -> other
// known agent dirs (.agents -> .gemini) -> LEGACY root dotfile, first-found-
// wins; absent everywhere -> own-dir is both the read and write target.
// --------------------------------------------------------------------------

test('projectConfigCandidates: ordered list, agent dirs first (fixed order), legacy last', () => {
  const { home, proj } = sandbox();
  try {
    assert.deepStrictEqual(projectConfigCandidates(proj, home), [
      path.join(proj, '.claude', 'coal', 'coalledger.json'),
      path.join(proj, '.agents', 'coal', 'coalledger.json'),
      path.join(proj, '.gemini', 'coal', 'coalledger.json'),
      path.join(proj, '.coalledger.json'),
    ]);
  } finally { clean(home, proj); }
});

test('projectConfigPath: own-dir (.claude) wins when multiple candidates exist', () => {
  const { home, proj } = sandbox();
  try {
    for (const rel of [path.join('.claude', 'coal', 'coalledger.json'), path.join('.agents', 'coal', 'coalledger.json'), '.coalledger.json']) {
      const full = path.join(proj, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '{}');
    }
    assert.strictEqual(projectConfigPath(proj, home), path.join(proj, '.claude', 'coal', 'coalledger.json'));
  } finally { clean(home, proj); }
});

test('projectConfigPath: another agent dir (.agents) resolves when own-dir is absent', () => {
  const { home, proj } = sandbox();
  try {
    const full = path.join(proj, '.agents', 'coal', 'coalledger.json');
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '{}');
    fs.writeFileSync(path.join(proj, '.coalledger.json'), '{}'); // legacy also present but must lose
    assert.strictEqual(projectConfigPath(proj, home), full);
  } finally { clean(home, proj); }
});

test('projectConfigPath: LEGACY root dotfile is the fallback when nothing under any agent dir exists', () => {
  const { home, proj } = sandbox();
  try {
    fs.writeFileSync(path.join(proj, '.coalledger.json'), '{}');
    assert.strictEqual(projectConfigPath(proj, home), path.join(proj, '.coalledger.json'));
  } finally { clean(home, proj); }
});

test('projectConfigPath: nothing exists anywhere -> own-dir is both the read and write target', () => {
  const { home, proj } = sandbox();
  try {
    assert.strictEqual(projectConfigPath(proj, home), path.join(proj, '.claude', 'coal', 'coalledger.json'));
  } finally { clean(home, proj); }
});

test('findProjectRoot scatter-fix: a project anchored ONLY by a new-shape marker still resolves (no .git, no legacy file)', () => {
  const { home, proj } = sandbox();
  try {
    const cfgPath = path.join(proj, '.agents', 'coal', 'coalledger.json');
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, '{}');
    const nested = path.join(proj, 'src', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    assert.strictEqual(findProjectRoot(nested, home), proj, 'without this, the walk would fall through to the raw startDir');
  } finally { clean(home, proj); }
});

test('findProjectRoot widening is additive-only: never stops HIGHER than a nearer .git', () => {
  const { home, proj } = sandbox();
  try {
    // nested/.git is the nearer, narrower root; proj/.claude/coal/... sits
    // further OUT — the walk must stop at nested, never escape past it to
    // the wider agent-dir marker (the same invariant CoalWash's ROOT_MARKERS
    // widening proved: a new marker can only make the walk stop LOWER).
    const nested = path.join(proj, 'nested');
    fs.mkdirSync(path.join(nested, '.git'), { recursive: true });
    const outerCfg = path.join(proj, '.claude', 'coal', 'coalledger.json');
    fs.mkdirSync(path.dirname(outerCfg), { recursive: true });
    fs.writeFileSync(outerCfg, '{}');
    const deeper = path.join(nested, 'a', 'b');
    fs.mkdirSync(deeper, { recursive: true });
    assert.strictEqual(findProjectRoot(deeper, home), nested);
  } finally { clean(home, proj); }
});

test('structural: no source file under scripts/ or hooks/ writes the config filename (no project-config writer exists)', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.[cm]?js$/.test(entry.name) || /\.test\.[cm]?js$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (/(writeFileSync|appendFileSync)\([^)]*coalledger\.json/.test(text)) offenders.push(full);
    }
  };
  for (const r of ['scripts', 'hooks']) walk(path.join(repoRoot, r));
  assert.deepStrictEqual(offenders, [], `unexpected config writer(s): ${offenders.join(', ')}`);
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

test('clamp: an ABSENT global substitutes the schema default as the clamp ceiling (board #111)', () => {
  const { home, proj } = sandbox();
  try {
    // updateMode's schema default is 'ask' (index 2 of 4, BELOW the enum's
    // loudest 'auto') — the real bite: a cloned project can no longer reach
    // 'auto' unclamped just because no global config exists anywhere.
    assert.strictEqual(cascade(home, proj, {}, { updateMode: 'auto' }).updateMode, 'ask', 'no global -> clamps to schema default, not free');
    // At or below the schema default, no clamp is needed — the project value
    // passes through untouched (this fix only stops UPWARD movement).
    assert.strictEqual(cascade(home, proj, {}, { updateMode: 'remind' }).updateMode, 'remind', 'below the default -> passes through');
    // coalledgerMode's schema default is 'auto', already the CEILING of its own
    // enum (['off','manual','auto']) — substituting it as the effective global
    // still lets the project reach 'auto' with no global present. Same
    // observable result as before this fix for this one key; the mechanism is
    // still correct (see mergeSafety's own comment for why).
    assert.strictEqual(cascade(home, proj, {}, { coalledgerMode: 'auto' }).coalledgerMode, 'auto', 'default already at the ceiling -> no live change for this key');
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
    assert.strictEqual(cascade(home, proj, {}, { docLeak: true }).docLeak, true, 'schema default IS true (the ceiling) -> nothing in the enum sits above it, not "free" (board #111)');
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

test('clamp: an invalid PROJECT value gets NO say — it does not defeat an explicit global (board #111 F1, INSPECT-found)', () => {
  const { home, proj } = sandbox();
  try {
    // the old shape left the raw junk in place for clampedRead to resolve
    // downstream to the SCHEMA DEFAULT ('auto'/'ask'/true), never to the
    // global the user actually set — a single typo defeated an explicit
    // 'off' with no escalation attempt required. Confirmed via `cascade`
    // directly (mergeSafety's own output), not just via clampedRead, so a
    // future consumer that skips clampedRead still sees the clamp hold.
    assert.strictEqual(cascade(home, proj, { coalledgerMode: 'off' }, { coalledgerMode: 'yes' }).coalledgerMode, 'off');
    assert.strictEqual(cascade(home, proj, { docLeak: false }, { docLeak: 'yes' }).docLeak, false);
    assert.strictEqual(cascade(home, proj, { docLeak: false }, { docLeak: 1 }).docLeak, false);
    assert.strictEqual(cascade(home, proj, { updateMode: 'off' }, { updateMode: 'banana' }).updateMode, 'off');
    assert.strictEqual(cascade(home, proj, { updateMode: 'off' }, { updateMode: ' auto ' }).updateMode, 'off');
    assert.strictEqual(cascade(home, proj, { updateMode: 'off' }, { updateMode: null }).updateMode, 'off');
  } finally { clean(home, proj); }
});

test('clamp: an invalid GLOBAL value falls back to the schema default, then to the safest index (board #111 F3/F5, INSPECT-found)', () => {
  const { home, proj } = sandbox();
  try {
    // updateMode default is 'ask' (index 2 of 4) -- a typo'd global can no
    // longer be silently more permissive than the schema default lets it be.
    assert.strictEqual(cascade(home, proj, { updateMode: 'of' }, { updateMode: 'auto' }).updateMode, 'ask');
    // below the fallback ceiling still passes through -- the fallback caps,
    // it does not override a project value that was never trying to escalate.
    assert.strictEqual(cascade(home, proj, { updateMode: 'of' }, { updateMode: 'off' }).updateMode, 'off');
  } finally { clean(home, proj); }
});

// --------------------------------------------------------------------------
// Clamp candidate-path independence (namespace campaign #69+#39): mergeSafety
// must behave BYTE-IDENTICALLY no matter WHICH candidate path supplied the
// project value — own-dir, another agent dir, or the legacy root dotfile.
// CoalBoard's own INSPECT caught this exact gap in its own campaign round
// (candidate-independence claimed but demonstrated through only one path) —
// each of these 3 paths runs in its OWN sandbox, not the same path asserted
// twice. Both the explicit-global branch AND the missing-global-key branch
// (see mergeSafety's own schema-default-substitution comment, board #111 —
// NOT cited by line number here: a same-file citation rots on the very edit
// that writes it, per this room's own 2026-07-30 Readiness-round lesson) are
// covered for every path.
// --------------------------------------------------------------------------

function cascadeVia(home, proj, projectRelPath, globalCfg, projectCfg) {
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.coalledger.json'), JSON.stringify(globalCfg));
  const full = path.join(proj, projectRelPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(projectCfg));
  return loadMergedConfig({ cwd: proj, home });
}

const CANDIDATE_PATHS = [
  path.join('.claude', 'coal', 'coalledger.json'),
  path.join('.agents', 'coal', 'coalledger.json'),
  '.coalledger.json', // LEGACY
];

test('clamp: safer-value-wins is candidate-path-independent — explicit global blocks escalation via EVERY candidate', () => {
  for (const rel of CANDIDATE_PATHS) {
    const { home, proj } = sandbox();
    try {
      assert.strictEqual(
        cascadeVia(home, proj, rel, { coalledgerMode: 'off' }, { coalledgerMode: 'auto' }).coalledgerMode,
        'off',
        `explicit global must clamp via ${rel}`,
      );
    } finally { clean(home, proj); }
  }
});

test('clamp: safer-value-wins is candidate-path-independent — a MISSING global substitutes the schema default via EVERY candidate (coalledgerMode: no-op case, default already at the ceiling)', () => {
  for (const rel of CANDIDATE_PATHS) {
    const { home, proj } = sandbox();
    try {
      assert.strictEqual(
        cascadeVia(home, proj, rel, {}, { coalledgerMode: 'auto' }).coalledgerMode,
        'auto',
        `default already at the ceiling -> no live change via ${rel}`,
      );
    } finally { clean(home, proj); }
  }
});

test('clamp: safer-value-wins is candidate-path-independent — a MISSING global clamps updateMode to its schema default via EVERY candidate (board #111, the case with real bite)', () => {
  for (const rel of CANDIDATE_PATHS) {
    const { home, proj } = sandbox();
    try {
      assert.strictEqual(
        cascadeVia(home, proj, rel, {}, { updateMode: 'auto' }).updateMode,
        'ask',
        `no global -> clamps to schema default 'ask', not free, via ${rel}`,
      );
    } finally { clean(home, proj); }
  }
});
