// CWK-060 — documentation-vs-schema drift gate, ported from CoalMine's CWK-059
// (scripts/lib/config-keys.mjs). Every config key NAMED on a user-facing
// surface must RESOLVE in config-schema.mjs, or be declared.
//
// WHY: CoalMine's own CWK-054 MEDIUM was the fix over-claiming inside the
// fix -- ship-text promising a key the schema had not landed. This room's
// own CWK-057 (a40325f) paid the SAME class from the other direction: the
// schema, clamp and four tests landed while NO hook and NO SKILL.md read
// scanEverything -- a correctly-clamped key protecting nothing anyone
// traverses. Two directions of the same defect: a surface can claim a key
// that isn't real, or a key can go real while nothing yet claims it as
// live. This gate only catches the first direction (a named key that does
// not resolve); the second is a DIFFERENT check this room already paid for
// by hand at CWK-057 and does not have a machine here either -- named, not
// solved by this unit.
//
// DETECTION RULE, and its false-positive behaviour is MEASURED on THIS
// repo, not carried over from CoalMine's. A candidate is a token that (a)
// is backticked in Markdown, or is inside the CONTENTS of a string literal
// in a hook's own notice consts, and (b) matches KEY_SHAPE below: camelCase
// with AT LEAST ONE internal capital.
//
//   TWO NAIVE BASELINES, on TWO DIFFERENT SCOPES -- stated as two numbers,
//   not reconciled into one, because they measure different things and
//   collapsing them was the actual source of the first discrepancy here.
//   (a) ANY backticked token, no shape filter at all: 144 distinct tokens
//       across 7 skills/*/SKILL.md + README.md combined, 133 of them NOT
//       keys -- 92% noise. README.md alone contributes 108 of the 144
//       (paths, CLI flags, file extensions, enum values a SKILL.md-only
//       measurement never meets).
//   (b) The single-word scope -- `^[A-Za-z][A-Za-z0-9]*$`, i.e. LETTERS AND
//       DIGITS ONLY, starting with a letter -- reproduces "45 tokens, 34
//       non-keys"
//       EXACTLY on this same combined surface (verified after removing a
//       sabotage row planted for the RED-FIRST proof, which had inflated
//       both counts to 46/35 while present).
//       (The gloss is stated as the regex's own alphabet on purpose, CWK-060
//       INSPECT LOW-2: an earlier wording read "no dots, slashes, colons or
//       spaces", which is LOOSER than the regex -- taken literally it admits
//       `-`, `_`, `#` and a leading digit, and the reviewer MEASURED that
//       filter at 67 tokens, not 45. A reader reproducing the baseline from
//       the English rather than the regex would have got a different number
//       and concluded the header was wrong: this gate's own defect class,
//       documentation diverging from the code beside it, in this gate's own
//       documentation.)
//   Neither baseline is load-bearing code; both are illustrative prose
//   for why the shape rule below exists. What IS load-bearing, and
//   reproduces EXACTLY regardless of which naive scope precedes it: the
//   internal-capital (KEY_SHAPE) rule takes the residue to 12 tokens, 2 of
//   them not keys -- 17% noise, matching CoalMine's identical "12 tokens,
//   2 non-keys" on its own repo.
//   Residue after the rule: 2 tokens across all in-scope surfaces --
//   `memoryDriftNudge` (CoalMine's own key, named in this room's README as
//   the CODE-pole twin of `docsDriftNudge`) and `systemMessage` (the Claude
//   Code hook OUTPUT field this room's Stop hook writes, not a config
//   input) -- both declared in NOT_CONFIG below with their reasons.
//
// UNDER-FIRES BY DESIGN, same as CoalMine's: a single-word lowercase key or
// a snake_case key does not match KEY_SHAPE and is invisible to this gate.
// `language` is our own live instance -- see BLIND_KEYS below, which is
// where the gate refuses to run rather than silently checking less than it
// claims.
//
// WIDENING KEY_SHAPE WAS CONSIDERED AND REJECTED, on OUR measurement:
// allowing any lowercase identifier takes the residue on this repo's own
// surfaces from 12 to 99 (the "no spaces, no slashes" single-word count
// measured directly against the naive pass) -- file extensions (`.md`,
// `.mdx`, `.rst`, ...), agent-dir names (`.claude`, `.agents`, `.gemini`),
// enum values (`off`, `auto`, `manual`, `true`, `false`, `quick`, `full`),
// tool names (`Read`, `Grep`, `Bash`, `WebFetch`) and prose (`file`, `line`,
// `description`). The same trade CoalMine measured: closing a one-key
// blind spot by requiring a large hand-kept NOT_CONFIG roster trades a
// named gap for the exact allowlist rot this design refuses.
//
// A SCHEMA-TO-DOCS LITERAL PASS was not separately re-measured here -- the
// argument against it (it can only find keys that are already real by
// construction, so it answers a coverage question, not a drift question)
// is a property of the TECHNIQUE, not of CoalMine's own repo, and holds
// here unchanged. See CoalMine's own header for the full argument; not
// re-derived, because nothing about it is repo-specific.
//
// SO THE CLASS IS CLOSED FROM THE OTHER END -- not by detecting better, but
// by making the blind spot IMPOSSIBLE TO CREATE SILENTLY. See BLIND_KEYS
// below.
const KEY_SHAPE = /^[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*$/;

// A key that is NAMED but not yet IMPLEMENTED. Same discipline as CoalMine's:
// the honest case (name it, with its status) is cheap -- one line, here --
// and the dishonest case (name it as if it already worked) is loud, a FAIL
// naming the file. An entry MUST carry a ticket or a reason.
//
// EXPIRY, same two self-cleaning rules as CoalMine's, unchanged because they
// are properties of the CHECK below, not of either room's schema:
//   1. a PENDING key that NOW resolves in the schema is a FAIL (implemented,
//      delete this entry).
//   2. an entry NO SURFACE mentions is a FAIL (protects nothing, delete it).
export const PENDING_KEYS = {
  // empty: checked for ALL 11 live schema keys, not only scanEverything --
  // for each key, the commit that first ADDED it to config-schema.mjs and
  // the commit that first NAMED it anywhere in README.md/SKILL.md/hooks/*.js
  // are the SAME commit, every time (`git log -S<key> --reverse` against
  // config-schema.mjs vs against the ship-text surfaces, run per key).
  // scanEverything (a40325f) and docsDriftNudge (7801ff0) both land
  // schema+ship-text together, same as the other 9 keys, which have all
  // shared one founding commit (3cb5dc4) since launch. There has never been
  // a git-history state in this room where a surface named a key before the
  // schema resolved it -- see the RED-FIRST proof below for why that means
  // this room's own history could not supply the historical case CWK-060's
  // dispatch asked to look for first.
};

// NOT a config key and never will be -- a code/platform identifier that
// happens to be camelCase in prose. Kept a SEPARATE list from PENDING_KEYS
// for CoalMine's own stated reason: "planned" and "not a key" are different
// KINDS of claim, and merging them lets either hide inside the other.
export const NOT_CONFIG = {
  memoryDriftNudge: "CoalMine's own config key (the CODE-pole twin of this room's docsDriftNudge), named in README.md's cross-reference paragraph -- never ours",
  systemMessage: 'the Claude Code hook OUTPUT field this room\'s Stop hook writes (coalledger-drift-stop.js), not a config input',
};

// A schema key this gate's detection rule CANNOT SEE, declared with the
// reason it is accepted. MANDATORY, not optional, same as CoalMine's: any
// key in the schema that fails KEY_SHAPE and is NOT declared here is a hard
// FAIL -- the gate refuses to run while silently checking less than it
// claims, rather than printing a line nobody reads past the third run.
//
// EVERY ADOPTING ROOM COLLIDES WITH THIS IMMEDIATELY, exactly as CoalMine's
// own comment predicted: AGENTS.md's 5 Standard Systems mandates `language`
// flock-wide, and `language` fails KEY_SHAPE. Confirmed live on THIS
// schema, not assumed: `language` is CoalLedger's own single failing key
// too (config-schema.mjs's 11 keys, re-derived at wiring time below).
export const BLIND_KEYS = {
  language: "AGENTS.md 5 Standard Systems #2 mandates it flock-wide; a single lowercase word is indistinguishable from prose, and widening the rule to catch it was measured (on this repo) at +87 false positives (99 single-word candidates vs 12 shaped ones)",
};

// SURFACES -- chosen by MEASUREMENT on THIS repo, each in/out with its own
// reason (CoalMine's own exclusions are cited only where the reason is a
// property of the SURFACE KIND rather than of CoalMine's content, and even
// then re-measured here rather than trusted).
//   IN  skills/<any>/SKILL.md   the agent-facing contract; CWK-057's own
//       residue landed here (all 7 "then honor severityFloor" steps).
//   IN  README.md               the Configure table is the most
//       user-visible key list, AND the free-prose surface with the worst
//       measured noise (108 of the 144 naive tokens) -- exactly why the
//       shape rule and the region-bounded structured pass both matter.
//   IN  hooks/*.js NOTICE CONSTS  the runtime notices a user actually
//       reads -- CANARIES/HEAD/TAIL (coalledger-conductor.js) and
//       DRIFT_LINE (coalledger-drift-stop.js). ag-conductor.js and
//       coalledger-doctrack.js contribute nothing (measured: neither
//       declares a notice-shaped const at all -- ag-conductor.js requires
//       the CC conductor's own HEAD/TAIL rather than declaring its own,
//       and doctrack.js is config-free by design, no user-facing text).
//   OUT CHANGELOG.md            MEASURED on this repo: 282 naive
//       candidates, 29 shaped -- roughly two-thirds real CODE identifiers
//       (parseMarkdown, mergeSafety, collectAnchors, findProjectRootLocal,
//       ...), the rest every schema key INCLUDING scanEverything named
//       before its own commit landed, by design (a changelog entry
//       documents what a key BECAME, which for a brand-new key is
//       necessarily written before the commit that makes it real closes).
//       A gate that reddens on accurate history, or on a function name, is
//       wrong here, not merely noisy -- same verdict as CoalMine's, same
//       reason, independently re-measured.
//   OUT CONTRIBUTING.md / SECURITY.md / PRIVACY.md  measured: zero
//       KEY_SHAPE candidates in any of the three (43/32/14 naive tokens
//       respectively, 0 shaped in each). Including them buys nothing today.
//   OUT platform-configs/.coalledger.json  it IS config, not prose about
//       config: every key there is real by construction and verify.mjs's
//       own "config (factory vs schema)" check already validates it
//       key-by-key against CONFIG_SCHEMA. Scanning it here would
//       double-report a key that check already owns.
//
// SOURCE ONLY, never the plugin/ twins -- verify.mjs's own dist-parity
// check (`checkDist`, wired below it in the same gate) already proves the
// two trees byte-identical; scanning both would double every finding for
// zero added coverage.
//
// PORTABILITY -- an adopting room supplies exactly four things and changes
// no logic: schemaKeys, mdFiles, hookFiles, and its own two declarations
// (BLIND_KEYS is mandatory the moment a room ships a lowercase key; most
// will, per AGENTS.md's own Standard Systems mandate). Nothing below
// hardcodes either room's layout.

const BS = String.fromCharCode(92); // a literal backslash, built not typed
const TICK = new RegExp('`([^`' + BS + 'n]+)`', 'g');
const IDENT = new RegExp(BS + 'b([a-z][a-z0-9]*[A-Z][A-Za-z0-9]*)' + BS + 'b', 'g');
// A markdown table row whose FIRST cell is a single backticked token.
const ROW_KEY = new RegExp('^' + BS + 's*[|]' + BS + 's*`([^`|]+)`' + BS + 's*[|]');

function candidatesInMarkdown(text) {
  const out = new Set();
  for (const m of text.matchAll(TICK)) if (KEY_SHAPE.test(m[1])) out.add(m[1]);
  return out;
}

// SCOPE INSIDE A HOOK: one NAMED notice const's own statement, never the
// whole file, and never CoalMine's own `\n};` sentinel unmodified.
//
// PORT DEFECT, verified before being fixed rather than trusted from the
// dispatch: this room has no single `TRANSLATIONS` object -- our
// user-facing notices are FOUR separate top-level consts of THREE
// different shapes (a plain string, an array of strings, an array of
// objects), confirmed by grep (zero `TRANSLATIONS` hits anywhere in
// hooks/*.js). So `noticeBlock` becomes `noticeBlocks`, a LIST.
//
// SECOND PORT DEFECT, found independently while fixing the first, not
// named in the dispatch: CoalMine's own end-of-region sentinel --
// `text.indexOf('\n};', start)` -- assumes the const is an OBJECT literal
// closing `};`. Two of our four notices are ARRAYS (closing `];`) and one
// is a bare STRING (closing `;` with no bracket at all). Proven by running
// the unmodified sentinel against all four: EVERY ONE of them ran past its
// own statement to the next real `};` in the file -- 85 to 121 lines deep,
// swallowing the entire rest of the hook (helper functions, the whole
// main() body) as "notice content". That is the exact 110-false-positive
// failure CoalMine's own header names for an UNBOUNDED scan, reproduced
// here by a BOUNDED sentinel that silently degrades to unbounded on a
// shape it was never built for -- a green gate reading a false scope,
// committed inside the fix for the other two defects, exactly the
// "GREEN gate over an unread surface" class this whole gate exists to stop.
//
// FIX: bound the region by the const's own JS statement end -- track
// bracket depth (any of {[( / }])) and quote state (single, double or
// backtick, backslash-escape aware) from the `=` sign forward, and stop at
// the first `;` at depth 0 outside a string. This is shape-agnostic by
// construction: a bare string, an array, and an object all terminate their
// own statement the same way, so one scanner covers all three without a
// case split. Verified directly, not just reasoned about, against all four
// live consts before wiring it in: CANARIES -> 9 lines / 1463 chars (was
// 121 lines / 7471 chars unmodified) · HEAD -> 1 line / 552 chars (was 111
// lines / 6006 chars) · TAIL -> 4 lines / 307 chars (was 110 lines / 5453
// chars) · DRIFT_LINE -> 1 line / 344 chars (was 85 lines / 4461 chars).
// LOW-1 (INSPECT, CWK-060 findings-back): the boundary scanner had no
// concept of a `//` line comment, a `/* */` block comment, or a regex
// literal. An apostrophe inside a comment, or a quote/brace inside a
// regex, flipped quote/depth state incorrectly, the depth-0 `;` sentinel
// was then never reached, and a BOUNDED-LOOKING scan silently became
// UNBOUNDED -- the exact failure mode defect #3 (above) was found and
// fixed for, one layer down, with no error raised. Reproduced live before
// this fix: a line comment, a block comment, a regex containing a quote,
// a regex containing a brace, and a plain unterminated statement all ran
// the region to EOF (config-keys.test.mjs's LOW-1 tests, red-first).
//
// TWO MOVES, deliberately not a third: (1) comments are cheap and
// unambiguous to close, and are the case a maintainer is most likely to
// create -- a comment inside a notice const. (2) FAIL CLOSED when no
// depth-0 terminator is ever found: hand-rolled parsing has an infinite
// tail of syntax this scanner does not understand, so rather than chase
// every case, an unterminated scan now returns NOTHING (a scan that
// finds no candidates) instead of running to EOF (a scan that silently
// reads the whole file). A bounded, honest miss beats a silent flood.
//
// RESIDUE, NAMED NOT GUARDED. A regex literal is genuinely ambiguous with
// division without a full tokenizer and is deliberately NOT special-cased
// here -- distinguishing `a / b` from `/b/` needs knowing whether the
// PREVIOUS token was an operand, which this char-scanner does not track.
// Two shapes remain, and fail-closed is what makes each of them SAFE
// rather than merely undetected:
//   - a regex containing a CLOSING BRACKET (`/}/ `, `/]/ `, `/)/ `): the
//     depth-clamp below (never below 0) absorbs the spurious closer in
//     the common case where the statement's real nesting still reaches 0
//     at its true end -- proven bounded by the REGEX-literal tests, not
//     merely fail-closed.
//   - a regex containing a QUOTE (`/'/ `) is a DIFFERENT mechanism and
//     was grouped with the brackets above until INSPECT's confirmation
//     round separated them: an unpaired quote flips the scanner into
//     string state and the depth clamp never enters it, so the terminator
//     is not found and the FAIL-CLOSED path is what saves it -- a bounded
//     miss, never an overrun. The shipped tests already distinguish the
//     two; this comment now does too. (Recorded rather than quietly
//     corrected: a comment grouping two mechanisms under one explanation
//     is this gate's own defect class, in this gate's own source.)
//   - a regex containing an OPENING bracket (`/{/ `, `/[/ `, `/(/ `):
//     this artificially INCREMENTS depth with no matching real
//     decrement, so the statement's real terminator is read at depth > 0
//     and never fires. This is UNGUARDED against by clamping (there is
//     no floor on the wrong side) -- but it degrades to the FAIL-CLOSED
//     path (a bounded miss, region discarded), never to an overrun. Not
//     separately test-cased here because it is the SAME fail-closed
//     branch the five red-then-green tests already exercise, on a
//     different trigger.
export function noticeRegion(text, blockName) {
  const start = text.indexOf('const ' + blockName);
  if (start === -1) return '';
  const eq = text.indexOf('=', start);
  if (eq === -1) return ''; // FAIL CLOSED: no '=' is not a bounded const statement
  let i = eq + 1;
  let depth = 0;
  let quote = null; // null | "'" | '"' | '`'
  let terminated = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === BS) { i++; continue; } // skip the escaped char, whatever it is
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      if (nl === -1) { i = text.length; break; } // comment runs to EOF -> unterminated
      i = nl; // the for-loop's own i++ lands one past the newline
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close === -1) { i = text.length; break; } // unterminated block comment
      i = close + 1; // land on the '/' of '*/'; the for-loop's i++ moves past it
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{' || c === '[' || c === '(') { depth++; continue; }
    // Clamp at 0: depth can never legitimately go negative in well-formed
    // JS, so a floor only ever ABSORBS a spurious close (from a regex
    // literal this scanner cannot parse) -- it never masks a real one,
    // because a real close is always paired with a real open this
    // scanner DID count.
    if (c === '}' || c === ']' || c === ')') { depth = Math.max(0, depth - 1); continue; }
    if (c === ';' && depth === 0) { i++; terminated = true; break; }
  }
  return terminated ? text.slice(start, i) : '';
}

// STRUCTURED SURFACE (ported from CoalMine's tableRegion/keysInTable
// verbatim in LOGIC -- the technique is shape-free by construction and
// nothing about it is CoalMine-specific). Region-bounded the same way, and
// the bound is re-verified here rather than assumed: this room's README
// ALSO carries a Commands table BEFORE its Configure table (the identical
// risk CoalMine's own comment names), and this room's Configure heading is
// itself EMOJI-prefixed (`## 🔧 Configure`) -- both checked directly, not
// asserted. `l.includes(heading)` matches `## 🔧 Configure` against the
// bare string 'Configure' correctly (a substring match, emoji-agnostic).
// Measured: bounded to the Configure section, this room's table yields
// 11/11 rows resolving to real schema keys, ZERO false positives, and the
// Commands table's 3 slash-command rows (`/coalledger:doc-structure`,
// `/coalledger:stats`, `/coalledger:update`) fall outside by CONSTRUCTION
// (the Commands heading precedes Configure in this README, so the region
// walk never reaches it) -- not by luck, the same distinction CoalMine's
// own comment draws.
function tableRegion(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.includes(heading));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,6}\s/.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

function keysInTable(text, heading) {
  const out = new Set();
  for (const ln of tableRegion(text, heading)) {
    const m = ROW_KEY.exec(ln);
    if (m) out.add(m[1]);
  }
  return out;
}

// THIRD PORT DEFECT, verified before fixing: CoalMine's own JS_STRING
// matches SINGLE-quoted literals only. This room's single richest notice
// -- DRIFT_LINE, the one that names `docsDriftNudge` by name -- is
// DOUBLE-quoted (confirmed by grep: HEAD/TAIL/CANARIES.line are all
// single-quoted, DRIFT_LINE alone is double-quoted). A straight port would
// silently never scan the one string most likely to carry a real key
// mention. Fixed by running the same escape-aware literal-content matcher
// once per quote character and merging the results, rather than widening
// one regex to an alternation that would make backreference-free escape
// handling awkward for no benefit.
function jsStringContents(text) {
  const out = [];
  for (const q of ["'", '"']) {
    const re = new RegExp(q + '((?:' + BS + BS + '.|[^' + q + BS + BS + '])*)' + q, 'g');
    for (const m of text.matchAll(re)) out.push(m[1]);
  }
  return out;
}

// Blank out escape sequences BEFORE scanning a literal's contents, same
// reason as CoalMine's: two characters of an escape fuse with the
// following word and manufacture a phantom identifier otherwise.
const JS_ESCAPE = new RegExp(BS + BS + '[a-zA-Z]', 'g');

function candidatesInHookStrings(text, blockNames) {
  const out = new Set();
  for (const blockName of blockNames) {
    const region = noticeRegion(text, blockName);
    if (!region) continue; // a room supplying a block name this file lacks contributes nothing, silently
    for (const lit of jsStringContents(region)) {
      const clean = lit.replace(JS_ESCAPE, ' ');
      for (const id of clean.matchAll(IDENT)) if (KEY_SHAPE.test(id[1])) out.add(id[1]);
    }
  }
  return out;
}

// findings: [{ level, msg }] — same shape every other verify.mjs check
// returns. `read` is injected so the caller owns file IO (and a test can
// drive it in-memory).
export function checkConfigKeys({
  schemaKeys, mdFiles = [], hookFiles = [], read,
  noticeBlocks = ['CANARIES', 'HEAD', 'TAIL', 'DRIFT_LINE'],
  keyTables = [], // [{ file, heading }] — a room's own key table(s); see tableRegion above
  pending = PENDING_KEYS,
  notConfig = NOT_CONFIG,
  blind = BLIND_KEYS,
}) {
  const findings = [];
  const known = new Set(schemaKeys);

  // PRECONDITION — a HARD GATE, not a printed note. Any key the schema
  // declares that KEY_SHAPE cannot see must be DECLARED in BLIND_KEYS with
  // its reason, or the gate FAILs rather than silently checking less than
  // it claims.
  const invisible = [...known].filter((k) => !KEY_SHAPE.test(k)).sort();
  const accepted = invisible.filter((k) => Object.hasOwn(blind, k));
  if (accepted.length) {
    findings.push({
      level: 'SKIP',
      msg: 'blind to ' + accepted.length + ' DECLARED schema key(s) this gate cannot detect: '
        + accepted.join(', ') + ' — named on any surface they are read and discarded, so the '
        + 'pass line above does not cover them (accepted in BLIND_KEYS)',
    });
  }
  for (const k of invisible) {
    if (Object.hasOwn(blind, k)) continue;
    findings.push({
      level: 'FAIL',
      msg: 'schema key ' + k + ' cannot be detected by this gate (it does not match the '
        + 'camelCase-with-an-internal-capital shape), so any mention of it in docs is read and '
        + 'discarded. Declare it in BLIND_KEYS with the reason it is accepted, or rename the key',
    });
  }
  const seen = new Map(); // candidate -> Set(file)
  const unreadable = [];  // a surface the caller named but we could not read
  const tableReported = new Set(); // already reported by the structured pass; do not double-report

  const note = (tok, file) => {
    if (!seen.has(tok)) seen.set(tok, new Set());
    seen.get(tok).add(file);
  };

  for (const f of mdFiles) {
    let text;
    try { text = read(f); } catch { unreadable.push(f); continue; } // absent surface is not a finding
    for (const tok of candidatesInMarkdown(text)) note(tok, f);
  }
  for (const f of hookFiles) {
    let text;
    try { text = read(f); } catch { unreadable.push(f); continue; }
    for (const tok of candidatesInHookStrings(text, noticeBlocks)) note(tok, f);
  }

  // STRUCTURED PASS — shape-FREE: inside a declared key table the first
  // cell is a key by the table's own contract, so a lowercase key that
  // free prose can never expose is caught here.
  for (const { file, heading } of keyTables) {
    let text;
    try { text = read(file); } catch { unreadable.push(file); continue; }
    for (const tok of keysInTable(text, heading)) {
      note(tok, file);
      if (known.has(tok) || Object.hasOwn(notConfig, tok) || Object.hasOwn(pending, tok)) continue;
      tableReported.add(tok);
      findings.push({
        level: 'FAIL',
        msg: 'key table ' + file + ' (under "' + heading + '") documents ' + tok
          + ', which does not resolve in the schema — a table row IS a key claim whatever its shape, '
          + 'so this is caught even where the prose rule is blind. Implement it, or declare it in '
          + 'PENDING_KEYS / NOT_CONFIG',
      });
    }
  }

  // THE CHECK. A named token must resolve, or be declared.
  for (const [tok, files] of [...seen].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (known.has(tok)) continue;
    if (tableReported.has(tok)) continue; // the structured pass already named it
    if (Object.hasOwn(notConfig, tok)) continue;
    if (Object.hasOwn(pending, tok)) continue;
    findings.push({
      level: 'FAIL',
      msg: 'config key ' + tok + ' is named in ' + [...files].sort().join(', ') + ' but does not resolve in the schema '
        + '— implement it, or declare it in PENDING_KEYS (planned, with its ticket) or NOT_CONFIG (never a key, with its reason)',
    });
  }

  // SELF-CLEANING RULE 1 — a declaration that is no longer true.
  for (const tok of Object.keys(pending)) {
    if (known.has(tok)) findings.push({ level: 'FAIL', msg: 'PENDING_KEYS lists ' + tok + ', but it now resolves in the schema — implemented, so delete the entry' });
  }
  for (const tok of Object.keys(notConfig)) {
    if (known.has(tok)) findings.push({ level: 'FAIL', msg: 'NOT_CONFIG lists ' + tok + ' as never-a-config-key, but it now resolves in the schema — the entry is a lie, delete it' });
  }
  for (const tok of Object.keys(blind)) {
    if (!known.has(tok)) {
      findings.push({ level: 'FAIL', msg: 'BLIND_KEYS declares ' + tok + ', but it is not in the schema at all — the key is gone, delete the entry' });
    } else if (KEY_SHAPE.test(tok)) {
      findings.push({ level: 'FAIL', msg: 'BLIND_KEYS declares ' + tok + ' as undetectable, but it now matches the shape rule — the gate can see it, delete the entry' });
    }
  }

  // SELF-CLEANING RULE 2 — a declaration protecting nothing is dead weight.
  // GATED ON A COMPLETE SCAN: a partial scan may not convict a declaration
  // (a room's own fixture directories legitimately omit README.md, and
  // that must SKIP, never FAIL, the declarations sourced from it).
  if (unreadable.length) {
    findings.push({ level: 'SKIP', msg: 'declaration-pruning not checked: ' + unreadable.length + ' named surface(s) unreadable (' + unreadable.slice(0, 3).sort().join(', ') + (unreadable.length > 3 ? ', ...' : '') + ') — a partial scan cannot prove a declaration is dead' });
  } else {
    for (const [tok, why] of [...Object.entries(pending), ...Object.entries(notConfig)]) {
      if (!seen.has(tok)) findings.push({ level: 'FAIL', msg: 'no scanned surface names ' + tok + ' (' + why + ') — the declaration protects nothing, delete it' });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// CWK-064 — ONE CONFIG-READ PATH PER ROOM. No key is read from a BARE
// project config file, by hook or by agent instruction: every read goes
// through the global+project MERGE (config-load.mjs's loadMergedConfig /
// mergeSafety), so the consent clamp (hooks-safety.md §9) has a path to it
// at all. Owner-authorised as flock convention without a sheet press —
// "a measured improvement lands WITHOUT a press if it lands as the one
// flock convention" — so this check states the rule as binding, not as a
// proposal.
//
// WHY THIS IS A SEPARATE CHECK FROM checkConfigKeys ABOVE, not a branch
// inside it: that check asks "does a NAMED key resolve in the schema?" —
// a naming question. This asks "does a resolving key's OWN NAME, mentioned
// beside the raw file, describe the CLAMPED read path or a bare one?" — a
// DIFFERENT question about an already-real key, with its own detection
// rule, its own surface set, and its own declaration list. Sharing one
// function would conflate two independent failure modes behind one name.
//
// WHY IT IS NEEDED: CWK-060's own gate proved the cascade ITSELF is
// correct — a hermetic probe (a bare global `scanEverything: true`, no
// project file present) correctly reaches `clampedRead` through
// `loadMergedConfig`. The defect is a SECOND, UNCLAMPED read path: an
// agent instruction telling the reader to consult `.coalledger.json`
// directly, bypassing the merge the clamp exists to protect. Measured
// live in this room's OWN ship-text, not hypothetical: 7 lines across 6
// of 7 `skills/*/SKILL.md` name the file bare, beside a real schema key,
// with no cascade language anywhere in the line.
//
// DETECTION RULE, measured on THIS repo's OWN surfaces before being
// chosen — same discipline as KEY_SHAPE above, and this one needed far
// less correction because the finite key list is ALREADY known: a
// candidate LINE mentions the literal string '.coalledger.json' AND a
// real schema key's name (whole-word match — no shape inference needed,
// unlike KEY_SHAPE, because we are not discovering an unknown token, we
// are checking a name we already have).
//
//   Measured: 10 candidate lines across 10 doc + command surfaces (the 7
//   skills/*/SKILL.md + README.md + commands/stats.md + commands/
//   update.md). 7 are the real defect, reproducing the dispatch's own
//   count exactly (doc-structure:21 severityFloor · doc-grounding:15,
//   doc-quality:15, doc-rot:15, doc-standard:15 quickVsFull ·
//   doc-leak:4, doc-leak:14 docLeak). 2 are legitimately describing the
//   CASCADE itself — README.md:103's "resolved in this order (first
//   found wins)" mechanism paragraph, and commands/stats.md:11's own
//   "global + project merge" wording, the shape every OTHER mention
//   should match. 1 needs a declared exception — commands/update.md:9's
//   hand-edit-with-no-checkout fallback, which EDITS the file directly
//   rather than reading a key FROM it to make a decision.
//   Zero candidates in CHANGELOG.md / CONTRIBUTING.md / SECURITY.md /
//   PRIVACY.md (measured, not assumed) — same OUT verdict as
//   checkConfigKeys above, independently re-confirmed for this rule.
//
// THE CASCADE-QUALIFIER TEST: a candidate line is exempt if it ALSO
// contains both 'global' and 'project' (case-insensitive) — the two
// words every correct cascade description in this room already uses
// together, and neither word appears in any of the 7 real defect lines.
// Chosen over a stricter verbatim-phrase match ("global + project
// merge") because the two correct exemplars do not share one fixed
// wording, only the two CONCEPTS — a verbatim match would have missed
// one of them (README.md:103 never says "merge" at all).
//
// RESIDUE, NAMED NOT GUARDED: this is a LINE-level heuristic, not a
// parser. A future line could mention 'global'/'project' as decoys
// without genuinely describing the merge (a false exemption), or split a
// genuine bare-read across two lines (a false miss). Neither is
// reachable in this repo's CURRENT text — stated as the honest ceiling
// of a 2-word co-occurrence test, not implied gone.
//
// SCOPE: skills/*/SKILL.md + README.md + commands/*.md — surfaces an
// AGENT READS AS PROSE to decide what to do. Deliberately EXCLUDES
// hooks/*.js: a hook's own notice strings are DISPLAYED TO THE USER
// (telling them which key to toggle), never CONSULTED BY THE AGENT as a
// read instruction — a different risk shape than SKILL.md prose, and the
// hook's own CODE already reads exclusively through loadMergedConfig
// (config-load.test.mjs's suite already proves this for every hook-read
// key). One candidate line WAS found there in this room's own text —
// `coalledger-drift-stop.js`'s DRIFT_LINE names
// "docsDriftNudge=false in .coalledger.json" — and is OUT by this
// reasoning, not by oversight: it tells a HUMAN where a switch lives, it
// does not instruct anyone to open the file to decide anything.
// Also excludes platform-configs/.coalledger.json itself, which IS the
// config file, not prose about reading one.
export const READ_PATH_EXCEPTIONS = {
  'commands/update.md:updateMode': 'the hand-edit-with-no-checkout fallback EDITS the file directly (node scripts/configure.mjs, or a manual edit) -- a write target, never a read instruction',
  'commands/update.md:updateCheckDays': 'same line as updateMode, same reason -- the hand-edit fallback names both keys together',
};

export function checkConfigReadPath({ schemaKeys, mdFiles = [], read, exceptions = READ_PATH_EXCEPTIONS }) {
  const findings = [];
  const seenExceptions = new Set();
  const unreadable = [];
  for (const f of mdFiles) {
    let text;
    try { text = read(f); } catch { unreadable.push(f); continue; } // absent surface is not a finding
    // Normalize to '/', matching this module's own declaration convention
    // (READ_PATH_EXCEPTIONS is keyed 'commands/update.md:...') -- a caller
    // handing in `path.join(...)`-built paths (as verify.mjs's own callers
    // for hookFiles/mdFiles already do elsewhere in this file) produces
    // '\\'-joined paths on Windows, which would otherwise never match a
    // forward-slash exception key and silently degrade every declared
    // exception into a permanent FAIL on this platform. Measured live
    // before this fix: exactly that, on this box.
    const fNorm = f.replace(/\\/g, '/');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (!line.includes('.coalledger.json')) return;
      const hitKeys = schemaKeys.filter((k) => new RegExp('\\b' + k + '\\b').test(line));
      if (!hitKeys.length) return;
      if (/global/i.test(line) && /project/i.test(line)) return; // the cascade is named -- exempt
      for (const key of hitKeys) {
        const id = fNorm + ':' + key;
        if (Object.hasOwn(exceptions, id)) { seenExceptions.add(id); continue; }
        findings.push({
          level: 'FAIL',
          msg: fNorm + ':' + (idx + 1) + ' names `.coalledger.json` beside the key `' + key
            + '` with no cascade language (global+project) — a BARE, unclamped read path. Route through '
            + 'the global+project merge (see commands/stats.md:11 for the correct wording), or declare '
            + 'the mention in READ_PATH_EXCEPTIONS with the reason it is not a read instruction',
        });
      }
    });
  }
  // SELF-CLEANING, same EVENT-expiry discipline as the three lists above:
  // an exception protecting nothing (no scanned line matches it any more)
  // is dead weight and FAILs. Gated on a complete scan, same reason.
  if (unreadable.length) {
    findings.push({ level: 'SKIP', msg: 'read-path exception pruning not checked: ' + unreadable.length + ' named surface(s) unreadable (' + unreadable.slice(0, 3).sort().join(', ') + (unreadable.length > 3 ? ', ...' : '') + ') — a partial scan cannot prove a declaration is dead' });
  } else {
    for (const id of Object.keys(exceptions)) {
      if (!seenExceptions.has(id)) findings.push({ level: 'FAIL', msg: 'READ_PATH_EXCEPTIONS declares ' + id + ', but no scanned line matches it any more — the declaration protects nothing, delete it' });
    }
  }
  return findings;
}
