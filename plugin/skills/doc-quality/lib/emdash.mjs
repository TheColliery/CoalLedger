// CWK-062 PRECONDITION, CWK-073 CONFIG-KEYED RULE — the flock's ONE em-dash
// instrument, now the engine behind doc-quality's `emDash` typography rule.
//
// TWO LIVES, ONE ENGINE. CWK-062 built this file as a ONE-TIME, hardcoded
// PRECONDITION MEASUREMENT: at that point every room's docs were 100% SPACED
// ( — ) and the question was "does any doc already carry an accidental
// UNSPACED em-dash the coming sweep needs to know about". That question has
// a single fixed answer-direction (unspaced = the thing to find) and is
// still what this file's DEFAULT behaviour answers — the zone's own canonical
// `CoalWorks/emdash.mjs` copy keeps exactly that hardcoded shape, unchanged,
// as a manual sweep tool (main's r21 ruling: it never becomes a per-room
// gate). CWK-073 asks a DIFFERENT, ONGOING question this room's doc-quality
// canary owns going forward, now that the house HAS a target convention
// (`word—word`, owner ruling 2026-09-03): "does this doc match the
// CONFIGURED direction". That needs a MODE, not a hardcoded polarity — see
// `scanText`'s own `mode` parameter below.
//
// THE POLARITY, stated once because it is easy to get backwards (and this
// unit nearly did): the CWK-062 default direction (flag UNSPACED, treat
// SPACED as correct) is what mode `'spaced'` means below — "spaced is the
// target convention". The house's OWN adopted convention is the OPPOSITE:
// `emDash: "unspaced"` means `word—word` is the target, so a SPACED em-dash
// is the finding (confirmed against CWK-062's own verification method: its
// reviewer greps for " — " and expects ZERO after the sweep — the SPACED
// form is what the sweep eliminates). `scanText`'s default parameter value
// preserves the ORIGINAL CWK-062 selftest cases byte-for-byte (they were
// written against the old hardcoded direction, which is mode `'spaced'`);
// the caller (doc-quality's Method) passes the CONFIGURED mode explicitly.
//
// WHY ONE INSTRUMENT. Seven rooms each grepping their own way produces seven
// incomparable numbers, which is worse than no sweep. The naive rule in use
// before this file, /\w—\w/, is blind to any em-dash whose neighbour is not a
// word character -- a backtick, a paren, a quote -- and a heading-shaped grep
// beside it produced TWO false flock counts. This file exists so a zero is one
// number produced one way.
//
// ZERO DEPENDENCIES (Phoenix #2), node built-ins only. NO ROOM LAYOUT: every
// target is an argument, so this runs from anywhere over anything.
//
// HONEST REACH -- the limits are stated because an instrument whose limits are
// unstated has a clean run that means an unknown amount:
//   - FENCED CODE is excluded by a real line-state machine (``` and ~~~, with
//     the closing fence required to be at least as long as the opener, per
//     CommonMark). A single-line regex structurally cannot do this.
//   - INLINE CODE is excluded by MASKING, not deleting: each span becomes the
//     same number of 'x' characters. Deleting would fuse its neighbours and
//     manufacture case is STRIPPING THE BACKTICKS ALONE, while deleting the
//     whole span yields a MISS instead (LOW-4, corrected: the earlier wording
//     named the wrong mechanism for the right rule). Masking is immune to both
//     because it preserves adjacency exactly, the property being measured.
//   - URLS AND LINK TARGETS are masked the same way: an em-dash inside an
//     address is part of the address. Covers ](...) destinations, <...>
//     autolinks, and bare http(s):// runs.
//   - THAI LINES are skipped whole (any char in U+0E00-U+0E7F). Thai follows
//     different rules and the owner's own prose is not in scope.
//   - BLOCKQUOTES are skipped whole (CWK-073 -- RULED, not silently kept: a
//     `>`-prefixed line is the one mechanically visible quotation marker
//     Markdown has, so it is treated as excluded quoted matter).
//   - LICENSE / NOTICE / COPYING / vendored text is skipped BY FILENAME at
//     the caller's level (see `isLegalPath`, CWK-073-widened past the
//     original two-name set) -- never edit someone else's legal wording. A
//     document that is third-party text WITHOUT a legal-shaped filename (an
//     embedded upstream quote inside an ordinary doc) is excluded instead by
//     a literal marker line, `THIRD_PARTY_MARKER` -- file-level, not
//     region-level: this instrument has no block state machine beyond
//     fences, and a region marker would need one. A room that needs finer
//     granularity moves the third-party text to its own file and names it.
//   - QUOTATION-WITHIN-PROSE is the one class this instrument CANNOT do
//     reliably, and it is stated rather than faked, even after the
//     blockquote ruling above. Markdown has no syntactic marker for an
//     INLINE quotation inside an ordinary sentence (an owner ruling or an
//     upstream quote run into prose, no `>` prefix) -- REJECTED as
//     undetectable (CWK-073): there is nothing left in plain Markdown to key
//     on short of natural-language quote-attribution parsing, which this
//     instrument does not attempt. That is a KNOWN OVER-REPORT: a hit inside
//     such a quotation is a real hit of this instrument and a false hit of
//     the RULE. The caller adjudicates; the instrument does not guess. This
//     is the instrument's single largest remaining reach limit.
import fs from 'node:fs';
import path from 'node:path';

const EMDASH = String.fromCharCode(0x2014);
const THAI = /[฀-๿]/;

// Third-party legal text, skipped by name wherever it sits -- WIDENED
// (CWK-073) past the original two-name set (`LICENSE`/`NOTICE`, exact
// basenames only) to a case-insensitive glob covering `LICENSE*`,
// `NOTICE*`, `COPYING*`, and a `docs/license.md`-CLASS rendering (any
// basename matching `license.md`/`notice.md`/`copying.md` regardless of
// which directory holds it). ONE regex, checked against the BASENAME only
// -- deliberately not a directory-scoped path glob: `docs/license.md` and
// `vendor/COPYING` and a bare root `LICENSE.txt` are the SAME class (a
// legally-shaped filename we did not author), and keying on the basename
// covers every one of them without an enumerated directory list that would
// need to be kept in sync with wherever a room happens to vendor such a
// file.
//
// THE SEPARATOR IS `.` ONLY, DELIBERATELY NOT `-` TOO (found while testing
// this very widening): a bare word-prefix glob over-matches an ORDINARY,
// house-authored doc that merely starts with the same word followed by a
// hyphen -- `notice-of-changes.md` is a real, plausible filename with
// nothing third-party about it, and a `-` separator would silently exempt
// it from every future em-dash check. The false-EXEMPTION direction is the
// unsafe one here (a real document goes unchecked, not merely unflagged),
// so the glob is narrowed to what an actual legal-text filename looks like
// in practice: the bare word, or the bare word plus an extension.
//
// THE RESIDUE, in the OTHER direction (LOW-1, INSPECT r31, named so the
// header states both sides of the choice it made): the `.`-only narrowing
// misses the near-universal dual-licence convention -- `LICENSE-MIT`,
// `LICENSE-APACHE`, `licenses/THIRD-PARTY.md` all read `checked`, not
// exempt, and a room adopting `unspaced` on such a repo would get findings
// on verbatim upstream licence text nobody here authored. Measured ZERO
// live exposure across all seven Coal* rooms (every one carries bare
// `LICENSE` + `NOTICE`) -- a portability residue, not a live defect. A
// room that hits it names the file with `THIRD_PARTY_MARKER` instead;
// widening the glob itself is declined, per the false-EXEMPTION reasoning
// above.
const LEGAL_BASENAME_RE = /^(LICENSE|NOTICE|COPYING)(\..+)?$/i;
export function isLegalPath(file) {
  return LEGAL_BASENAME_RE.test(path.basename(file));
}

// A "third-party text" marker (CWK-073), for verbatim third-party wording
// that does NOT live in a LICENSE/NOTICE/COPYING-named file (an embedded
// upstream quote, a vendored snippet inside an otherwise-ordinary doc). The
// marker excludes the WHOLE document -- see the header's own note on why
// this is file-level, not region-level.
//
// STANDALONE LINE ONLY (fixback, INSPECT r31 MED-1): the check is a
// line-anchored regex, never a raw `String.includes` over the whole text.
// A `.includes` scan matches the marker EVERYWHERE, including inside a
// code span and inside ordinary prose that merely NAMES it -- and prose
// naming it is exactly what a CHANGELOG entry describing this feature
// does. CoalLedger's own `CHANGELOG.md` proved the hole the day this
// shipped: its `### Added` bullet writes the marker literally to describe
// it, which switched the em-dash rule off for the entire 61 KB file (157
// findings under `mode=unspaced` at the ref before this fix, 0 after --
// both silently, with no signal). A standalone-line requirement is how
// such a marker is conventionally placed anyway (the top of a vendored
// file), it needs no new mechanism (the file already line-scans), and it
// is mechanically decidable -- a doc that names the marker in running
// prose or inside a code span is unaffected and stays fully scanned.
export const THIRD_PARTY_MARKER = '<!-- third-party-text -->';
const THIRD_PARTY_MARKER_RE = new RegExp(
  '^[ \\t]*' + THIRD_PARTY_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*$',
  'm'
);

// Mask a run to same-length 'x' so adjacency is preserved and no hit is
// manufactured by fusing the neighbours of a deleted span.
const mask = (s) => 'x'.repeat(s.length);

// Order matters: code spans first (a URL inside a code span is code, not a
// URL), then link destinations, then autolinks, then bare URLs.
function maskInline(line) {
  // A span closes on a run of the SAME length as its opener, so a shorter run
  // INSIDE a longer delimiter stays part of the span (LOW-3, INSPECT-found:
  // the prior single-run regex ended the span at the inner backtick of ``a`b``).
  let out = line.replace(/(`+)[\s\S]*?\1/g, mask);
  out = out.replace(/\]\([^)]*\)/g, mask);
  out = out.replace(/<[^ >]*>/g, mask);
  out = out.replace(/https?:\/\/\S+/g, mask);
  return out;
}

// A fence opens with >=3 backticks or tildes and closes with a fence of the
// SAME character and AT LEAST the same length (CommonMark).
function fenceInfo(line) {
  const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
  return m ? { ch: m[1][0], len: m[1].length } : null;
}

/**
 * Scan one document's text for a mismatch against the configured em-dash
 * convention. Returns [{ line, col, context }] — 1-based line. Pure: takes
 * text, never touches the filesystem, so a test can drive it.
 *
 * `mode` is `'unspaced'` | `'spaced'` | `'off'` (CWK-073's `emDash` config
 * values), DEFAULTING to `'spaced'` -- the CWK-062 PRECONDITION's own
 * original hardcoded direction, preserved so every pre-existing selftest
 * case below keeps passing unmodified. `'unspaced'` is the house's own
 * adopted convention (`word—word`) and is the mode doc-quality's Method
 * actually passes at runtime; `'off'` short-circuits to no findings, the
 * same guarantee the caller already gets by simply not invoking this
 * function, restated here for defense in depth.
 *   'unspaced' — word—word is correct; a SPACED em-dash is the finding.
 *   'spaced'   — the inverse (this file's original, still-default shape).
 */
export function scanText(text, mode = 'spaced') {
  if (mode === 'off') return [];
  if (THIRD_PARTY_MARKER_RE.test(String(text))) return [];
  const hits = [];
  let fence = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const f = fenceInfo(raw);
    if (fence) {
      if (f && f.ch === fence.ch && f.len >= fence.len) fence = null;
      continue; // inside a fence: content, never typography
    }
    if (f) { fence = f; continue; }
    if (THAI.test(raw)) continue;              // Thai line: out of scope
    if (/^\s{0,3}>/.test(raw)) continue;       // blockquote: quoted matter
    // INDENTED CODE BLOCK (LOW-1/LOW-2, INSPECT-found): 4+ leading spaces is
    // Markdown's other code form, and a fence indented that far inside a list
    // item is not matched by fenceInfo's 0-3 space rule either. Skipping the
    // line covers both. STATED TRADE, not a silent one: indented CONTINUATION
    // text inside a list item is skipped too, so this OVER-excludes -- it can
    // miss a real hit, never manufacture one. A miss is the safe direction for
    // an instrument seven rooms will trust; the alternative needs a list-state
    // machine, which is a parser, which is not what this is.
    if (/^ {4,}\S/.test(raw)) continue;
    const line = maskInline(raw);
    for (let c = 0; c < line.length; c++) {
      if (line[c] !== EMDASH) continue;
      // EMPHASIS MARKERS ARE ZERO-WIDTH IN THE RENDERED OUTPUT, so adjacency
      // is measured against the nearest NON-MARKER character on each side.
      // FOUND BY THE SWEEP, not by design: this room's own CHANGELOG carries
      // `keys) **{EMDASH} all 8` -- a correctly SPACED em-dash that merely
      // opens a bold run. Reading the raw neighbour saw `*` and flagged it.
      // Treating markers as whitespace instead would be the opposite error:
      // `word**{EMDASH}**word` renders as an unspaced em-dash between two
      // words and MUST still fire. Skipping them gets both right.
      const skip = (i, step) => {
        let j = i;
        while (line[j] === '*' || line[j] === '_') j += step;
        return line[j];
      };
      const before = skip(c - 1, -1);
      const after = skip(c + 1, 1);
      // A line-edge em-dash has no neighbour on that side and is not a clean
      // instance of either convention -- never a finding under either mode.
      if (before === undefined || after === undefined) continue;
      const spacedBoth = /\s/.test(before) && /\s/.test(after);
      const unspacedBoth = !/\s/.test(before) && !/\s/.test(after);
      // MODE DECIDES WHICH SHAPE IS CORRECT; anything that is neither a clean
      // instance of the correct shape NOR (symmetrically) already excluded
      // above is a finding -- this includes a MIXED case (one side spaced,
      // one side not), which is a defect under BOTH conventions, matching
      // this file's own original symmetric rule (mode 'spaced': anything
      // that is not fully-spaced fires, mixed included).
      const isCorrect = mode === 'unspaced' ? unspacedBoth : spacedBoth;
      if (isCorrect) continue;
      hits.push({ line: i + 1, col: c + 1, context: raw.trim().slice(0, 120) });
    }
  }
  return hits;
}

export function scanFile(file, mode = 'spaced') {
  if (mode === 'off') return [];
  if (isLegalPath(file)) return [];
  return scanText(fs.readFileSync(file, 'utf8'), mode);
}

// SELF-TEST — the positive control ships WITH the instrument, so a zero from a
// sweep is a MEASUREMENT rather than a silence and nobody has to prove
// liveness separately each round. Every case below is a red case first: run
// them against the naive /\w—\w/ and the two FIND cases pass wrongly.
// Exported so `emdash.test.mjs` drives the SAME table via `node:test` (one
// source of truth for both the CLI --selftest and the automated gate).
//
// [name, text, expected hit count, mode?] -- `mode` omitted = the default
// ('spaced', the ORIGINAL CWK-062 direction); every case written before
// CWK-073 stays a 3-tuple, unmodified, so the original 17 keep passing
// byte-for-byte. New CWK-073 cases (the 'unspaced' polarity and the
// exclusion-class widenings) are 4-tuples that say so explicitly.
export const CASES = [
  // [name, text, expected hit count]
  ['plain word-word', 'alpha' + EMDASH + 'beta', 1],
  ['spaced is correct', 'alpha ' + EMDASH + ' beta', 0],
  ['RED-1 backtick-adjacent -- guards MASKING (naive /w-w/ misses it; see RED-1b for the neighbour rule)', '`code`' + EMDASH + 'word', 1],
  ['RED-1b paren-adjacent -- guards the NEIGHBOUR rule (no mask involved, naive misses it)', '(paren)' + EMDASH + 'word', 1],
  ['RED-3 no em-dash at all (## Reporting class)', '## Reporting', 0],
  ['masking does not fuse neighbours', '`a`' + EMDASH + '`b`', 1],
  ['inline code content excluded', '`a' + EMDASH + 'b`', 0],
  ['fenced block excluded', '```' + '\na' + EMDASH + 'b\n' + '```', 0],
  ['fence needs same char to close', '```' + '\na' + EMDASH + 'b\n~~~\nc' + EMDASH + 'd\n```', 0],
  ['link destination excluded', '[t](http://x' + EMDASH + 'y)', 0],
  ['autolink excluded', '<http://x' + EMDASH + 'y>', 0],
  ['bare url excluded', 'see http://x' + EMDASH + 'y now', 0],
  ['thai line skipped', 'ทดสอบ a' + EMDASH + 'b', 0],
  ['blockquote skipped', '> quoted a' + EMDASH + 'b', 0],
  ['line-edge em-dash is not word-word', EMDASH + 'lead', 0],
  ['SWEEP-FOUND: spaced em-dash opening a bold run is CORRECT', 'keys) **' + EMDASH + ' all 8**', 0],
  ['SWEEP-FOUND: bold-wrapped em-dash between words still fires', 'word**' + EMDASH + '**word', 1],

  // CWK-073 -- the 'unspaced' mode is the house's own adopted convention and
  // is a full polarity FLIP of the block above, proven by mirroring the same
  // pairs rather than inventing new ones.
  ['CWK-073 unspaced mode: word-word is now CORRECT', 'alpha' + EMDASH + 'beta', 0, 'unspaced'],
  ['CWK-073 unspaced mode: a SPACED em-dash is now the FINDING', 'alpha ' + EMDASH + ' beta', 1, 'unspaced'],
  ['CWK-073 unspaced mode: masking + neighbour rule still apply (backtick-adjacent, correct)', '`code`' + EMDASH + 'word', 0, 'unspaced'],
  ['CWK-073 unspaced mode: exclusions are mode-independent (fenced block)', '```' + '\na ' + EMDASH + ' b\n' + '```', 0, 'unspaced'],
  ['CWK-073 unspaced mode: a MIXED case is a finding under this mode too', 'word ' + EMDASH + 'word', 1, 'unspaced'],
  ['CWK-073 off mode: never fires, whatever the text', 'alpha' + EMDASH + 'beta alpha ' + EMDASH + ' beta', 0, 'off'],
  ['CWK-073 third-party marker excludes the WHOLE document', THIRD_PARTY_MARKER + '\nalpha' + EMDASH + 'beta', 0, 'unspaced'],
];

export function selfTest() {
  const fails = [];
  for (const [name, text, want, mode] of CASES) {
    const got = scanText(text, mode).length;
    if (got !== want) fails.push(`${name}: expected ${want}, got ${got}`);
  }
  return fails;
}

// CLI: node emdash.mjs [--selftest] [--mode=unspaced|spaced] <file...>
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) {
    const fails = selfTest();
    if (fails.length) {
      for (const f of fails) console.log('  FAIL ' + f);
      console.log(`SELFTEST: FAIL (${fails.length}/${CASES.length})`);
      process.exitCode = 1;
    } else {
      console.log(`SELFTEST: PASS (${CASES.length}/${CASES.length}) — the instrument is live, so a zero below is a measurement`);
    }
  }
  const modeArg = args.find((a) => a.startsWith('--mode='));
  const mode = modeArg ? modeArg.slice('--mode='.length) : 'spaced';
  if (mode !== 'unspaced' && mode !== 'spaced' && mode !== 'off') {
    console.log(`FAIL: --mode must be 'unspaced', 'spaced', or 'off' (got '${mode}')`);
    process.exitCode = 1;
  } else {
    let total = 0;
    for (const f of args.filter((a) => !a.startsWith('--'))) {
      let hits;
      try { hits = scanFile(f, mode); } catch { console.log(`  --   unreadable, skipped: ${f}`); continue; }
      for (const h of hits) console.log(`${f}:${h.line}:${h.col}: ${h.context}`);
      if (hits.length) console.log(`  ${f}: ${hits.length}`);
      total += hits.length;
    }
    console.log(`TOTAL: ${total}`);
  }
}
