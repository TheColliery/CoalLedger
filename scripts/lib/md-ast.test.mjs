// md-ast unit tests — the make-or-break component gets the hardest testing.
// Structure fidelity (CommonMark+GFM common cases), inline fidelity, positions,
// multilingual (Thai/CJK) neutrality, and robustness (CRLF/BOM/pathological).
import { test } from 'node:test';
import assert from 'node:assert';
import { parseMarkdown, walk, textContent, githubSlug, makeSlugger } from './md-ast.mjs';

const md = (src) => parseMarkdown(src);
const types = (node) => node.children.map((c) => c.type);
function findAll(root, type) {
  const out = [];
  walk(root, (n) => { if (n.type === type) out.push(n); });
  return out;
}
function first(root, type) {
  return findAll(root, type)[0];
}

// ---------------------------------------------------------------------------
// Block structure
// ---------------------------------------------------------------------------

test('ATX headings: depths 1-6, content, trailing hashes stripped', () => {
  const t = md('# one\n###### six\n## two ##\n####### seven hashes is a paragraph\n');
  const hs = findAll(t, 'heading');
  assert.deepStrictEqual(hs.map((h) => h.depth), [1, 6, 2]);
  assert.strictEqual(textContent(hs[0]), 'one');
  assert.strictEqual(textContent(hs[2]), 'two');
  assert.strictEqual(findAll(t, 'paragraph').length, 1);
});

test('setext headings: = is h1, - is h2, multi-line text joins', () => {
  const t = md('Title line\n===\n\nSub\ntitle\n---\n');
  const hs = findAll(t, 'heading');
  assert.deepStrictEqual(hs.map((h) => h.depth), [1, 2]);
  assert.strictEqual(textContent(hs[0]), 'Title line');
  assert.strictEqual(textContent(hs[1]), 'Sub\ntitle');
});

test('positions: heading line numbers are 1-based and accurate', () => {
  const t = md('para\n\n## head\n\nmore\n');
  const h = first(t, 'heading');
  assert.strictEqual(h.position.start.line, 3);
  assert.strictEqual(h.position.start.column, 1);
});

test('thematic breaks: ***, - - -, ___ ; and they outrank list items', () => {
  const t = md('***\n- - -\n___\n');
  assert.deepStrictEqual(types(t), ['thematicBreak', 'thematicBreak', 'thematicBreak']);
  assert.strictEqual(findAll(t, 'list').length, 0);
});

test('setext dash wins over thematic break under a paragraph', () => {
  const t = md('text\n---\n');
  assert.deepStrictEqual(types(t), ['heading']);
  assert.strictEqual(t.children[0].depth, 2);
});

test('fenced code: lang + meta, verbatim content, no inline parsing inside', () => {
  const t = md('```js meta info\nconst a = "*not em*";\n[not](a-link)\n```\n');
  const c = first(t, 'code');
  assert.strictEqual(c.lang, 'js');
  assert.strictEqual(c.meta, 'meta info');
  assert.strictEqual(c.value, 'const a = "*not em*";\n[not](a-link)');
  assert.strictEqual(findAll(t, 'link').length, 0);
});

test('fenced code: unclosed fence runs to EOF; longer close fence works', () => {
  const t1 = md('```\nnever closed\n');
  assert.strictEqual(first(t1, 'code').value, 'never closed');
  const t2 = md('~~~\nbody\n~~~~~\nafter\n');
  assert.strictEqual(first(t2, 'code').value, 'body');
  assert.strictEqual(findAll(t2, 'paragraph').length, 1);
});

test('backtick fence info may not contain backticks (spec); tilde info may', () => {
  const t = md('``` a`b\nnot a fence open\n');
  assert.strictEqual(findAll(t, 'code').length, 0);
});

test('indented code: 4 spaces, internal blank kept, trailing blanks dropped', () => {
  const t = md('    line1\n\n    line2\n\npara\n');
  const c = first(t, 'code');
  assert.strictEqual(c.lang, null);
  assert.strictEqual(c.value, 'line1\n\nline2');
  assert.strictEqual(findAll(t, 'paragraph').length, 1);
});

test('indented chunk cannot interrupt a paragraph', () => {
  const t = md('para\n    still para\n');
  assert.strictEqual(findAll(t, 'code').length, 0);
  assert.strictEqual(textContent(first(t, 'paragraph')), 'para\nstill para');
});

test('blockquote: nesting and lazy continuation', () => {
  const t = md('> quoted\nlazy line\n\n> outer\n> > inner\n');
  const bqs = findAll(t, 'blockquote');
  assert.strictEqual(bqs.length, 3);
  assert.strictEqual(textContent(first(bqs[0], 'paragraph')), 'quoted\nlazy line');
  assert.strictEqual(textContent(bqs[2]), 'inner'); // depth-first: [first quote, outer, nested]
});

test('lists: bullet nesting by column, ordered start, marker change splits', () => {
  const t = md('- a\n  - a1\n- b\n\n3. three\n4. four\n\n1) paren\n');
  const lists = findAll(t, 'list');
  assert.strictEqual(lists.length, 4); // outer bullet, nested bullet, "3." list, "1)" list
  const outer = lists[0];
  assert.strictEqual(outer.ordered, false);
  assert.strictEqual(outer.children.length, 2);
  const nested = first(outer.children[0], 'list');
  assert.ok(nested, 'nested list sits inside the first item');
  const ord = lists.find((l) => l.ordered && l.start === 3);
  assert.ok(ord, 'ordered list keeps its start number');
  assert.strictEqual(ord.children.length, 2);
});

test('lists: tight by default, loose when a blank separates content', () => {
  const tight = md('- a\n- b\n');
  assert.strictEqual(first(tight, 'list').spread, false);
  const loose = md('- a\n\n- b\n');
  assert.strictEqual(first(loose, 'list').spread, true);
});

test('GFM task list: checked state parsed and marker stripped', () => {
  const t = md('- [x] done\n- [ ] todo\n- plain\n');
  const items = findAll(t, 'listItem');
  assert.deepStrictEqual(items.map((i) => i.checked), [true, false, null]);
  assert.strictEqual(textContent(items[0]), 'done');
});

test('fenced code inside a list item stays in the item', () => {
  const t = md('- item\n\n  ```\n  code here\n  ```\n');
  const item = first(t, 'listItem');
  const code = first(item, 'code');
  assert.ok(code, 'code node inside the item');
  assert.strictEqual(code.value, 'code here');
});

test('interruption rules: bullet interrupts a paragraph, "2." does not', () => {
  const t1 = md('para\n- item\n');
  assert.deepStrictEqual(types(t1), ['paragraph', 'list']);
  const t2 = md('para\n2. not a list\n');
  assert.deepStrictEqual(types(t2), ['paragraph']);
  const t3 = md('para\n1. is a list\n');
  assert.deepStrictEqual(types(t3), ['paragraph', 'list']);
});

test('GFM table: header/rows/align, escaped pipe, boundary pipes', () => {
  const t = md('| a | b |\n| :-- | --: |\n| x \\| y | z |\n');
  const table = first(t, 'table');
  assert.ok(table);
  assert.deepStrictEqual(table.align, ['left', 'right']);
  assert.strictEqual(table.children.length, 2);
  const bodyCells = table.children[1].children;
  assert.strictEqual(bodyCells.length, 2);
  assert.strictEqual(textContent(bodyCells[0]), 'x | y');
});

test('GFM table: ragged rows keep their real cell count in the AST', () => {
  const t = md('| a | b |\n| --- | --- |\n| 1 | 2 | 3 |\n| only |\n');
  const rows = first(t, 'table').children;
  assert.deepStrictEqual(rows.map((r) => r.children.length), [2, 3, 1]);
});

test('not a table: delimiter cell count differs from header', () => {
  const t = md('| a |\n| --- | --- |\n');
  assert.strictEqual(findAll(t, 'table').length, 0);
  assert.strictEqual(findAll(t, 'paragraph').length, 1);
});

test('table ends at a blank line; following text is a paragraph', () => {
  const t = md('| a |\n| --- |\n| 1 |\n\nafter\n');
  assert.strictEqual(first(t, 'table').children.length, 2);
  assert.strictEqual(textContent(findAll(t, 'paragraph')[0]), 'after');
});

test('html block: comment one-liner and div-to-blank, passthrough-flagged', () => {
  const t = md('<!-- a comment -->\n\n<div class="x">\ninside\n</div>\n\npara\n');
  const htmls = findAll(t, 'html');
  assert.strictEqual(htmls.length, 2);
  assert.ok(htmls.every((h) => h.passthrough === true));
  assert.ok(htmls[1].value.includes('inside'));
  assert.strictEqual(findAll(t, 'paragraph').length, 1);
});

test('definitions: collected with title, removed from paragraph, first wins', () => {
  const t = md('[a]: https://one.example "T1"\n[a]: https://two.example\n[b]: ./x.md\n\nuse [a] and [b].\n');
  const defs = findAll(t, 'definition');
  assert.strictEqual(defs.length, 3);
  assert.strictEqual(defs[0].title, 'T1');
  const refs = findAll(t, 'linkReference');
  assert.strictEqual(refs.length, 2, 'shortcut refs resolve because definitions exist');
  assert.strictEqual(findAll(t, 'paragraph').length, 1);
});

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

test('emphasis and strong: *em*, **strong**, nesting', () => {
  const t = md('*em* and **strong** and ***both***\n');
  assert.strictEqual(findAll(t, 'emphasis').length, 2);
  assert.strictEqual(findAll(t, 'strong').length, 2);
});

test('intraword: underscore does NOT emphasize, asterisk does', () => {
  const t1 = md('foo_bar_baz\n');
  assert.strictEqual(findAll(t1, 'emphasis').length, 0);
  assert.strictEqual(textContent(first(t1, 'paragraph')), 'foo_bar_baz');
  const t2 = md('foo*bar*baz\n');
  assert.strictEqual(findAll(t2, 'emphasis').length, 1);
});

test('strikethrough: ~~x~~ pairs, single ~ stays literal', () => {
  const t = md('~~gone~~ and not~this~\n');
  assert.strictEqual(findAll(t, 'delete').length, 1);
  assert.strictEqual(textContent(first(t, 'delete')), 'gone');
  assert.ok(textContent(first(t, 'paragraph')).includes('not~this~'));
});

test('code spans: run matching, embedded backtick, newline to space, unclosed literal', () => {
  const t = md('`simple` and `` a`b `` and `across\nlines` and `unclosed\n');
  const codes = findAll(t, 'inlineCode');
  assert.deepStrictEqual(codes.map((c) => c.value), ['simple', 'a`b', 'across lines']);
  assert.ok(textContent(first(t, 'paragraph')).includes('`unclosed'));
});

test('backslash escapes: \\* literal, \\[ no link', () => {
  const t = md('\\*not em\\* and \\[not a link](x)\n');
  assert.strictEqual(findAll(t, 'emphasis').length, 0);
  assert.strictEqual(findAll(t, 'link').length, 0);
  assert.ok(textContent(first(t, 'paragraph')).includes('*not em*'));
});

test('autolinks: URL and email; a non-scheme <angle> stays literal', () => {
  const t = md('<https://example.com/a> and <user@example.com> and <notalink>\n');
  const links = findAll(t, 'link');
  assert.strictEqual(links.length, 2);
  assert.strictEqual(links[0].url, 'https://example.com/a');
  assert.strictEqual(links[1].url, 'mailto:user@example.com');
});

test('inline links: title, <dest with spaces>, balanced parens in dest', () => {
  const t = md('[a](https://x.example "T") [b](<./with space.md>) [c](https://x.example/p(q)r)\n');
  const links = findAll(t, 'link');
  assert.strictEqual(links[0].title, 'T');
  assert.strictEqual(links[1].url, './with space.md');
  assert.strictEqual(links[2].url, 'https://x.example/p(q)r');
});

test('images: alt text flattens nested formatting', () => {
  const t = md('![the *alt* text](./img.png "T")\n');
  const img = first(t, 'image');
  assert.strictEqual(img.url, './img.png');
  assert.strictEqual(img.alt, 'the alt text');
});

test('reference links: full/collapsed/shortcut resolve; undefined full still emits linkReference; undefined shortcut stays prose', () => {
  const src = '[full][def] [collapsed][] [shortcut] [nodef][missing] [plain]\n\n[def]: https://x.example\n[collapsed]: https://y.example\n[shortcut]: https://z.example\n';
  const t = md(src);
  const refs = findAll(t, 'linkReference');
  const ids = refs.map((r) => r.identifier).sort();
  assert.deepStrictEqual(ids, ['collapsed', 'def', 'missing', 'shortcut']);
  assert.ok(textContent(first(t, 'paragraph')).includes('[plain]'), 'undefined bare bracket stays literal prose');
});

test('links do not nest: an outer bracket around a link goes literal', () => {
  const t = md('[outer [inner](https://x.example) tail](https://y.example)\n');
  const links = findAll(t, 'link');
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].url, 'https://x.example');
});

test('hard breaks (two spaces, backslash) vs soft break', () => {
  const t = md('a  \nb\\\nc\nd\n');
  assert.strictEqual(findAll(t, 'break').length, 2);
  assert.ok(textContent(first(t, 'paragraph')).includes('c\nd'));
});

test('inline positions: link start line/column map back to source', () => {
  const t = md('first\n\ntext [lnk](#x) more\n');
  const link = first(t, 'link');
  assert.strictEqual(link.position.start.line, 3);
  assert.strictEqual(link.position.start.column, 6);
});

// ---------------------------------------------------------------------------
// Multilingual (language-neutral by design)
// ---------------------------------------------------------------------------

test('Thai prose flows intact through paragraphs and emphasis (no char damage)', () => {
  const t = md('ข้อความ **สำคัญ** เด็ก ๆ กับ น้ำ\n');
  const para = first(t, 'paragraph');
  assert.ok(textContent(para).includes('สำคัญ'));
  assert.ok(textContent(para).includes('ำ'), 'U+0E33 preserved as-is');
  assert.strictEqual(findAll(t, 'strong').length, 1);
});

test('Thai and CJK heading slugs: Unicode letters/marks kept, punctuation stripped', () => {
  assert.strictEqual(githubSlug('การติดตั้ง'), 'การติดตั้ง');
  assert.strictEqual(githubSlug('中文标题'), '中文标题');
  assert.strictEqual(githubSlug('Hello, World! (v2)'), 'hello-world-v2');
  assert.strictEqual(githubSlug('Keep _under_ and-dash'), 'keep-_under_-and-dash');
});

test('slugger dedupes repeats GitHub-style (-1, -2)', () => {
  const s = makeSlugger();
  assert.strictEqual(s.slug('Repeated'), 'repeated');
  assert.strictEqual(s.slug('Repeated'), 'repeated-1');
  assert.strictEqual(s.slug('Repeated'), 'repeated-2');
});

test('textContent strips formatting: code spans, emphasis, image alt', () => {
  const t = md('## Heading with `code` and *emphasis* and ![alt bit](./x.png)\n');
  assert.strictEqual(textContent(first(t, 'heading')), 'Heading with code and emphasis and alt bit');
});

// ---------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------

test('CRLF input: same tree, correct line numbers', () => {
  const t = md('# h\r\n\r\npara\r\n');
  assert.deepStrictEqual(types(t), ['heading', 'paragraph']);
  assert.strictEqual(first(t, 'paragraph').position.start.line, 3);
  assert.strictEqual(textContent(first(t, 'paragraph')), 'para');
});

test('BOM is stripped', () => {
  const t = md('﻿# h\n');
  assert.strictEqual(first(t, 'heading').depth, 1);
  assert.strictEqual(textContent(first(t, 'heading')), 'h');
});

test('empty and whitespace-only documents parse to an empty root', () => {
  assert.deepStrictEqual(md('').children, []);
  assert.deepStrictEqual(md('  \n\t\n').children, []);
});

test('pathological nesting does not throw: quote > list > quote > code', () => {
  const t = md('> - item\n>   > deep quote\n>   ```\n>   code\n>   ```\n');
  assert.ok(first(t, 'blockquote'));
  assert.ok(first(t, 'listItem'));
  assert.ok(first(t, 'code'));
});

test('unbalanced emphasis and brackets stay literal without hanging', () => {
  const t = md('***a **b *c [d ![e `f\n');
  assert.strictEqual(t.children.length, 1);
  assert.ok(textContent(t.children[0]).length > 0);
});
