// CoalLedger md-ast — VENDORED-MINIMAL CommonMark + GFM parser producing an
// mdast-shaped tree with positions. The ONE genuinely-new engine component of
// the suite (blueprint §7): every mechanical doc check runs on THIS tree, never
// on regex over raw text (regex cry-wolfs on things that render fine).
//
// HONEST CEILING: CommonMark+GFM fidelity, NOT 100% GitHub-pixel fidelity —
// GitHub-specific quirks are flagged as known-limits, never silently claimed:
//   - HTML blocks/inline HTML are PASSTHROUGH-FLAGGED (`passthrough: true`),
//     collected verbatim, never sanitized/validated (GitHub's sanitizer is
//     out of scope).
//   - Entity references (&amp; …) are kept literal, not decoded.
//   - GFM *extended* autolinks (bare www./http text) are NOT auto-linked here
//     (CommonMark base behavior); md-checks detects them over text nodes.
//   - Tab-stop math inside partially-consumed tabs, multi-line link
//     destinations, and setext/definition corner cases follow the common-case
//     reading of the spec, not every spec example.
//   - Strikethrough pairs only on exact `~~` runs (the dominant GFM form).
// Language-neutral BY DESIGN: structure is derived from AST position and
// punctuation classes (Unicode property escapes), never from English keywords —
// Thai/CJK/RTL prose flows through untouched (§4 of the blueprint).
//
// Zero dependencies (Phoenix #2): no imports at all — pure functions over a
// string. Node 18+ (Unicode property escapes in regex).

// ---------------------------------------------------------------------------
// Line model + positions
// ---------------------------------------------------------------------------

function splitLines(src) {
  const out = [];
  let start = 0;
  for (let i = 0; i <= src.length; i++) {
    if (i === src.length || src[i] === '\n') {
      if (i === src.length && start === src.length && out.length) break; // no phantom line after a trailing \n
      let end = i;
      if (end > start && src[end - 1] === '\r') end--;
      out.push({ text: src.slice(start, end), start, end });
      start = i + 1;
      if (i === src.length) break;
    }
  }
  return out;
}

// offset -> { line, column, offset } (1-based line/column, column in chars)
function makePosMap(lines) {
  return {
    pointAt(offset) {
      let lo = 0;
      let hi = lines.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lines[mid].start <= offset) lo = mid;
        else hi = mid - 1;
      }
      return { line: lo + 1, column: offset - lines[lo].start + 1, offset };
    },
  };
}

const BLANK_RE = /^[ \t]*$/;
// A real inline-link destination or title is never this long. Bounding the scans
// keeps `[a](` (or `[a]("`) repeated N times from re-scanning the tail per bracket
// -> O(N^2) (a crafted-doc parse hang). Over the cap = not a valid inline link.
const MAX_INLINE_DEST = 2048;

function scanIndent(text, p, col) {
  while (p < text.length) {
    const c = text[p];
    if (c === ' ') { p++; col++; } else if (c === '\t') { p++; col += 4 - (col % 4); } else break;
  }
  return { p, col };
}

// Consume whitespace until visual column >= target (partial-tab overshoot is
// accepted — known limit, see header).
function consumeCols(text, p, col, target) {
  while (p < text.length && col < target) {
    const c = text[p];
    if (c === ' ') { p++; col++; } else if (c === '\t') { p++; col += 4 - (col % 4); } else break;
  }
  return { p, col };
}

// ---------------------------------------------------------------------------
// GitHub heading anchors (github-slugger behavior): lowercase, strip anything
// that is not a Unicode letter/mark/number/space/hyphen/underscore, then each
// space -> '-'. Unicode-property based => Thai/CJK headings slug correctly.
// ---------------------------------------------------------------------------

const SLUG_STRIP = /[^\p{L}\p{M}\p{N}\s_-]/gu;

export function githubSlug(text) {
  return String(text).trim().toLowerCase().replace(SLUG_STRIP, '').replace(/\s/g, '-');
}

// Stateful dedupe: repeated heading text gets -1, -2 … (GitHub behavior).
export function makeSlugger() {
  const seen = new Map();
  return {
    slug(text) {
      const base = githubSlug(text);
      const n = seen.get(base) || 0;
      seen.set(base, n + 1);
      return n === 0 ? base : `${base}-${n}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

const ESCAPABLE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

function unescapeMd(s) {
  return s.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
}

function normalizeLabel(label) {
  return label.trim().replace(/[ \t\r\n]+/g, ' ').toLowerCase();
}

// Rendered-text of a subtree (what GitHub's slugger sees): text + code spans +
// image alts, formatting stripped.
export function textContent(node) {
  if (node == null) return '';
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.type === 'image' || node.type === 'imageReference') return node.alt || '';
  if (node.type === 'break') return ' ';
  if (Array.isArray(node.children)) return node.children.map(textContent).join('');
  return '';
}

// Depth-first visitor with ancestors. fn may return false to skip a subtree.
export function walk(node, fn, ancestors = []) {
  if (fn(node, ancestors) === false) return;
  if (Array.isArray(node.children)) {
    const next = ancestors.concat(node);
    for (const c of node.children) walk(c, fn, next);
  }
}

// ---------------------------------------------------------------------------
// Block-level recognizers
// ---------------------------------------------------------------------------

const THEMATIC_RE = /^([-_*])[ \t]*(?:\1[ \t]*){2,}$/;
const ATX_RE = /^(#{1,6})(?:[ \t]+(.*?))??[ \t]*$/;
const SETEXT_RE = /^(=+|-+)[ \t]*$/;
const FENCE_OPEN_RE = /^(`{3,}|~{3,})[ \t]*(.*)$/;

const HTML_BLOCK_TAGS = /^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t]|\/?>|$)/i;
const HTML_TYPE7_RE = /^<\/?[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^ \t"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>[ \t]*$/;

function htmlBlockStart(rest, inParagraph) {
  if (/^<(?:script|pre|style|textarea)(?=[\s>]|$)/i.test(rest)) return { end: /<\/(?:script|pre|style|textarea)>/i };
  if (rest.startsWith('<!--')) return { end: /-->/ };
  if (rest.startsWith('<?')) return { end: /\?>/ };
  if (/^<!\[CDATA\[/.test(rest)) return { end: /\]\]>/ };
  if (/^<![A-Za-z]/.test(rest)) return { end: />/ };
  if (HTML_BLOCK_TAGS.test(rest)) return { end: 'blank' };
  if (!inParagraph && HTML_TYPE7_RE.test(rest)) return { end: 'blank' };
  return null;
}

// List-item marker at (p, col). Returns null or marker info.
function matchListItem(text, p, col) {
  let ordered = false;
  let bullet = null;
  let delim = null;
  let start = 1;
  let mp = p;
  const m = /^(\d{1,9})([.)])/.exec(text.slice(p));
  if (m) {
    ordered = true;
    start = parseInt(m[1], 10);
    delim = m[2];
    mp = p + m[0].length;
  } else if (text[p] === '-' || text[p] === '+' || text[p] === '*') {
    bullet = text[p];
    mp = p + 1;
  } else {
    return null;
  }
  const markerCols = col + (mp - p); // digits/bullet are 1-col chars
  if (mp < text.length && text[mp] !== ' ' && text[mp] !== '\t') return null;
  const after = scanIndent(text, mp, markerCols);
  const spaces = after.col - markerCols;
  const restBlank = after.p >= text.length;
  let contentCol;
  let contentP;
  if (restBlank) { // empty item
    contentCol = markerCols + 1;
    contentP = mp;
  } else if (spaces >= 1 && spaces <= 4) {
    contentCol = markerCols + spaces;
    contentP = after.p;
  } else { // spaces > 4 -> content starts after ONE space, rest is code indent
    contentCol = markerCols + 1;
    contentP = mp + 1;
  }
  return {
    ordered,
    bullet,
    delim,
    start,
    contentCol,
    contentP,
    empty: restBlank,
    canInterrupt: !restBlank && (!ordered || start === 1),
  };
}

// Split a GFM table row into cells honoring backslash escapes.
// Returns [{ text, offset }] — offset = char index of the cell's first
// (untrimmed) char within `text`; `hadPipe` = an unescaped | was seen.
function splitRow(text) {
  const cells = [];
  let cur = '';
  let cellStart = 0;
  let sawPipe = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length) { cur += c + text[i + 1]; i++; continue; }
    if (c === '|') {
      sawPipe = true;
      cells.push({ text: cur, offset: cellStart });
      cur = '';
      cellStart = i + 1;
      continue;
    }
    cur += c;
  }
  cells.push({ text: cur, offset: cellStart });
  // Boundary pipes: a leading | and a trailing | delimit, they don't add cells.
  if (cells.length && cells[0].text.trim() === '' && text.trimStart().startsWith('|')) cells.shift();
  if (cells.length && cells[cells.length - 1].text.trim() === '' && text.trimEnd().endsWith('|') && !text.trimEnd().endsWith('\\|')) cells.pop();
  // Trim each cell, keeping source offsets honest.
  const out = cells.map((c) => {
    const lead = c.text.length - c.text.trimStart().length;
    return { text: c.text.trim(), offset: c.offset + lead };
  });
  return { cells: out, hadPipe: sawPipe };
}

const DELIM_CELL_RE = /^:?-+:?$/;

function parseDelimiterRow(text) {
  const { cells, hadPipe } = splitRow(text);
  if (!hadPipe || cells.length === 0) return null;
  const align = [];
  for (const c of cells) {
    if (!DELIM_CELL_RE.test(c.text)) return null;
    const l = c.text.startsWith(':');
    const r = c.text.endsWith(':');
    align.push(l && r ? 'center' : r ? 'right' : l ? 'left' : null);
  }
  return { count: cells.length, align };
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

export function parseMarkdown(src) {
  let input = String(src);
  let bomOffset = 0;
  if (input.charCodeAt(0) === 0xfeff) { input = input.slice(1); bomOffset = 1; }
  const lines = splitLines(input);
  const posmap = makePosMap(lines);
  const pt = (offset) => posmap.pointAt(Math.max(0, Math.min(offset, input.length)));

  const doc = { type: 'root', children: [], position: { start: pt(0), end: pt(input.length) } };
  const definitions = new Map();

  // Open container frames. Leaf state is a single `leaf` object.
  const open = [{ kind: 'root', node: doc, lastEnd: 0 }];
  let leaf = null;

  const top = () => open[open.length - 1];
  const container = () => top().node;

  function touchEnds(endOffset) {
    for (const f of open) f.lastEnd = Math.max(f.lastEnd, endOffset);
  }

  function appendNode(node) {
    container().children.push(node);
    return node;
  }

  // ----- leaf finalization ---------------------------------------------------

  function closeLeaf() {
    if (!leaf) return;
    const l = leaf;
    leaf = null;
    if (l.kind === 'paragraph') {
      finalizeParagraph(l);
    } else if (l.kind === 'fenced' || l.kind === 'indented') {
      // trailing pending blanks in indented code are dropped (spec)
      const value = l.valueLines.join('\n');
      appendNode({
        type: 'code',
        lang: l.lang || null,
        meta: l.meta || null,
        value,
        position: { start: pt(l.startOffset), end: pt(l.endOffset) },
      });
    } else if (l.kind === 'html') {
      appendNode({
        type: 'html',
        value: l.valueLines.join('\n'),
        passthrough: true,
        position: { start: pt(l.startOffset), end: pt(l.endOffset) },
      });
    } else if (l.kind === 'table') {
      // node was appended at open; nothing further
      l.node.position.end = pt(l.endOffset);
    }
  }

  // Extract leading link-reference definitions from a closing paragraph, then
  // emit the remainder (if any) as the paragraph node.
  const DEF_RE = /^ {0,3}\[((?:\\[\s\S]|[^[\]\\])+)\]:[ \t]*(?:<([^<>\n]*)>|(\S+))(?:[ \t]+("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^()\\])*\)))?[ \t]*$/;
  const TITLE_LINE_RE = /^[ \t]*("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^()\\])*\))[ \t]*$/;

  function finalizeParagraph(l) {
    let segs = l.segs;
    while (segs.length) {
      const m = DEF_RE.exec(segs[0].text);
      if (!m) break;
      let consumed = 1;
      let title = m[4] != null ? m[4] : null;
      if (title == null && segs.length > 1) {
        const tm = TITLE_LINE_RE.exec(segs[1].text);
        if (tm) { title = tm[1]; consumed = 2; }
      }
      const label = m[1];
      const id = normalizeLabel(label);
      const url = unescapeMd(m[2] != null ? m[2] : m[3]);
      const node = {
        type: 'definition',
        identifier: id,
        label: label.trim(),
        url,
        title: title ? unescapeMd(title.slice(1, -1)) : null,
        position: {
          start: pt(segs[0].src),
          end: pt(segs[consumed - 1].src + segs[consumed - 1].text.length),
        },
      };
      appendNode(node);
      if (!definitions.has(id)) definitions.set(id, node);
      segs = segs.slice(consumed);
    }
    if (!segs.length) return;
    appendNode({
      type: 'paragraph',
      children: [],
      _raw: buildRaw(segs),
      position: { start: pt(segs[0].src), end: pt(segs[segs.length - 1].src + segs[segs.length - 1].text.length) },
    });
  }

  // segs: [{ text, src }] -> raw { text (joined with \n), segs: [{v, src, len}] }
  function buildRaw(segs) {
    let v = 0;
    const map = [];
    const parts = [];
    for (const s of segs) {
      map.push({ v, src: s.src, len: s.text.length });
      parts.push(s.text);
      v += s.text.length + 1; // +1 for the virtual '\n'
    }
    return { text: parts.join('\n'), segs: map };
  }

  function closeTo(depth) {
    closeLeaf();
    while (open.length > depth) {
      const f = open.pop();
      f.node.position.end = pt(f.lastEnd);
      if (f.kind === 'list') finalizeList(f);
    }
  }

  function finalizeList(f) {
    // spread (loose) if a blank line separated any two block-level chunks
    if (f.loose) {
      f.node.spread = true;
      for (const item of f.node.children) item.spread = true;
    }
  }

  // ----- main line loop -------------------------------------------------------

  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    const text = L.text;
    let p = 0;
    let col = 0;

    // 1) match continuations of open containers
    let matched = 1;
    let itemSawBlank = false;
    for (let fi = 1; fi < open.length; fi++) {
      const f = open[fi];
      if (f.kind === 'blockquote') {
        const s = scanIndent(text, p, col);
        if (s.col - col > 3 || text[s.p] !== '>') break;
        p = s.p + 1;
        col = s.col + 1;
        if (text[p] === ' ') { p++; col++; } else if (text[p] === '\t') { col += 4 - (col % 4); p++; }
      } else if (f.kind === 'item') {
        if (BLANK_RE.test(text.slice(p))) { itemSawBlank = true; /* blank matches item */ } else {
          const r = consumeCols(text, p, col, f.contentCol);
          if (r.col < f.contentCol) break;
          p = r.p;
          col = r.col;
        }
      } // 'list' frames always match
      matched = fi + 1;
    }

    const allMatched = matched === open.length;
    const restIsBlank = BLANK_RE.test(text.slice(p));

    // 2) leaves that swallow the whole rest of the line
    if (leaf && leaf.kind === 'fenced') {
      if (allMatched) {
        const s = scanIndent(text, p, col);
        const closeM = s.col - col <= 3 && new RegExp(`^${leaf.char}{${leaf.len},}[ \\t]*$`).exec(text.slice(s.p));
        if (closeM) { leaf.endOffset = L.end; touchEnds(L.end); closeLeaf(); continue; }
        // dedent up to the opening fence's indent
        const d = consumeCols(text, p, col, col + leaf.indent);
        leaf.valueLines.push(text.slice(d.p));
        leaf.endOffset = L.end;
        touchEnds(L.end);
        continue;
      }
      // container gone -> close code, fall through to normal handling
      closeTo(matched);
    }
    if (leaf && leaf.kind === 'html') {
      if (allMatched) {
        const rest = text.slice(p);
        if (leaf.endCond === 'blank') {
          if (restIsBlank) { closeLeaf(); continue; }
          leaf.valueLines.push(rest);
          leaf.endOffset = L.end;
          touchEnds(L.end);
          continue;
        }
        leaf.valueLines.push(rest);
        leaf.endOffset = L.end;
        touchEnds(L.end);
        if (leaf.endCond.test(rest)) closeLeaf();
        continue;
      }
      closeTo(matched);
    }
    if (leaf && leaf.kind === 'indented' && allMatched) {
      const s = scanIndent(text, p, col);
      if (restIsBlank) { leaf.pendingBlanks.push(''); continue; }
      if (s.col - col >= 4) {
        const d = consumeCols(text, p, col, col + 4);
        while (leaf.pendingBlanks.length) { leaf.valueLines.push(leaf.pendingBlanks.shift()); }
        leaf.valueLines.push(text.slice(d.p));
        leaf.endOffset = L.end;
        touchEnds(L.end);
        continue;
      }
      closeLeaf();
    }

    // 3) lazy paragraph continuation when containers did not all match.
    // A marker that CONTINUES an already-open list (same type) is a sibling
    // item, never lazy text — the paragraph-interrupt rule only protects
    // paragraphs from a NEW list ("4. four" under "3. three" is item #2).
    if (!allMatched) {
      const rest = text.slice(p);
      const lazyOk = leaf && leaf.kind === 'paragraph' && !restIsBlank &&
        !startsNewBlock(text, p, col) && !siblingItemStart(text, p, col);
      if (lazyOk) {
        const s = scanIndent(text, p, col);
        leaf.segs.push({ text: text.slice(s.p), src: L.start + s.p });
        touchEnds(L.end);
        continue;
      }
      closeTo(matched);
    }

    // 4) open new containers (blockquotes / list items)
    let opened = true;
    while (opened) {
      opened = false;
      const s = scanIndent(text, p, col);
      if (s.col - col >= 4) break; // code-indent territory
      const ch = text[s.p];
      if (ch === '>') {
        closeLeaf();
        while (top().kind === 'list') closeTo(open.length - 1); // a bq at list level closes the list
        const node = appendNode({ type: 'blockquote', children: [], position: { start: pt(L.start + s.p), end: pt(L.end) } });
        open.push({ kind: 'blockquote', node, lastEnd: L.end });
        p = s.p + 1;
        col = s.col + 1;
        if (text[p] === ' ') { p++; col++; } else if (text[p] === '\t') { col += 4 - (col % 4); p++; }
        touchEnds(L.end);
        opened = true;
        continue;
      }
      const item = matchListItem(text, s.p, s.col);
      if (item) {
        if (THEMATIC_RE.test(text.slice(s.p))) break; // thematic break outranks a list item
        if (leaf && leaf.kind === 'paragraph' && !item.canInterrupt) break;
        closeLeaf();
        let listFrame = top().kind === 'list' ? top() : null;
        const sameType = listFrame && listFrame.ordered === item.ordered &&
          listFrame.bullet === item.bullet && listFrame.delim === item.delim;
        if (listFrame && !sameType) { closeTo(open.length - 1); listFrame = null; }
        if (!listFrame) {
          const listNode = appendNode({
            type: 'list',
            ordered: item.ordered,
            start: item.ordered ? item.start : null,
            spread: false,
            children: [],
            position: { start: pt(L.start + s.p), end: pt(L.end) },
          });
          listFrame = { kind: 'list', node: listNode, lastEnd: L.end, ordered: item.ordered, bullet: item.bullet, delim: item.delim, loose: false, blankSeen: false };
          open.push(listFrame);
        }
        if (listFrame.blankSeen) { listFrame.loose = true; listFrame.blankSeen = false; }
        const itemNode = { type: 'listItem', spread: false, checked: null, children: [], position: { start: pt(L.start + s.p), end: pt(L.end) } };
        listFrame.node.children.push(itemNode);
        open.push({ kind: 'item', node: itemNode, lastEnd: L.end, contentCol: item.contentCol, hadContent: !item.empty });
        p = item.contentP;
        col = item.contentCol;
        touchEnds(L.end);
        opened = true;
        continue;
      }
    }

    // a leaf line arriving while a bare `list` frame is on top ends the list
    // (content sits in items, never directly in a list)
    if (!restIsBlank) {
      while (top().kind === 'list') closeTo(open.length - 1);
    }

    // 5) classify the remainder
    const s = scanIndent(text, p, col);
    const indent = s.col - col;
    const rest = text.slice(s.p);

    if (restIsBlank) {
      if (leaf && (leaf.kind === 'paragraph' || leaf.kind === 'table')) closeLeaf();
      for (const f of open) {
        if (f.kind === 'list') f.blankSeen = true;
        if (f.kind === 'item' && f.hadContent) f.blankInside = true;
      }
      continue;
    }
    // a blank separated the last item's content from new content in the SAME item -> loose
    for (const f of open) {
      if (f.kind === 'item' && f.blankInside) {
        const parentList = open[open.indexOf(f) - 1];
        if (parentList && parentList.kind === 'list') parentList.loose = true;
        f.blankInside = false;
      }
    }

    if (indent >= 4) {
      if (leaf && leaf.kind === 'paragraph') { // indented code cannot interrupt a paragraph
        leaf.segs.push({ text: rest, src: L.start + s.p });
        touchEnds(L.end);
        continue;
      }
      closeLeaf();
      const d = consumeCols(text, p, col, col + 4);
      leaf = { kind: 'indented', valueLines: [text.slice(d.p)], pendingBlanks: [], startOffset: L.start + d.p, endOffset: L.end };
      touchEnds(L.end);
      continue;
    }

    // setext heading (paragraph directly above, fully matched containers)
    if (leaf && leaf.kind === 'paragraph' && allMatched && SETEXT_RE.test(rest)) {
      const segs = leaf.segs;
      leaf = null;
      appendNode({
        type: 'heading',
        depth: rest[0] === '=' ? 1 : 2,
        children: [],
        _raw: buildRaw(segs),
        position: { start: pt(segs[0].src), end: pt(L.end) },
      });
      touchEnds(L.end);
      continue;
    }

    const atx = ATX_RE.exec(rest);
    if (atx) {
      closeLeaf();
      let content = atx[2] || '';
      const closing = /[ \t]+#+[ \t]*$/.exec(content);
      if (closing) content = content.slice(0, closing.index);
      if (/^#+$/.test(content)) content = '';
      // content offset: after the hashes + following whitespace
      let cp = s.p + atx[1].length;
      while (cp < text.length && (text[cp] === ' ' || text[cp] === '\t')) cp++;
      appendNode({
        type: 'heading',
        depth: atx[1].length,
        children: [],
        _raw: { text: content, segs: [{ v: 0, src: L.start + cp, len: content.length }] },
        position: { start: pt(L.start + s.p), end: pt(L.end) },
      });
      touchEnds(L.end);
      continue;
    }

    const fence = FENCE_OPEN_RE.exec(rest);
    if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) {
      closeLeaf();
      const info = unescapeMd(fence[2].trim());
      const spaceIdx = info.search(/[ \t]/);
      leaf = {
        kind: 'fenced',
        char: fence[1][0],
        len: fence[1].length,
        indent,
        lang: info ? (spaceIdx === -1 ? info : info.slice(0, spaceIdx)) : null,
        meta: info && spaceIdx !== -1 ? info.slice(spaceIdx + 1).trim() : null,
        valueLines: [],
        startOffset: L.start + s.p,
        endOffset: L.end,
      };
      touchEnds(L.end);
      continue;
    }

    if (THEMATIC_RE.test(rest)) {
      closeLeaf();
      appendNode({ type: 'thematicBreak', position: { start: pt(L.start + s.p), end: pt(L.end) } });
      touchEnds(L.end);
      continue;
    }

    const html = htmlBlockStart(rest, !!(leaf && leaf.kind === 'paragraph'));
    if (html) {
      closeLeaf();
      leaf = { kind: 'html', endCond: html.end, valueLines: [rest], startOffset: L.start + s.p, endOffset: L.end };
      touchEnds(L.end);
      if (html.end !== 'blank' && html.end.test(rest)) closeLeaf(); // one-line block (e.g. <!-- x -->)
      continue;
    }

    // GFM table: delimiter row directly under a 1+-line paragraph whose LAST
    // line is the header with a matching cell count.
    if (leaf && leaf.kind === 'paragraph' && allMatched) {
      const delim = parseDelimiterRow(rest);
      if (delim) {
        const headerSeg = leaf.segs[leaf.segs.length - 1];
        const header = splitRow(headerSeg.text);
        if (header.hadPipe && header.cells.length === delim.count) {
          const before = leaf.segs.slice(0, -1);
          leaf = null;
          if (before.length) finalizeParagraph({ segs: before });
          const tableNode = appendNode({
            type: 'table',
            align: delim.align,
            children: [],
            position: { start: pt(headerSeg.src), end: pt(L.end) },
          });
          const headRow = makeRow(header.cells, headerSeg.src);
          tableNode.children.push(headRow);
          leaf = { kind: 'table', node: tableNode, headerCount: delim.count, endOffset: L.end };
          touchEnds(L.end);
          continue;
        }
      }
    }

    if (leaf && leaf.kind === 'table') {
      const row = splitRow(rest);
      leaf.node.children.push(makeRow(row.cells, L.start + s.p));
      leaf.endOffset = L.end;
      touchEnds(L.end);
      continue;
    }

    // paragraph (open or continue)
    if (leaf && leaf.kind === 'paragraph') {
      leaf.segs.push({ text: text.slice(s.p), src: L.start + s.p });
    } else {
      closeLeaf();
      leaf = { kind: 'paragraph', segs: [{ text: text.slice(s.p), src: L.start + s.p }] };
    }
    touchEnds(L.end);
  }

  closeTo(1);
  doc.position.end = pt(open[0].lastEnd || input.length);

  function makeRow(cells, rowSrcBase) {
    // rowSrcBase = source offset of the row text's char 0 (cells carry offsets
    // relative to the SPLIT string, which started at the row's first char)
    return {
      type: 'tableRow',
      children: cells.map((c) => ({
        type: 'tableCell',
        children: [],
        _raw: { text: c.text, segs: [{ v: 0, src: rowSrcBase + c.offset, len: c.text.length }] },
        position: { start: pt(rowSrcBase + c.offset), end: pt(rowSrcBase + c.offset + c.text.length) },
      })),
      position: { start: pt(rowSrcBase), end: pt(rowSrcBase + (cells.length ? cells[cells.length - 1].offset + cells[cells.length - 1].text.length : 0)) },
    };
  }

  function siblingItemStart(text, p, col) {
    const s = scanIndent(text, p, col);
    if (s.col - col >= 4) return false;
    const item = matchListItem(text, s.p, s.col);
    if (!item || item.empty) return false;
    return open.some((f) => f.kind === 'list' && f.ordered === item.ordered &&
      f.bullet === item.bullet && f.delim === item.delim);
  }

  function startsNewBlock(text, p, col) {
    const s = scanIndent(text, p, col);
    if (s.col - col >= 4) return false; // would be code, which cannot interrupt
    const rest = text.slice(s.p);
    if (rest[0] === '>') return true;
    if (ATX_RE.test(rest)) return true;
    if (FENCE_OPEN_RE.test(rest)) return true;
    if (THEMATIC_RE.test(rest)) return true;
    if (htmlBlockStart(rest, true)) return true;
    const item = matchListItem(text, s.p, s.col);
    if (item && item.canInterrupt) return true;
    return false;
  }

  // ------------- phase 2: inline parsing (definitions are all known) ---------

  // GFM task-list markers: [ ] / [x] at the very start of an item's first
  // paragraph — stripped BEFORE inline parsing (the bracket would otherwise
  // tokenize as a reference opener).
  walk(doc, (node) => {
    if (node.type !== 'listItem' || !node.children.length) return;
    const firstChild = node.children[0];
    if (firstChild.type !== 'paragraph' || !firstChild._raw) return;
    const m = /^\[([ xX])\][ \t]+/.exec(firstChild._raw.text);
    if (!m) return;
    node.checked = m[1] !== ' ';
    const k = m[0].length;
    firstChild._raw.text = firstChild._raw.text.slice(k);
    const segs = firstChild._raw.segs;
    if (segs.length && segs[0].len >= k) {
      segs[0].src += k;
      segs[0].len -= k;
      for (const sg of segs) sg.v = Math.max(0, sg.v - k);
    }
  });

  walk(doc, (node) => {
    if (node._raw) {
      if (node.type === 'image' || node.type === 'imageReference') return;
      node.children = parseInlines(node._raw, definitions, pt);
      delete node._raw;
    }
  });

  void bomOffset;
  return doc;
}

// ---------------------------------------------------------------------------
// Inline parser (per leaf raw). Standard CommonMark two-phase approach:
// tokenize (code spans / autolinks / raw HTML / brackets / delimiter runs),
// resolve links on ']', then process_emphasis with the delimiter stack.
// ---------------------------------------------------------------------------

const AUTOLINK_URL_RE = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*)>/;
const AUTOLINK_EMAIL_RE = /^<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/;
const INLINE_HTML_RE = /^<(?:\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|!--[\s\S]*?-->|\?[\s\S]*?\?>|![A-Za-z][^>]*>|!\[CDATA\[[\s\S]*?\]\]>)/;
const UNI_WS = /\s/u;
const UNI_PUNCT = /[\p{P}\p{S}]/u;

function classifyFlanking(s, runStart, runEnd) {
  const before = runStart > 0 ? s[runStart - 1] : '\n';
  const after = runEnd < s.length ? s[runEnd] : '\n';
  const bWs = UNI_WS.test(before);
  const bPunct = UNI_PUNCT.test(before);
  const aWs = UNI_WS.test(after);
  const aPunct = UNI_PUNCT.test(after);
  const left = !aWs && (!aPunct || bWs || bPunct);
  const right = !bWs && (!bPunct || aWs || aPunct);
  return { left, right, bPunct, aPunct };
}

function parseInlines(raw, definitions, pt) {
  const s = raw.text;
  const segs = raw.segs;

  // virtual offset -> source offset (end=true maps a boundary to the previous
  // segment's end instead of the next segment's start)
  function mapV(v, end = false) {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].v <= v) lo = mid;
      else hi = mid - 1;
    }
    const seg = segs[lo];
    const within = Math.min(Math.max(v - seg.v, 0), seg.len);
    if (end && v - seg.v > seg.len) return seg.src + seg.len; // in the virtual '\n' gap
    return seg.src + within;
  }
  const P = (v0, v1) => ({ start: pt(mapV(v0)), end: pt(mapV(v1, true)) });

  const nodes = [];
  const delims = [];
  const brackets = [];
  let buf = '';
  let bufV = 0;
  let i = 0;

  function flush(endV) {
    if (buf) {
      nodes.push({ type: 'text', value: buf, _v0: bufV, _v1: endV });
      buf = '';
    }
    bufV = endV;
  }
  function pushText(value, v0, v1) {
    flush(v0);
    nodes.push({ type: 'text', value, _v0: v0, _v1: v1 });
    bufV = v1;
  }

  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      const nx = s[i + 1];
      if (nx === '\n') { flush(i); nodes.push({ type: 'break', _v0: i, _v1: i + 2 }); i += 2; bufV = i; continue; }
      if (nx != null && ESCAPABLE.test(nx)) { if (!buf) bufV = i; buf += nx; i += 2; continue; }
      if (!buf) bufV = i;
      buf += '\\';
      i++;
      continue;
    }
    if (c === '\n') {
      const trimmed = buf.replace(/ +$/, '');
      if (buf.length - trimmed.length >= 2) {
        buf = trimmed;
        flush(i);
        nodes.push({ type: 'break', _v0: i, _v1: i + 1 });
      } else {
        buf = trimmed;
        if (!buf) bufV = i;
        buf += '\n';
      }
      i++;
      continue;
    }
    if (c === '`') {
      let k = 1;
      while (s[i + k] === '`') k++;
      // find a closing run of exactly k
      let j = i + k;
      let close = -1;
      while (j < s.length) {
        if (s[j] === '`') {
          let m = 1;
          while (s[j + m] === '`') m++;
          if (m === k) { close = j; break; }
          j += m;
        } else j++;
      }
      if (close !== -1) {
        flush(i);
        let value = s.slice(i + k, close).replace(/\n/g, ' ');
        if (value.length >= 2 && value.startsWith(' ') && value.endsWith(' ') && value.trim() !== '') value = value.slice(1, -1);
        nodes.push({ type: 'inlineCode', value, _v0: i, _v1: close + k });
        i = close + k;
        bufV = i;
      } else {
        if (!buf) bufV = i;
        buf += s.slice(i, i + k);
        i += k;
      }
      continue;
    }
    if (c === '<') {
      const rest = s.slice(i);
      let m = AUTOLINK_URL_RE.exec(rest);
      if (m) {
        flush(i);
        nodes.push({ type: 'link', url: m[1], title: null, children: [{ type: 'text', value: m[1], _v0: i + 1, _v1: i + m[0].length - 1 }], _v0: i, _v1: i + m[0].length });
        i += m[0].length;
        bufV = i;
        continue;
      }
      m = AUTOLINK_EMAIL_RE.exec(rest);
      if (m) {
        flush(i);
        nodes.push({ type: 'link', url: `mailto:${m[1]}`, title: null, children: [{ type: 'text', value: m[1], _v0: i + 1, _v1: i + m[0].length - 1 }], _v0: i, _v1: i + m[0].length });
        i += m[0].length;
        bufV = i;
        continue;
      }
      m = INLINE_HTML_RE.exec(rest);
      if (m) {
        flush(i);
        nodes.push({ type: 'html', value: m[0], passthrough: true, _v0: i, _v1: i + m[0].length });
        i += m[0].length;
        bufV = i;
        continue;
      }
      if (!buf) bufV = i;
      buf += '<';
      i++;
      continue;
    }
    if (c === '[') {
      pushText('[', i, i + 1);
      brackets.push({ nodeIndex: nodes.length - 1, image: false, active: true, textEndV: i + 1 });
      i++;
      bufV = i;
      continue;
    }
    if (c === '!' && s[i + 1] === '[') {
      pushText('![', i, i + 2);
      brackets.push({ nodeIndex: nodes.length - 1, image: true, active: true, textEndV: i + 2 });
      i += 2;
      bufV = i;
      continue;
    }
    if (c === ']') {
      flush(i);
      i = resolveBracket(i);
      bufV = i;
      continue;
    }
    if (c === '*' || c === '_' || c === '~') {
      let k = 1;
      while (s[i + k] === c) k++;
      if (c === '~' && k !== 2) {
        if (!buf) bufV = i;
        buf += s.slice(i, i + k);
        i += k;
        continue;
      }
      const f = classifyFlanking(s, i, i + k);
      let canOpen;
      let canClose;
      if (c === '_') {
        canOpen = f.left && (!f.right || f.bPunct);
        canClose = f.right && (!f.left || f.aPunct);
      } else {
        canOpen = f.left;
        canClose = f.right;
      }
      pushText(s.slice(i, i + k), i, i + k);
      delims.push({ node: nodes[nodes.length - 1], char: c, length: k, origLen: k, canOpen, canClose });
      i += k;
      bufV = i;
      continue;
    }
    if (!buf) bufV = i;
    buf += c;
    i++;
  }
  flush(s.length);

  processEmphasis(nodes, delims, -1);

  // final position mapping
  const finalize = (list) => {
    for (const n of list) {
      if (n._v0 != null) { n.position = P(n._v0, n._v1); delete n._v0; delete n._v1; }
      if (Array.isArray(n.children)) finalize(n.children);
    }
  };
  finalize(nodes);
  return nodes;

  // --- ']' resolution ---------------------------------------------------------
  function resolveBracket(closeIdx) {
    let bk = null;
    for (let b = brackets.length - 1; b >= 0; b--) {
      if (brackets[b].taken) continue;
      bk = brackets[b];
      brackets.splice(b, 1);
      break;
    }
    if (!bk) { pushText(']', closeIdx, closeIdx + 1); return closeIdx + 1; }
    if (!bk.active) { pushText(']', closeIdx, closeIdx + 1); return closeIdx + 1; }

    let after = closeIdx + 1;
    let url = null;
    let title = null;
    let refType = null;
    let identifier = null;
    let label = null;
    let ok = false;

    if (s[after] === '(') {
      const r = parseInlineDest(after + 1);
      if (r) { url = r.url; title = r.title; after = r.after; ok = true; }
    }
    if (!ok && s[after] === '[') {
      const end = s.indexOf(']', after + 1);
      if (end !== -1 && !s.slice(after + 1, end).includes('[')) {
        const lbl = s.slice(after + 1, end);
        if (lbl.trim()) {
          refType = 'full';
          label = lbl;
          identifier = normalizeLabel(lbl);
          after = end + 1;
          ok = true;
        } else {
          refType = 'collapsed';
          label = s.slice(bk.textEndV, closeIdx);
          identifier = normalizeLabel(label);
          after = end + 1;
          ok = true;
        }
      }
    }
    if (!ok) {
      // shortcut reference — ONLY when a definition exists (an undefined bare
      // [text] is plain prose per spec; flagging it would cry-wolf on
      // checkboxes, wiki-links, and ordinary brackets)
      const lbl = s.slice(bk.textEndV, closeIdx);
      const id = normalizeLabel(lbl);
      if (lbl.trim() && definitions.has(id)) {
        refType = 'shortcut';
        label = lbl;
        identifier = id;
        ok = true;
      }
    }
    if (!ok) { pushText(']', closeIdx, closeIdx + 1); return closeIdx + 1; }

    const children = nodes.splice(bk.nodeIndex + 1);
    nodes.pop(); // the '[' / '![' opener text node
    processEmphasis(children, delims, -1, children);

    let node;
    if (url != null) {
      node = bk.image
        ? { type: 'image', url, title, alt: plainText(children), _v0: bk.textEndV - (bk.image ? 2 : 1), _v1: after }
        : { type: 'link', url, title, children, _v0: bk.textEndV - 1, _v1: after };
    } else {
      node = bk.image
        ? { type: 'imageReference', identifier, label, referenceType: refType, alt: plainText(children), _v0: bk.textEndV - 2, _v1: after }
        : { type: 'linkReference', identifier, label, referenceType: refType, children, _v0: bk.textEndV - 1, _v1: after };
    }
    nodes.push(node);
    if (!bk.image) for (const b of brackets) { if (!b.image) b.active = false; }
    return after;
  }

  function parseInlineDest(from) {
    let j = from;
    let destTitle = null;
    while (j < s.length && /[ \t\n]/.test(s[j])) j++;
    let url = '';
    if (s[j] === '<') {
      const end = s.indexOf('>', j + 1);
      if (end === -1 || s.slice(j + 1, end).includes('\n')) return null;
      url = s.slice(j + 1, end);
      j = end + 1;
    } else {
      let depth = 0;
      const st = j;
      // Bound the destination scan: a real inline-link URL is never this long,
      // and without the bound `[a](` repeated N times makes each `]` re-scan the
      // tail to EOS -> O(N^2) parse (a crafted-doc hang). Over the cap = not a
      // valid inline destination -> return null (the text stays literal, exactly
      // what an unterminated destination already does).
      while (j < s.length) {
        if (j - st > MAX_INLINE_DEST) return null;
        const ch = s[j];
        if (ch === '\\' && j + 1 < s.length) { j += 2; continue; }
        if (/[ \t\n]/.test(ch)) break;
        if (ch === '(') depth++;
        if (ch === ')') { if (depth === 0) break; depth--; }
        j++;
      }
      url = s.slice(st, j);
    }
    while (j < s.length && /[ \t\n]/.test(s[j])) j++;
    if (s[j] === '"' || s[j] === "'" || s[j] === '(') {
      const closeCh = s[j] === '(' ? ')' : s[j];
      let k = j + 1;
      while (k < s.length) {
        if (k - j > MAX_INLINE_DEST) return null; // unterminated title within the cap = not a valid link
        if (s[k] === '\\') { k += 2; continue; }
        if (s[k] === closeCh) break;
        k++;
      }
      if (k >= s.length) return null;
      destTitle = unescapeMd(s.slice(j + 1, k));
      j = k + 1;
      while (j < s.length && /[ \t\n]/.test(s[j])) j++;
    }
    if (s[j] !== ')') return null;
    return { url: unescapeMd(url), title: destTitle, after: j + 1 };
  }

  function processEmphasis(nodeList, allDelims, _bottom, scope) {
    const inScope = (d) => nodeList.includes(d.node);
    const live = allDelims.filter((d) => d.length > 0 && inScope(d));
    let ci = 0;
    while (ci < live.length) {
      const closer = live[ci];
      if (!closer.canClose || closer.length === 0) { ci++; continue; }
      let oi = -1;
      for (let k = ci - 1; k >= 0; k--) {
        const op = live[k];
        if (op.length === 0 || op.char !== closer.char || !op.canOpen) continue;
        if (closer.char !== '~' && (closer.canOpen || op.canClose) &&
            (op.origLen + closer.origLen) % 3 === 0 &&
            !(op.origLen % 3 === 0 && closer.origLen % 3 === 0)) continue;
        if (closer.char === '~' && (op.origLen !== 2 || closer.origLen !== 2)) continue;
        oi = k;
        break;
      }
      if (oi === -1) {
        if (!closer.canOpen) live.splice(ci, 1);
        else ci++;
        continue;
      }
      const opener = live[oi];
      const use = closer.char === '~' ? 2 : (opener.length >= 2 && closer.length >= 2 ? 2 : 1);
      const type = closer.char === '~' ? 'delete' : (use === 2 ? 'strong' : 'emphasis');
      const oIdx = nodeList.indexOf(opener.node);
      const cIdx = nodeList.indexOf(closer.node);
      if (oIdx === -1 || cIdx === -1 || cIdx <= oIdx) { ci++; continue; }
      const inner = nodeList.slice(oIdx + 1, cIdx);
      const wrap = { type, children: inner, _v0: opener.node._v1 - use, _v1: closer.node._v0 + use };
      opener.length -= use;
      closer.length -= use;
      opener.node.value = opener.node.value.slice(0, opener.length);
      opener.node._v1 -= use;
      closer.node.value = closer.node.value.slice(use);
      closer.node._v0 += use;
      nodeList.splice(oIdx + 1, inner.length, wrap);
      // delimiters strictly between opener and closer die with the wrap
      for (let k = oi + 1; k < ci && k < live.length; k++) live[k].length = 0;
      if (opener.length === 0) {
        const idx = nodeList.indexOf(opener.node);
        if (idx !== -1) nodeList.splice(idx, 1);
      }
      if (closer.length === 0) {
        const idx = nodeList.indexOf(closer.node);
        if (idx !== -1) nodeList.splice(idx, 1);
        live.splice(ci, 1);
      }
      // re-scan from the first live delimiter after the opener
      ci = 0;
      while (ci < live.length && live[ci].length === 0) ci++;
      void scope;
    }
    // drop zero-length leftovers from the shared list
    for (const d of allDelims) {
      if (d.length === 0) {
        const idx = nodeList.indexOf(d.node);
        if (idx !== -1 && d.node.value === '') nodeList.splice(idx, 1);
      }
    }
  }

  function plainText(list) {
    return list.map(textContent).join('');
  }
}
