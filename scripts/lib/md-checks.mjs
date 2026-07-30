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
//                       FIRST heading with that text in the whole document
//                       (the CHECK is sibling-scoped, the SLUG is not);
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
//                       alt (all reference forms: full/collapsed/shortcut/
//                       inline). SUSPECTED-ONLY, ALWAYS — carries
//                       finding.suspected = true and is never promoted to
//                       CONFIRMED: empty alt is WCAG-1.1.1-CORRECT for a
//                       purely decorative image, so decorative-vs-content
//                       intent is a human call the engine cannot make (MD045)
//   doc-too-large       pre-parse short-circuit: input over MAX_DOC_BYTES is
//                       refused, never parsed (the parser-DoS root fix)
//   doc-unreadable      pre-parse short-circuit: a NUL byte in the first 8 KB
//                       (binary/corrupted input) is refused, never parsed
//
// Known limits (honest ceiling, mirrors md-ast.mjs):
//   - site-root-relative targets (/path) are SKIPPED — resolving them needs a
//     repo root this module does not assume (no-external-assumption).
//   - bare-url columns inside multi-line text nodes are line-accurate,
//     column-approximate.
//   - this is a STRUCTURAL scanner, not a content validator: parseMarkdown
//     never throws, so garbled-but-NUL-free text (valid UTF-8, no real
//     structure) still parses to a near-empty tree — "0 findings" there means
//     "nothing structurally broken found," not "content verified sane."
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
  const root = parseMarkdown(src);
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
  // Same parent node + same text = ambiguous anchors. SCOPE MISMATCH — do NOT
  // "simplify" the message back to "the first occurrence": the CHECK is
  // sibling-scoped, the SLUG is document-wide, so a plain #slug reaches the
  // first heading with that text ANYWHERE, which may be neither sibling.
  // Repro (pure ASCII): # Setup / ## Section / ### Setup / ### Setup — #setup
  // is the h1's, and the flagged pair is #setup-1 / #setup-2.
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
        add('heading-duplicate', node, `duplicate heading "${text}" under the same parent (first at line ${at(prev).line}) — a plain #${githubSlug(text)} link reaches only the first heading with that text in the document`);
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
    const findings = checkDocument(src, { filePath: f });
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
