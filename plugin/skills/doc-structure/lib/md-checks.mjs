#!/usr/bin/env node
// CoalLedger md-checks — the MECHANICAL doc-structure checks, built ONLY on the
// md-ast tree (never regex over raw markdown — the anti-cry-wolf property the
// whole suite stands on, blueprint §2). Deterministic DETECTION only:
// findings carry NO severity field ON PURPOSE — severity needs CONTEXT
// (a broken link in an archived doc = LOW, a wrong security anchor = CRITICAL)
// and is assigned by the agent per the doc-structure SKILL contract (§6).
//
// Checks (ids are stable API):
//   heading-skip        heading level jumps down more than one (h1 -> h3)
//   heading-multiple-h1 more than one top-level heading in a doc
//   heading-duplicate   two sibling headings (same parent node) with identical
//                       rendered text — a plain #slug link reaches only the
//                       FIRST heading in the whole document to CLAIM that
//                       slug, which can be neither one of the pair: slug
//                       claims are text-INDEPENDENT (first-come, document
//                       order), so an earlier heading with DIFFERENT text can
//                       claim the slug before either duplicate gets a look
//                       (the CHECK is sibling-scoped, the SLUG claim is not);
//                       suffixed anchors are order-fragile. Format-
//                       general (markdown, HTML id, screen-reader). Siblings-
//                       only: CHANGELOG ### Added under different ## versions
//                       is NOT flagged (different parent nodes). Keyed on text,
//                       not slug — "Setup!" and "Setup" are not flagged (MD024)
//   anchor-missing      #fragment (same-file or file.md#frag) resolves to no
//                       heading slug / HTML id — incl. a case-mismatch hint
//   file-missing        relative link/image/definition target absent on disk
//   table-ragged        body row with MORE cells than the header (GitHub drops
//                       the extras — silent content loss; FEWER cells pad
//                       empty and render fine, so they are NOT flagged)
//   ref-undefined       full/collapsed reference [text][label] with no
//                       definition (renders as literal brackets on GitHub)
//   def-orphan          a [label]: definition no reference ever uses
//   bare-url            a raw http(s)/www URL in prose text (GFM auto-links
//                       it, CommonMark does not; MD034 class — style signal)
//   image-alt-missing   image or image-reference with empty/whitespace-only
//                       alt — covers inline images (![alt](url)) and every
//                       imageReference form (full/collapsed/shortcut).
//                       SUSPECTED-ONLY, ALWAYS — carries
//                       finding.suspected = true and is never promoted to
//                       CONFIRMED: empty alt is WCAG-1.1.1-CORRECT for a
//                       purely decorative image, so decorative-vs-content
//                       intent is a human call the engine cannot make (MD045)
//   doc-too-large       pre-parse short-circuit: input over MAX_DOC_BYTES is
//                       refused, never parsed. Covers SIZE only — a small
//                       doc with deep container nesting is a SEPARATE
//                       parser-DoS vector, gated by doc-too-nested below
//                       (board U13/F1)
//   doc-too-nested      pre-parse short-circuit: blockquote/list container
//                       nesting over MAX_CONTAINER_DEPTH is refused, never
//                       parsed — deep container-marker runs (any mix of
//                       `>`, `-`/`+`/`*`, `N.`/`N)`, NOT blockquote alone)
//                       make the block parser go super-linear (measured:
//                       30,000 markers ~38s) well under MAX_DOC_BYTES;
//                       fence-aware (never fires on `>` inside a fenced
//                       code block); a try/catch around parseMarkdown is
//                       the backstop for whatever this guard doesn't
//                       enumerate (board U13/F1, corrected in the
//                       findings-back round: the first version was
//                       blockquote-only and fence-blind)
//   doc-unreadable      pre-parse short-circuit: a NUL byte in the first 8 KB
//                       (binary/corrupted input) is refused, never parsed —
//                       ALSO the label used when parseMarkdown itself throws
//                       past the doc-too-nested guard (an unenumerated
//                       structural pathology), never a silent crash
//
// Known limits (honest ceiling, mirrors md-ast.mjs):
//   - site-root-relative targets (/path) are SKIPPED — resolving them needs a
//     repo root this module does not assume (no-external-assumption).
//   - bare-url columns inside multi-line text nodes are line-accurate,
//     column-approximate.
//   - this is a STRUCTURAL scanner, not a content validator: garbled-but-NUL-
//     free text (valid UTF-8, no real structure) parses to a near-empty tree
//     — "0 findings" there means "nothing structurally broken found," not
//     "content verified sane." (CORRECTED, board U13/F1: an earlier version
//     of this note claimed "parseMarkdown never throws" — false; it throws
//     RangeError on pathological nesting. checkDocument's own guards catch
//     that before it reaches a caller — see doc-too-nested above — but
//     parseMarkdown called directly, bypassing checkDocument, has no such
//     protection.)
//   - anchorsOf's catch->null treats every unreadable linked target alike
//     (missing, permission-denied, bad encoding) — a cross-file anchor check
//     is silently skipped rather than reported as its own finding.
// Language-neutral: anchors resolve through the Unicode slugger + a
// decodeURIComponent pass, so Thai/CJK headings and percent-encoded fragments
// match exactly (blueprint §4).
//
// Zero external deps (node built-ins only). CLI at the bottom:
//   node md-checks.mjs [--json] <file.md> [more.md ...]
// (path-free on purpose: these exact bytes live in TWO homes — scripts/lib/ and
// the generated skills/doc-structure/lib/ copy — so any location-specific path
// here would be wrong in one of them.)

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseMarkdown, walk, textContent, makeSlugger, githubSlug } from './md-ast.mjs';

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
// A real anchor id/name only — the negative lookbehind for a word-char or hyphen
// stops `data-id=`, `aria-*=`, `item-name=` etc. from registering a FALSE anchor
// (which would let a genuinely-broken #link pass anchor-missing). HTML comments
// are stripped before this runs (an id inside <!-- --> is never a live anchor).
const HTML_ID_RE = /(?<![\w-])(?:id|name)\s*=\s*(?:"([^"]+)"|'([^']+)')/g;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
// A SINGLE pass can leave a residual comment on overlapping/adjacent markers
// (`<!--<!---->-->`), so strip to a FIXED POINT — repeat until nothing changes.
function stripHtmlComments(s) {
  let prev;
  do { prev = s; s = s.replace(HTML_COMMENT_RE, ''); } while (s !== prev);
  return s;
}
const BARE_URL_RE = /(?:https?:\/\/|www\.)[^\s<>"')\]]+/g;

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// All anchor targets a rendered doc exposes: heading slugs (GitHub dedupe
// order) + explicit ids/names inside passthrough HTML.
export function collectAnchors(root) {
  const slugger = makeSlugger();
  const anchors = new Set();
  walk(root, (node) => {
    if (node.type === 'heading') anchors.add(slugger.slug(textContent(node)));
    if (node.type === 'html') {
      const html = stripHtmlComments(node.value);
      HTML_ID_RE.lastIndex = 0;
      let m;
      while ((m = HTML_ID_RE.exec(html)) !== null) anchors.add(m[1] != null ? m[1] : m[2]);
    }
  });
  return anchors;
}

// Core entry: check ONE document. opts:
//   filePath   absolute or cwd-relative path of the doc (enables relative-file
//              and cross-file-anchor checks; omit for pure in-memory checks)
//   fileExists / readFile   injectable fs (hermetic tests); default real fs
// A structural health scan never needs to parse a megabyte-scale doc. The parser's
// super-linear paths are fixed at the algorithm level (linear emphasis processing +
// bounded inline-dest/backtick scans in md-ast.mjs); this cap is the BACKSTOP that
// bounds absolute worst-case wall time (incl. the remaining native-scan paths like
// reference-label/table) AND closes the transitive linked-file parses below. Real
// READMEs/specs sit far under this.
const MAX_DOC_BYTES = 512 * 1024; // 512 KB

// board U13/F1: nested container markers (blockquote `>`, list `-`/`+`/`*`/
// `N.`/`N)`) build one AST level each, and the block parser's own container-
// matching goes SUPER-LINEAR against a deep `open` stack well under
// MAX_DOC_BYTES — measured live: an 8,004-byte doc (0.016x the cap) took
// ~1.9s, 30,000 markers (59 KB) took ~38s. This is a WIDTH (CPU-time)
// hazard, not the depth/stack-overflow one below (that one is now closed at
// its root — see walk()'s own header in md-ast.mjs), and MAX_DOC_BYTES alone
// cannot catch it (both docs are tiny).
//
// CORRECTED (board U13/F1 findings-back, INSPECT-caught): the first version
// of this guard only counted a leading `>` run, ANCHORED at line start. Two
// real defects, one root cause (a pre-parse scan that was simultaneously
// too NARROW and too BROAD):
//   H1 — too narrow: `'- ' + '>'.repeat(N)` (a list marker before the `>`
//        run) was INVISIBLE to the old regex — the exact super-linear
//        vector this guard exists to close, still reachable through any
//        container-marker prefix, not only a bare blockquote.
//   M1 — too broad: `>` characters inside a FENCED CODE BLOCK are literal
//        text, not container markers, but the old scan was fence-blind and
//        cry-wolfed on ordinary fenced content — worse, because the finding
//        RETURNS EARLY, every real finding in that document was silently
//        dropped along with it.
// Fixed by tracking fence state in the SAME single pass (never scanning
// containers while fenced — an unclosed fence swallows to EOF exactly as
// the real parser does, so this stays behaviorally aligned, not a bypass)
// and by counting ANY run of container-opening markers at line start
// (blockquote OR list, mixed and nested), not `>` alone. Still O(doc
// length) worst case, and SHORT-CIRCUITS the instant one line's depth
// crosses the cap — the pathological case (huge N) is now the FASTEST
// case, not the slowest.
//
// Known limit (honest ceiling, findings-back LOW-1): FENCE_OPEN_RE is
// start-anchored, so a fence nested INSIDE a container (e.g. a fenced block
// opened after a leading `> `) is never tracked as a fence — its contents
// still get scanned as container markers. A container-nested fence holding
// 201+ markers on one line can therefore still false-fire doc-too-nested.
// Direction is SAFE: this can only make the guard OVER-count (a false
// refusal), never under-count (never a bypass) — the unfenced-scanning
// fallback is the same "when unsure, count it" behavior this guard already
// has everywhere else. Real container-nested fences with that many markers
// on one line are not a realistic document shape; closing this properly
// needs real container-state tracking pre-parse, which is the parser's own
// job and defeats the point of a cheap O(lines) scan.
const MAX_CONTAINER_DEPTH = 200; // defensible per-doc: a real 12-level email-quote thread scans 0 findings in 0ms; 200 is ~17x that headroom, and the crash floor this guard backstops sits far higher (~4,000-5,000 markers) — the number is chosen for realistic-document headroom, not to chase either floor (see the try/catch backstop below for the crash axis; this guard's own job is the CPU-time axis, whose floor is materially LOWER — measured live: 278ms already at 3,000 markers on the pre-fix bypass path)
const FENCE_OPEN_RE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const CONTAINER_OPENER_RE = /[ \t]{0,3}(?:>[ \t]?|[-+*][ \t]|[0-9]{1,9}[.)][ \t])/y; // sticky — advances lastIndex on match, never zero-length
function maxContainerDepth(src) {
  let max = 0;
  let fenceChar = null;
  let fenceLen = 0;
  for (const line of src.split('\n')) {
    const fm = FENCE_OPEN_RE.exec(line);
    if (fenceChar) {
      if (fm && fm[1][0] === fenceChar && fm[1].length >= fenceLen) { fenceChar = null; fenceLen = 0; }
      continue; // inside a fence: `>` etc. here is literal code text, never a container marker
    }
    if (fm) { fenceChar = fm[1][0]; fenceLen = fm[1].length; continue; } // opening fence line itself isn't scanned either
    CONTAINER_OPENER_RE.lastIndex = 0;
    let depth = 0;
    while (CONTAINER_OPENER_RE.test(line)) {
      depth++;
      if (depth > MAX_CONTAINER_DEPTH) return depth; // short-circuit: no need to keep counting once over cap
    }
    if (depth > max) max = depth;
  }
  return max;
}

export function checkDocument(src, opts = {}) {
  const filePath = opts.filePath ? path.resolve(opts.filePath) : null;
  const fileExists = opts.fileExists || ((p) => { try { return fs.existsSync(p); } catch { return false; } });
  const readFile = opts.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  if (typeof src === 'string' && src.length > MAX_DOC_BYTES) {
    return [{ check: 'doc-too-large', line: 1, column: 1, message: `document is ${(src.length / 1048576).toFixed(1)} MB (> ${MAX_DOC_BYTES / 1048576} MB) — too large for a structural scan; split it into smaller docs` }];
  }
  // git/grep/diff's own "is this binary" heuristic: a NUL byte survives utf8
  // decode as literal U+0000, and real text never contains one. Without this,
  // a binary/corrupted .md parses to a near-empty tree -> "0 findings" reads
  // as a clean bill when the doc was never readable as markdown at all.
  if (typeof src === 'string' && src.slice(0, 8000).includes('\0')) {
    return [{ check: 'doc-unreadable', line: 1, column: 1, message: 'document contains a NUL byte in its first 8000 characters — likely binary or corrupted, not scannable as markdown' }];
  }
  if (typeof src === 'string') {
    const depth = maxContainerDepth(src);
    if (depth > MAX_CONTAINER_DEPTH) {
      return [{ check: 'doc-too-nested', line: 1, column: 1, message: `container nesting (blockquote/list) reaches at least ${depth} levels (> ${MAX_CONTAINER_DEPTH}) — too deep for a structural scan; deep nesting makes parsing pathologically slow/unsafe well before this document is otherwise large` }];
    }
  }
  // Backstop for any depth/structure pathology this guard did not enumerate
  // (board U13/F1's own note: the guard above is scoped to the ONE
  // reproduced vector; this catches whatever comes next). A parse failure
  // here degrades to a controlled finding instead of crashing the caller —
  // see the CLI loop below, which would otherwise lose every OTHER file's
  // findings in the same batch to one crafted doc.
  let root;
  try {
    root = parseMarkdown(src);
  } catch (e) {
    return [{ check: 'doc-unreadable', line: 1, column: 1, message: `document could not be parsed (${e && e.constructor ? e.constructor.name : 'error'}: ${e && e.message ? e.message : 'unknown'}) — a structural pathology the depth guard did not catch; not scannable` }];
  }
  const findings = [];
  const at = (node) => (node && node.position ? node.position.start : { line: 1, column: 1 });
  const add = (check, node, message, extra = {}) => {
    const p0 = extra.point || at(node);
    const f = { check, line: p0.line, column: p0.column, message };
    // Backward-compatible: existing checks omit this field entirely (old
    // shape, unchanged). Only a check that cannot be judged CONFIRMED by the
    // engine itself (decorative-vs-content intent, image-alt-missing) sets it.
    if (extra.suspected) f.suspected = true;
    findings.push(f);
  };

  // ---- headings -------------------------------------------------------------
  let prevDepth = 0;
  let h1Seen = false;
  // heading-duplicate (siblings-only, MD024 semantics): flag a duplicate only
  // when both headings share the same parent section. A CHANGELOG with
  // ### Added under ## 1.0.0 and ### Added under ## 2.0.0 is the
  // keepachangelog format — different parent nodes, not siblings.
  // Same parent node + same text = ambiguous anchors. TWO axes, do NOT
  // "simplify" the message and lose either one: (1) SCOPE — the CHECK is
  // sibling-scoped, the SLUG claim is document-wide, so a plain #slug can
  // reach a heading outside this sibling pair entirely; (2) TEXT vs SLUG —
  // slug claims are first-come by SLUG, not by matching TEXT, so the heading
  // #slug actually reaches may have DIFFERENT text than either duplicate.
  // Repro, same text (pure ASCII): # Setup / ## Section / ### Setup /
  // ### Setup — #setup is the h1's (SCOPE axis: outside the sibling pair),
  // and the flagged pair is #setup-1 / #setup-2.
  // Repro, text DIFFERS (the TEXT-vs-SLUG trap — this axis is easy to miss
  // because the repro above accidentally uses "Setup" for the h1 too):
  // # Setup! / ## Section / ### Setup / ### Setup — #setup STILL belongs to
  // the h1, whose text is "Setup!", not "Setup". Neither flagged duplicate
  // (text "Setup") owns the plain #setup at all; both land on
  // #setup-1 / #setup-2. Verified live: checkDocument('# Setup!\n\n##
  // Section\n\n### Setup\n\n### Setup\n') fires heading-duplicate once, and
  // its message names #setup — a slug this document already gave to a
  // heading whose text is "Setup!".
  // The suffixed anchors (#slug-1) are order-fragile and readers
  // cannot predict them. The defect is format-general: duplicate headings make
  // auto-generated identifiers ambiguous in markdown, HTML, AsciiDoc, and
  // screen-reader jump-to-heading navigation alike.
  // Known limit: headings with different text that slug to the same anchor
  // (e.g. "Setup!" and "Setup" both slug to "setup") are NOT flagged — the
  // key is the rendered text, matching markdownlint MD024 behavior.
  let headingSeq = 0;
  const ancestorId = []; // ancestorId[depth] = id of the current heading at that depth
  const siblingsSeen = new Map(); // "parentId/text" -> first node
  walk(root, (node) => {
    if (node.type !== 'heading') return;
    if (prevDepth && node.depth > prevDepth + 1) {
      add('heading-skip', node, `heading level jumps h${prevDepth} -> h${node.depth} (skipped h${prevDepth + 1})`);
    }
    prevDepth = node.depth;
    if (node.depth === 1) {
      if (h1Seen) add('heading-multiple-h1', node, 'more than one top-level (h1) heading in this document');
      h1Seen = true;
    }
    const text = textContent(node);
    const key = text.trim().toLowerCase();
    if (key) {
      const thisId = ++headingSeq;
      // find the nearest defined ancestor: walk depth-1 down to 1
      let parentId = 0; // 0 = document root
      for (let d = node.depth - 1; d >= 1; d--) {
        if (ancestorId[d] !== undefined) { parentId = ancestorId[d]; break; }
      }
      // register this heading as the ancestor for deeper levels, clear stale
      ancestorId[node.depth] = thisId;
      for (let d = node.depth + 1; d < ancestorId.length; d++) ancestorId[d] = undefined;
      const sibKey = parentId + '/' + key;
      const prev = siblingsSeen.get(sibKey);
      if (prev) {
        // githubSlug, never a hand-rolled one: `\w` is ASCII-only, so a
        // hand-roll prints "#" for a Thai/CJK heading and "#caf-rsum" for
        // "Café résumé". The base (un-suffixed) slug is exactly what "a plain
        // #slug link" means, so no dedupe state is wanted here.
        add('heading-duplicate', node, `duplicate heading "${text}" under the same parent (first at line ${at(prev).line}) — a plain #${githubSlug(text)} link reaches only the first heading in the document to claim that slug, which may be neither one of these two (an earlier heading with different text can claim it first)`);
      } else {
        siblingsSeen.set(sibKey, node);
      }
    }
  });

  // ---- images (alt text) -----------------------------------------------------
  // SUSPECTED-only, ALWAYS (main ruling on PR #11/#12, not a config toggle):
  // the engine can CONFIRM alt is empty, never whether that is right — empty
  // alt is the WCAG-1.1.1-correct choice for a purely decorative image, so
  // decorative-vs-content is a human call. Covers image AND imageReference
  // (full/collapsed/shortcut/inline all normalize to one of these two node
  // types — see md-ast.mjs resolveBracket), and is AST-native so a code span
  // or fenced/indented block showing "![](x)" as documentation stays silent.
  walk(root, (node) => {
    if (node.type !== 'image' && node.type !== 'imageReference') return;
    if ((node.alt || '').trim()) return;
    add('image-alt-missing', node, 'image has empty alt — intentional for purely decorative images (WCAG 1.1.1); a content image needs a description (MD045)', { suspected: true });
  });

  // ---- link / image / definition targets ------------------------------------
  const anchors = collectAnchors(root);
  const targetCache = new Map(); // abs path -> Set(anchors) | null (unreadable)

  function anchorsOf(absPath) {
    if (targetCache.has(absPath)) return targetCache.get(absPath);
    let set = null;
    try {
      const text = readFile(absPath);
      // same cap as the primary doc — a linked target over the limit is left
      // unchecked (null) rather than pulled into the parser's worst case.
      set = (typeof text === 'string' && text.length > MAX_DOC_BYTES) ? null : collectAnchors(parseMarkdown(text));
    } catch { set = null; }
    targetCache.set(absPath, set);
    return set;
  }

  function checkAnchor(node, frag, set, where) {
    const want = safeDecode(frag);
    if (set.has(want)) return;
    if (set.has(want.toLowerCase())) {
      add('anchor-missing', node, `anchor '#${frag}'${where} exists only as '#${want.toLowerCase()}' — GitHub anchors are lowercase (case mismatch)`);
      return;
    }
    add('anchor-missing', node, `anchor '#${frag}'${where} matches no heading or HTML id`);
  }

  function checkTarget(node, url) {
    if (!url) return; // empty href: renders, nothing to resolve (noise if flagged)
    if (SCHEME_RE.test(url) || url.startsWith('//')) return; // external
    if (url.startsWith('#')) { checkAnchor(node, url.slice(1), anchors, ''); return; }
    if (url.startsWith('/')) return; // site-root-relative: skipped (known limit)
    if (!filePath) return; // no doc path -> relative targets unresolvable
    const hashIdx = url.indexOf('#');
    const frag = hashIdx === -1 ? null : url.slice(hashIdx + 1);
    let rel = hashIdx === -1 ? url : url.slice(0, hashIdx);
    const qIdx = rel.indexOf('?');
    if (qIdx !== -1) rel = rel.slice(0, qIdx);
    rel = safeDecode(rel);
    if (!rel) { if (frag != null) checkAnchor(node, frag, anchors, ''); return; } // "#... " handled; "?x#y" self
    const abs = path.resolve(path.dirname(filePath), rel);
    if (!fileExists(abs)) {
      add('file-missing', node, `relative target '${rel}' not found (resolved: ${abs})`);
      return;
    }
    if (frag != null && /\.(md|markdown)$/i.test(abs)) {
      const set = anchorsOf(abs);
      if (set) checkAnchor(node, frag, set, ` in ${rel}`);
    }
  }

  walk(root, (node) => {
    if (node.type === 'link' || node.type === 'image' || node.type === 'definition') checkTarget(node, node.url);
  });

  // ---- tables ----------------------------------------------------------------
  walk(root, (node) => {
    if (node.type !== 'table' || !node.children.length) return;
    const headerCount = node.children[0].children.length;
    for (let r = 1; r < node.children.length; r++) {
      const row = node.children[r];
      if (row.children.length > headerCount) {
        add('table-ragged', row, `row has ${row.children.length} cells but the header has ${headerCount} — GitHub silently drops the extra cell(s)`);
      }
    }
  });

  // ---- references ------------------------------------------------------------
  const defs = new Map();
  walk(root, (node) => { if (node.type === 'definition') defs.set(node.identifier, node); });
  const used = new Set();
  walk(root, (node) => {
    if (node.type === 'linkReference' || node.type === 'imageReference') {
      used.add(node.identifier);
      if (!defs.has(node.identifier)) {
        add('ref-undefined', node, `reference '[${node.label}]' has no matching definition — it renders as literal bracket text`);
      }
    }
  });
  for (const [id, def] of defs) {
    if (!used.has(id)) add('def-orphan', def, `definition '[${def.label}]' is never referenced`);
  }

  // ---- bare URLs in prose ------------------------------------------------------
  const LINKISH = new Set(['link', 'linkReference', 'image', 'imageReference', 'definition']);
  walk(root, (node, ancestors) => {
    if (node.type !== 'text') return;
    if (ancestors.some((a) => LINKISH.has(a.type))) return;
    BARE_URL_RE.lastIndex = 0;
    let m;
    while ((m = BARE_URL_RE.exec(node.value)) !== null) {
      const url = m[0].replace(/[.,;:!?]+$/, '');
      const before = node.value.slice(0, m.index);
      const nl = before.lastIndexOf('\n');
      const base = at(node);
      const point = nl === -1
        ? { line: base.line, column: base.column + m.index }
        : { line: base.line + (before.split('\n').length - 1), column: m.index - nl }; // column approximate on wrapped lines
      add('bare-url', node, `bare URL '${url}' in prose — wrap it as a markdown link (<${url}> or [text](${url}))`, { point });
    }
  });

  findings.sort((a, b) => a.line - b.line || a.column - b.column);
  return findings;
}

// ---------------------------------------------------------------------------
// CLI (agent-invoked scan path — CLI discipline: fail LOUD on unreadable input,
// findings themselves are data, not failure)
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const files = args.filter((a) => a !== '--json');
  if (!files.length) {
    console.error('usage: node md-checks.mjs [--json] <file.md> [more.md ...]');
    process.exitCode = 1;
  }
  const out = [];
  let total = 0;
  for (const f of files) {
    let src;
    try {
      src = fs.readFileSync(f, 'utf8');
    } catch (e) {
      console.error(`FAIL ${f}: ${e.message}`);
      process.exitCode = 1;
      continue;
    }
    let findings;
    try {
      findings = checkDocument(src, { filePath: f });
    } catch (e) {
      // Backstop of the backstop: checkDocument itself should never throw
      // (both guards above degrade to a finding), but the batch must not
      // lose every OTHER file's findings to one file's bug either way.
      console.error(`FAIL ${f}: ${e && e.message ? e.message : e}`);
      process.exitCode = 1;
      continue;
    }
    total += findings.length;
    if (json) {
      out.push({ file: f, findings });
    } else {
      for (const x of findings) console.log(`${f}:${x.line}:${x.column} [${x.check}] ${x.message}`);
    }
  }
  if (json) console.log(JSON.stringify(out, null, 2));
  else console.log(`${total} finding(s) across ${files.length} file(s)`);
}
