// CWK-062 PRECONDITION — the flock's ONE em-dash instrument.
//
// WHAT IT FINDS: an UNSPACED em-dash in PROSE. A spaced em-dash ( — ) is
// correct and is never flagged; an em-dash with a non-space on either side
// (word—word, `code`—word, (paren)—word) is the defect.
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
//   - LICENSE / NOTICE / vendored text is skipped BY FILENAME at the caller's
//     level (see SKIP_FILES) -- never edit someone else's legal wording.
//   - QUOTATION is the one class this instrument CANNOT do reliably, and it is
//     stated rather than faked. Markdown has no syntactic marker for quoted
//     matter beyond a blockquote, so a > line is skipped and an inline quotation
//     inside a normal sentence IS STILL SCANNED. That is a KNOWN
//     OVER-REPORT: a hit inside quoted matter is a real hit of this instrument
//     and a false hit of the RULE. The caller adjudicates; the instrument does
//     not guess. This is the instrument's single largest reach limit.
import fs from 'node:fs';
import path from 'node:path';

const EMDASH = String.fromCharCode(0x2014);
const THAI = /[฀-๿]/;

// Third-party legal text, skipped by name wherever it sits.
export const SKIP_FILES = new Set(['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'NOTICE', 'NOTICE.md', 'NOTICE.txt']);

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
 * Scan one document's text. Returns [{ line, col, context }] — 1-based line.
 * Pure: takes text, never touches the filesystem, so a test can drive it.
 */
export function scanText(text) {
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
      // Unspaced on EITHER side is the defect. A line-edge em-dash has no
      // neighbour on that side and is not a word—word form.
      if (before === undefined || after === undefined) continue;
      if (/\s/.test(before) && /\s/.test(after)) continue; // correct, spaced
      hits.push({ line: i + 1, col: c + 1, context: raw.trim().slice(0, 120) });
    }
  }
  return hits;
}

export function scanFile(file) {
  if (SKIP_FILES.has(path.basename(file))) return [];
  return scanText(fs.readFileSync(file, 'utf8'));
}

// SELF-TEST — the positive control ships WITH the instrument, so a zero from a
// sweep is a MEASUREMENT rather than a silence and nobody has to prove
// liveness separately each round. Every case below is a red case first: run
// them against the naive /\w—\w/ and the two FIND cases pass wrongly.
const CASES = [
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
];

export function selfTest() {
  const fails = [];
  for (const [name, text, want] of CASES) {
    const got = scanText(text).length;
    if (got !== want) fails.push(`${name}: expected ${want}, got ${got}`);
  }
  return fails;
}

// CLI: node emdash.mjs [--selftest] <file...>
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
  let total = 0;
  for (const f of args.filter((a) => !a.startsWith('--'))) {
    let hits;
    try { hits = scanFile(f); } catch { console.log(`  --   unreadable, skipped: ${f}`); continue; }
    for (const h of hits) console.log(`${f}:${h.line}:${h.col}: ${h.context}`);
    if (hits.length) console.log(`  ${f}: ${hits.length}`);
    total += hits.length;
  }
  console.log(`TOTAL: ${total}`);
}
