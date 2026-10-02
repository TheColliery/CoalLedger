const NEWLINE = String.fromCharCode(10);
const BSN = String.fromCharCode(92) + 'n';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkConfigKeys, PENDING_KEYS, NOT_CONFIG, BLIND_KEYS, noticeRegion, checkConfigReadPath, READ_PATH_EXCEPTIONS } from './config-keys.mjs';

// In-memory surfaces: `read` is injected, so these drive the checker with no disk IO.
const mem = (files) => (f) => {
  if (!(f in files)) throw new Error('ENOENT ' + f);
  return files[f];
};
const BASE = ['coalledgerMode', 'severityFloor'];
// Empty declarations isolate the rule under test from the self-cleaning rules.
const NONE = { pending: {}, notConfig: {}, blind: {} };

test('config-keys: THE DEFECT -- a key named in a doc but absent from the schema FAILs, naming key and file', () => {
  const out = checkConfigKeys({
    schemaKeys: BASE,
    mdFiles: ['skills/x/SKILL.md'],
    read: mem({ 'skills/x/SKILL.md': 'Set `scanEverything` to true.' }),
    ...NONE,
  });
  assert.equal(out.length, 1);
  assert.match(out[0].msg, /scanEverything/);
  assert.match(out[0].msg, /skills\/x\/SKILL\.md/);
  assert.equal(out[0].level, 'FAIL');
});

test('config-keys: a key that DOES resolve is silent', () => {
  const out = checkConfigKeys({
    schemaKeys: BASE,
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'Narrow `coalledgerMode` or raise `severityFloor`.' }),
    ...NONE,
  });
  assert.deepEqual(out, []);
});

test('config-keys: CRY-WOLF BOUND -- enum values and lowercase prose words are not candidates', () => {
  const out = checkConfigKeys({
    schemaKeys: BASE,
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'Use `off`, `auto`, `manual`, `true`, `false`, `file`, `line`, `fs`, `git log`, `--help`.' }),
    ...NONE,
  });
  assert.deepEqual(out, [], 'none of these has an internal capital, so none is a candidate');
});

// --------------------------------------------------------------------------
// noticeBlocks is a LIST, not a single string (CWK-060 port defect #1): this
// room has no TRANSLATIONS blob, four separate named consts instead.
test('config-keys: a hook is scanned only inside its NAMED NOTICE consts, never its whole source', () => {
  const hook = [
    "function loadCfg() { const projectCfg = 1; return projectCfg; }",
    "const HEAD = 'Set scanEverything to true.';",
    "const watchedExts = new Set();",
  ].join(NEWLINE);
  const out = checkConfigKeys({
    schemaKeys: BASE,
    hookFiles: ['h.js'],
    read: mem({ 'h.js': hook }),
    noticeBlocks: ['HEAD'],
    ...NONE,
  });
  assert.equal(out.length, 1, 'only the notice-block identifier is a candidate');
  assert.match(out[0].msg, /scanEverything/);
  assert.ok(!out.some((f) => /loadCfg|projectCfg|watchedExts/.test(f.msg)), 'code outside the notice block is never scanned');
});

test('config-keys: multiple noticeBlocks are all scanned, and a name this file lacks contributes nothing', () => {
  const hook = [
    "const HEAD = 'mentions scanEverything here.';",
    "const TAIL = ['also mentions severityFloorX here.'];",
    "const otherCode = 'mentions coalledgerModeX too, but is NOT a declared block.';",
  ].join(NEWLINE);
  const out = checkConfigKeys({
    schemaKeys: BASE,
    hookFiles: ['h.js'],
    read: mem({ 'h.js': hook }),
    noticeBlocks: ['HEAD', 'TAIL', 'MISSING_BLOCK'],
    ...NONE,
  });
  const found = out.map((f) => f.msg).join(' ');
  assert.match(found, /scanEverything/, 'HEAD is scanned');
  assert.match(found, /severityFloorX/, 'TAIL is scanned too -- both blocks contribute');
  assert.ok(!found.includes('coalledgerModeX'), 'a const NOT in noticeBlocks is never scanned');
  // MISSING_BLOCK resolves to no region at all -- must not throw, must contribute nothing.
});

// --------------------------------------------------------------------------
// jsStringContents handles BOTH quote styles (CWK-060 port defect #2): this
// room's DRIFT_LINE -- its one string that names docsDriftNudge -- is
// double-quoted while every other notice const is single-quoted.
test('config-keys: a DOUBLE-quoted notice string is scanned exactly like a single-quoted one', () => {
  const hook = 'const DRIFT_LINE = "no MEMORY.md update recorded (docsDriftNudgeX=false in .coalledger.json)";';
  const out = checkConfigKeys({
    schemaKeys: BASE,
    hookFiles: ['h.js'],
    read: mem({ 'h.js': hook }),
    noticeBlocks: ['DRIFT_LINE'],
    ...NONE,
  });
  assert.equal(out.length, 1);
  assert.match(out[0].msg, /docsDriftNudgeX/, 'a double-quoted literal is not silently skipped');
});

// --------------------------------------------------------------------------
// noticeRegion is depth+quote-aware, not CoalMine's `\n};` object-only
// sentinel (CWK-060 port defect #3, found independently): this room's own
// notices are a STRING, an ARRAY OF STRINGS, and an ARRAY OF OBJECTS -- none
// of which reliably close with `};`. The unmodified sentinel ran past every
// one of them to the next real `};` in the file (85-121 lines deep, proven
// live before this fix), which is the same "scanned the whole file" failure
// CoalMine's own header names, produced by a bounded-looking sentinel that
// silently degrades to unbounded on a shape it assumes away.
test('config-keys: noticeRegion bounds a STRING const to its own statement, nothing past the semicolon', () => {
  const hook = [
    "const HEAD = 'mentions scanEverything here';",
    "function laterCode() { const coalledgerModeX = 1; return coalledgerModeX; }",
  ].join(NEWLINE);
  const out = checkConfigKeys({
    schemaKeys: BASE, hookFiles: ['h.js'], read: mem({ 'h.js': hook }),
    noticeBlocks: ['HEAD'], ...NONE,
  });
  const found = out.map((f) => f.msg).join(' ');
  assert.match(found, /scanEverything/);
  assert.ok(!found.includes('coalledgerModeX'), 'a plain-string const must not swallow the rest of the file');
});

test('config-keys: noticeRegion bounds an ARRAY-of-objects const to its own statement (CANARIES shape)', () => {
  const hook = [
    "const CANARIES = [",
    "  { name: 'x', line: 'mentions scanEverything here' },",
    "];",
    "function laterCode() { const coalledgerModeX = 1; return coalledgerModeX; }",
  ].join(NEWLINE);
  const out = checkConfigKeys({
    schemaKeys: BASE, hookFiles: ['h.js'], read: mem({ 'h.js': hook }),
    noticeBlocks: ['CANARIES'], ...NONE,
  });
  const found = out.map((f) => f.msg).join(' ');
  assert.match(found, /scanEverything/);
  assert.ok(!found.includes('coalledgerModeX'), 'an array-of-objects const must not swallow the rest of the file');
});

test('config-keys: noticeRegion bounds an ARRAY-of-strings const to its own statement (TAIL shape)', () => {
  const hook = [
    "const TAIL = [",
    "  'mentions scanEverything here',",
    "  'and a semicolon; inside a string does not end the statement early',",
    "];",
    "function laterCode() { const coalledgerModeX = 1; return coalledgerModeX; }",
  ].join(NEWLINE);
  const out = checkConfigKeys({
    schemaKeys: BASE, hookFiles: ['h.js'], read: mem({ 'h.js': hook }),
    noticeBlocks: ['TAIL'], ...NONE,
  });
  const found = out.map((f) => f.msg).join(' ');
  assert.match(found, /scanEverything/);
  assert.ok(!found.includes('coalledgerModeX'), 'an embedded semicolon inside a string must not end the region early');
});

// --------------------------------------------------------------------------
// LOW-1 (INSPECT, CWK-060 findings-back): the scanner has no concept of a
// comment or a regex literal. An apostrophe inside a comment, or a
// quote/brace inside a regex literal, flips quote/depth state incorrectly
// and the depth-0 `;` sentinel is never reached -- the bounded scan
// silently becomes unbounded, one layer under the already-fixed defect #3.
// Extracted noticeRegion directly, same as INSPECT's own methodology, and
// driven through the five hostile cases INSPECT reproduced.
const LATER = "function laterCode() { const coalledgerModeX = 1; return coalledgerModeX; }";

test('config-keys LOW-1: a LINE COMMENT with an apostrophe must not overrun the region', () => {
  const hook = [
    "const CANARIES = [",
    "  { name: 'x', line: 'mentions scanEverything here' }, // don't ship this on AG",
    "];",
    LATER,
  ].join(NEWLINE);
  const region = noticeRegion(hook, 'CANARIES');
  assert.ok(!region.includes('coalledgerModeX'), 'a line-comment apostrophe must not fuse the region into laterCode()');
});

test('config-keys LOW-1: a BLOCK COMMENT with an apostrophe must not overrun the region', () => {
  // The comment sits INSIDE the statement, before its own terminating `;` --
  // a comment placed AFTER the `;` never reaches the scanner at all, so it
  // would not exercise the bug.
  const hook = [
    "const CANARIES = [",
    "  { name: 'x', line: 'mentions scanEverything here' /* don't ship this on AG */ },",
    "];",
    LATER,
  ].join(NEWLINE);
  const region = noticeRegion(hook, 'CANARIES');
  assert.ok(!region.includes('coalledgerModeX'), 'a block-comment apostrophe must not fuse the region into laterCode()');
});

test('config-keys LOW-1: a REGEX LITERAL containing a quote must not overrun the region', () => {
  const hook = [
    "const HEAD = 'mentions scanEverything here' + /'/ ;",
    LATER,
  ].join(NEWLINE);
  const region = noticeRegion(hook, 'HEAD');
  assert.ok(!region.includes('coalledgerModeX'), "a regex literal's quote must not fuse the region into laterCode()");
});

test('config-keys LOW-1: a REGEX LITERAL containing a CLOSING bracket bounds correctly (the depth-clamp absorbs it)', () => {
  // Different residue than the quote case below: a stray '}' from inside a
  // regex only ever REMOVES a depth level this scanner never legitimately
  // added, so the clamp-at-0 absorbs it and the statement's real terminator
  // still fires -- proven by asserting the EXACT bound, not just "no
  // overrun byte".
  const stmt = "const HEAD = 'mentions scanEverything here' + /}/ ;";
  const hook = [stmt, LATER].join(NEWLINE);
  assert.equal(noticeRegion(hook, 'HEAD'), stmt);
});

test('config-keys LOW-1: an UNTERMINATED statement must not overrun the region', () => {
  const hook = [
    "const HEAD = 'mentions scanEverything here, no closing semicolon'",
    LATER,
  ].join(NEWLINE);
  const region = noticeRegion(hook, 'HEAD');
  assert.ok(!region.includes('coalledgerModeX'), 'a statement with no depth-0 terminator must not run to EOF');
});

test('config-keys LOW-1: comments are HANDLED (bounded correctly), not merely fail-closed', () => {
  // A comment is the cheap, unambiguous case the fix closes for real -- the
  // region resolves to the statement's own true bound, not to '' and not to
  // an overrun. This is the positive counterpart to the regex/unterminated
  // cases below, which fail closed because they are genuinely unparseable
  // without a full tokenizer.
  const hook = ["const CANARIES = [", "  { name: 'x', line: 'y' /* don't */ },", "];", LATER].join(NEWLINE);
  assert.equal(noticeRegion(hook, 'CANARIES'), "const CANARIES = [" + NEWLINE + "  { name: 'x', line: 'y' /* don't */ }," + NEWLINE + "];");
});

test('config-keys LOW-1: the genuinely-unparseable cases (regex, unterminated) FAIL CLOSED to NOTHING', () => {
  // The fix's own shape (dispatch): "make an unterminated scan return NOTHING
  // ... a scan that finds no candidates rather than a scan that reads the
  // whole file." Asserted positively, not just "no overrun byte" above.
  const regexCase = ["const HEAD = 'x' + /'/ ;", LATER].join(NEWLINE);
  const unterminatedCase = ["const HEAD = 'x'", LATER].join(NEWLINE);
  assert.equal(noticeRegion(regexCase, 'HEAD'), '');
  assert.equal(noticeRegion(unterminatedCase, 'HEAD'), '');
});

test('config-keys LOW-1: the four REAL notice consts still bound correctly on the actual shipped hooks (1/4/9/1 lines)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url)); // scripts/lib/
  const hooksDir = path.join(here, '..', '..', 'hooks');
  const conductor = fs.readFileSync(path.join(hooksDir, 'coalledger-conductor.js'), 'utf8');
  const driftStop = fs.readFileSync(path.join(hooksDir, 'coalledger-drift-stop.js'), 'utf8');
  const lines = (s) => (s ? s.split(NEWLINE).length : 0);
  assert.equal(lines(noticeRegion(conductor, 'HEAD')), 1, 'HEAD');
  assert.equal(lines(noticeRegion(conductor, 'TAIL')), 4, 'TAIL');
  assert.equal(lines(noticeRegion(conductor, 'CANARIES')), 9, 'CANARIES');
  assert.equal(lines(noticeRegion(driftStop, 'DRIFT_LINE')), 1, 'DRIFT_LINE');
});

test('config-keys: an escape sequence does not manufacture a phantom identifier', () => {
  // MEASURED (CoalMine): nReport / nMemory / nTripwires -- an escape fusing with the
  // following word manufactures a false identifier before the escape-stripping pass.
  const hook = "const HEAD = 'line one" + BSN + "Report follows" + BSN + "Memory too';";
  const out = checkConfigKeys({ schemaKeys: BASE, hookFiles: ['h.js'], read: mem({ 'h.js': hook }), noticeBlocks: ['HEAD'], ...NONE });
  assert.deepEqual(out, []);
});

test('config-keys: PENDING_KEYS makes the HONEST case cheap -- a declared planned key is silent', () => {
  const out = checkConfigKeys({
    schemaKeys: BASE,
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'A `futureKey` override is planned.' }),
    ...NONE,
  });
  assert.equal(out.length, 1, 'undeclared -> FAIL (this is the control)');
  assert.match(out[0].msg, /futureKey/);

  const declared = checkConfigKeys({
    schemaKeys: BASE,
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'A `futureKey` override is planned.' }),
    pending: { futureKey: 'CWK-999, planned' },
    notConfig: {},
    blind: {},
  });
  assert.deepEqual(declared, [], 'declared with its ticket -> silent: the honest case is one line');
});

test('config-keys: SELF-CLEANING 1, PENDING branch -- a planned key that LANDS in the schema FAILs, so the entry expires on the event', () => {
  const out = checkConfigKeys({
    schemaKeys: [...BASE, 'futureKey'],           // it landed
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'A `futureKey` override is planned.' }),
    pending: { futureKey: 'CWK-999, planned' },   // ...but the entry still claims it is pending
    notConfig: {},
    blind: {},
  });
  assert.equal(out.length, 1, 'the stale declaration is the only finding -- the key itself now resolves');
  assert.equal(out[0].level, 'FAIL');
  assert.match(out[0].msg, /futureKey/);
  assert.match(out[0].msg, /now resolves in the schema/, 'the message must say WHY it expired');
  assert.match(out[0].msg, /delete the entry/, 'and what to do about it');
});

const TABLE = [
  '# Doc',
  '## 🔧 Configure',
  '| Key | Default | What it does |',
  '|---|---|---|',
  '| `theme` | `dark` | a LOWERCASE key the prose rule can never see |',
  '| `coalledgerMode` | `auto` | a real one |',
  '## Commands',
  '| `/tool:stats` | shows stats |',
].join(NEWLINE);

test('config-keys: STRUCTURED SURFACE -- a LOWERCASE key documented in a key table IS caught, where prose cannot be', () => {
  const out = checkConfigKeys({
    schemaKeys: ['coalledgerMode'],
    keyTables: [{ file: 'r.md', heading: 'Configure' }],
    read: mem({ 'r.md': TABLE }),
    ...NONE,
  });
  const hard = out.filter((f) => f.level === 'FAIL');
  assert.equal(hard.length, 1, 'the lowercase key must be caught, and an EMOJI-prefixed heading still matches');
  assert.match(hard[0].msg, /theme/);
  assert.match(hard[0].msg, /whatever its shape/, 'and the message must say why it was catchable');
});

test('config-keys: STRUCTURED SURFACE is REGION-BOUNDED -- rows outside the key table (Commands) are never claims', () => {
  const out = checkConfigKeys({
    schemaKeys: ['coalledgerMode'],          // `theme` deliberately absent...
    keyTables: [{ file: 'r.md', heading: 'Configure' }],
    read: mem({ 'r.md': TABLE }),
    ...NONE,
  });
  const fails = out.filter((f) => f.level === 'FAIL');
  assert.equal(fails.length, 1, 'exactly one row is a live claim');
  assert.match(fails[0].msg, /theme/, '...so the in-region row IS scanned -- the check is not vacuous');
  assert.ok(!fails.some((f) => /tool:stats/.test(f.msg)),
    'and the Commands-table row is not a key claim, so widening the region would redden this');
});

test('config-keys: STRUCTURED SURFACE honours the declarations -- a documented PENDING key stays cheap', () => {
  const out = checkConfigKeys({
    schemaKeys: ['coalledgerMode'],
    keyTables: [{ file: 'r.md', heading: 'Configure' }],
    read: mem({ 'r.md': TABLE }),
    pending: { theme: 'CWK-999, planned' },
    notConfig: {}, blind: {},
  });
  assert.deepEqual(out, [], 'honestly-planned and documented is still one line, not a red gate');
});

test('config-keys: a DECLARED blind key still DISCLOSES -- the stop did not cost the disclosure', () => {
  const out = checkConfigKeys({
    schemaKeys: [...BASE, 'language'],
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'Set `language` to en.' }),
    pending: {}, notConfig: {},
    blind: { language: 'mandated flock-wide; indistinguishable from prose' },
  });
  assert.equal(out.filter((f) => f.level === 'FAIL').length, 0, 'declared, so no stop');
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 'SKIP', 'but it must still SAY SO -- and a SKIP cannot redden the gate');
  assert.match(out[0].msg, /language/);
  assert.match(out[0].msg, /read and discarded/, 'the disclosure states the consequence, not just the name');
});

test('config-keys: THE CLASS -- an UNDECLARED lowercase schema key is a hard FAIL, not a printed note', () => {
  const out = checkConfigKeys({
    schemaKeys: [...BASE, 'theme'],
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'Set `theme` to dark.' }),
    ...NONE,
  });
  const hard = out.filter((f) => f.level === 'FAIL');
  assert.equal(hard.length, 1, 'a gate that only PRINTS its blind spot has not closed it');
  assert.match(hard[0].msg, /theme/, 'the FAIL names the key');
  assert.match(hard[0].msg, /BLIND_KEYS/, 'and tells the reader how to accept it deliberately');
});

test('config-keys: BLIND_KEYS expires on the EVENT -- a declared key that LEFT the schema FAILs', () => {
  const out = checkConfigKeys({
    schemaKeys: BASE,
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'nothing' }),
    pending: {}, notConfig: {},
    blind: { theme: 'accepted once' },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 'FAIL');
  assert.match(out[0].msg, /not in the schema at all/, 'the key is gone, so the declaration is a lie');
});

test('config-keys: BLIND_KEYS expires on the EVENT -- a declared key the rule CAN now see FAILs', () => {
  const out = checkConfigKeys({
    schemaKeys: [...BASE, 'themeName'],
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'Set `themeName` to dark.' }),
    pending: {}, notConfig: {},
    blind: { themeName: 'stale: this now matches the shape rule' },
  });
  const hard = out.filter((f) => f.level === 'FAIL');
  assert.equal(hard.length, 1);
  assert.match(hard[0].msg, /now matches the shape rule/);
});

test("config-keys: this room's own BLIND_KEYS is non-empty and covers `language`", () => {
  assert.ok(Object.hasOwn(BLIND_KEYS, 'language'), 'the flock-mandated key must be declared');
  assert.ok(BLIND_KEYS.language.length > 20, 'and carry a real reason, not a bare entry');
});

test("config-keys: this room's own NOT_CONFIG covers memoryDriftNudge and systemMessage", () => {
  assert.ok(Object.hasOwn(NOT_CONFIG, 'memoryDriftNudge'), "CoalMine's own key, cross-referenced in our README");
  assert.ok(Object.hasOwn(NOT_CONFIG, 'systemMessage'), 'the Claude Code hook OUTPUT field, not a config input');
});

test("config-keys: this room's own PENDING_KEYS is empty (scanEverything landed schema+ship-text in one commit)", () => {
  assert.deepEqual(PENDING_KEYS, {});
});

test('config-keys: SELF-CLEANING 1 -- a NOT_CONFIG entry that becomes a real key FAILs as a lie', () => {
  const tok = Object.keys(NOT_CONFIG)[0];
  const out = checkConfigKeys({
    schemaKeys: [...BASE, tok],
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'mentions `' + tok + '` here' }),
  });
  assert.ok(out.some((f) => /the entry is a lie/.test(f.msg)), 'the declaration must not outlive its truth');
});

test('config-keys: SELF-CLEANING 2 -- a declaration no surface mentions FAILs as dead weight', () => {
  const out = checkConfigKeys({ schemaKeys: BASE, mdFiles: ['a.md'], read: mem({ 'a.md': 'nothing here' }) });
  const dead = out.filter((f) => /protects nothing/.test(f.msg));
  assert.equal(dead.length, Object.keys(NOT_CONFIG).length + Object.keys(PENDING_KEYS).length,
    'every unreferenced declaration is reported, so the list prunes itself');
});

test('config-keys: an absent surface is a visible SKIP, never a silent pass and never a false accusation', () => {
  const out = checkConfigKeys({
    schemaKeys: BASE,
    mdFiles: ['missing.md'],
    read: mem({}),
    notConfig: { someIdent: 'declared, but the only surface naming it was unreadable' },
    pending: {},
    blind: {},
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 'SKIP', 'a partial scan degrades visibly');
  assert.match(out[0].msg, /missing\.md/);
  assert.ok(!out.some((f) => /protects nothing/.test(f.msg)),
    'and it must NOT convict the declaration -- a 0-hit proves nothing when the scope was incomplete');
});

// ===========================================================================
// CWK-064: checkConfigReadPath -- ONE CONFIG-READ PATH PER ROOM. A key
// mentioned beside `.coalledger.json` with no cascade language is a BARE,
// unclamped read path.
const readMem = (files) => (f) => {
  if (!(f in files)) throw new Error('ENOENT ' + f);
  return files[f];
};

test('read-path: THE DEFECT -- a key named beside .coalledger.json with no cascade language FAILs', () => {
  const out = checkConfigReadPath({
    schemaKeys: ['severityFloor'],
    mdFiles: ['a.md'],
    read: readMem({ 'a.md': 'honor `.coalledger.json` `severityFloor`:' }),
    exceptions: {},
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 'FAIL');
  assert.match(out[0].msg, /severityFloor/);
  assert.match(out[0].msg, /a\.md/);
});

test('read-path: naming the CASCADE (global + project) is silent', () => {
  const out = checkConfigReadPath({
    schemaKeys: ['severityFloor'],
    mdFiles: ['a.md'],
    read: readMem({ 'a.md': 'from `.coalledger.json`, global + project merge: `severityFloor`' }),
    exceptions: {},
  });
  assert.deepEqual(out, [], 'both words present -> the cascade is named, not a bare read');
});

test('read-path: a line naming ONLY "global" or ONLY "project" is still a FAIL -- both words are required', () => {
  const globalOnly = checkConfigReadPath({
    schemaKeys: ['severityFloor'],
    mdFiles: ['a.md'],
    read: readMem({ 'a.md': 'the global `.coalledger.json` `severityFloor`' }),
    exceptions: {},
  });
  const projectOnly = checkConfigReadPath({
    schemaKeys: ['severityFloor'],
    mdFiles: ['a.md'],
    read: readMem({ 'a.md': 'the project `.coalledger.json` `severityFloor`' }),
    exceptions: {},
  });
  assert.equal(globalOnly.length, 1, 'one word alone does not describe a merge');
  assert.equal(projectOnly.length, 1);
});

test('read-path: a line mentioning .coalledger.json with NO real key is silent', () => {
  const out = checkConfigReadPath({
    schemaKeys: ['severityFloor'],
    mdFiles: ['a.md'],
    read: readMem({ 'a.md': 'see `.coalledger.json` for the full key list' }),
    exceptions: {},
  });
  assert.deepEqual(out, [], 'no key named -> not a read-path claim at all');
});

test('read-path: a line naming a key with NO .coalledger.json mention is silent', () => {
  const out = checkConfigReadPath({
    schemaKeys: ['severityFloor'],
    mdFiles: ['a.md'],
    read: readMem({ 'a.md': 'honor `severityFloor` per the merged config' }),
    exceptions: {},
  });
  assert.deepEqual(out, [], 'the file is never named -> nothing to flag');
});

test('read-path: TWO keys on one line produce TWO findings, each naming its own key', () => {
  const out = checkConfigReadPath({
    schemaKeys: ['docLeak', 'publicMode'],
    mdFiles: ['a.md'],
    read: readMem({ 'a.md': 'Runs only when `.coalledger.json` `docLeak` is true. `publicMode` raises stakes.' }),
    exceptions: {},
  });
  assert.equal(out.length, 2);
  assert.ok(out.some((f) => /docLeak/.test(f.msg)));
  assert.ok(out.some((f) => /publicMode/.test(f.msg)));
});

test('read-path: a DECLARED exception makes the honest case silent', () => {
  const out = checkConfigReadPath({
    schemaKeys: ['updateMode'],
    mdFiles: ['commands/update.md'],
    read: readMem({ 'commands/update.md': 'hand-edit `updateMode` in `.coalledger.json` directly' }),
    exceptions: { 'commands/update.md:updateMode': 'a write-target fallback, not a read instruction' },
  });
  assert.deepEqual(out, [], 'declared with its reason -> silent, the honest case is cheap');
});

test('read-path: exception matching is PATH-SEPARATOR AGNOSTIC (backslash-joined paths still match a forward-slash key)', () => {
  // Self-caught while wiring verify.mjs: path.join() on Windows produces
  // 'commands\\update.md', which would never match a forward-slash
  // exception key and silently turn a declared exception into a permanent
  // FAIL on this platform. Regression-pinned here.
  const out = checkConfigReadPath({
    schemaKeys: ['updateMode'],
    mdFiles: ['commands\\update.md'],
    read: readMem({ 'commands\\update.md': 'hand-edit `updateMode` in `.coalledger.json` directly' }),
    exceptions: { 'commands/update.md:updateMode': 'a write-target fallback, not a read instruction' },
  });
  assert.deepEqual(out, [], 'a backslash-joined path must still resolve to the forward-slash exception key');
});

test('read-path: SELF-CLEANING -- an exception that matches NOTHING FAILs as dead weight', () => {
  const out = checkConfigReadPath({
    schemaKeys: ['updateMode'],
    mdFiles: ['a.md'],
    read: readMem({ 'a.md': 'nothing relevant here' }),
    exceptions: { 'commands/update.md:updateMode': 'stale, nothing names this any more' },
  });
  const dead = out.filter((f) => /protects nothing/.test(f.msg));
  assert.equal(dead.length, 1);
  assert.match(dead[0].msg, /commands\/update\.md:updateMode/);
});

test('read-path: a PARTIAL scan (unreadable surface) degrades to SKIP, never convicts a live exception', () => {
  const out = checkConfigReadPath({
    schemaKeys: ['updateMode'],
    mdFiles: ['missing.md'],
    read: readMem({}),
    exceptions: { 'commands/update.md:updateMode': 'a write-target fallback' },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 'SKIP');
  assert.match(out[0].msg, /missing\.md/);
  assert.ok(!out.some((f) => /protects nothing/.test(f.msg)),
    'a partial scan cannot prove the exception is dead');
});

test("read-path: this room's own READ_PATH_EXCEPTIONS declares exactly the update.md fallback", () => {
  assert.deepEqual(Object.keys(READ_PATH_EXCEPTIONS).sort(), [
    'commands/update.md:updateCheckDays',
    'commands/update.md:updateMode',
  ]);
});

// DELIBERATELY NOT a committed test: "does the live tree currently pass
// checkConfigReadPath" is NOT asserted here. The 7-line defect is real in
// the tree as this unit hands over (the doc-writer's fix is a SEPARATE,
// later station) -- a committed test asserting the tree is CURRENTLY
// broken would itself go red the moment that correct fix lands, planting
// a landmine under an unrelated, wanted change. The historical red proof
// belongs in the RETURN file (this unit's own `verify.mjs` run, captured
// live) — this test file stays 100% green on synthetic fixtures only,
// matching every other test above and this room's own red-run law (a red
// CI run is fixed next-turn, never shipped as an expected, permanent
// state).
