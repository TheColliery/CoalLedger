// CWK-101 -- lang-mechanics.mjs's ZH exemplar (CWK-101-DESIGN §5's test
// plan, per rule): positive · native-clean · script-boundary · ZH/JA split ·
// markdown exclusions · CLI contract · build wiring. ONE ASSERTION PER
// BEHAVIOUR (this room has paid four times for a multi-assertion sabotage
// test that could not discriminate -- CWK-032's guard, CWK-023's LOW-2,
// CWK-054's Rail, CWK-057's LOW-1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkText, RULES } from './lang-mechanics.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, 'lang-mechanics.mjs');

// ---------------------------------------------------------------------------
// 1. Positive -- the violation fires, at the right column.
// ---------------------------------------------------------------------------
test('zh-halfwidth-punct: an ASCII comma between two Han characters fires at the comma\'s own column', () => {
  const hits = checkText('你好,再见');
  assert.equal(hits.length, 1);
});

test('zh-halfwidth-punct: the finding column points at the comma itself, not the preceding Han character', () => {
  const hits = checkText('你好,再见');
  assert.equal(hits[0].col, 3); // 你(1) 好(2) ,(3)
});

test('zh-space-before-punct: a space between a Han character and a full-width comma fires', () => {
  const hits = checkText('你好 ，再见');
  assert.equal(hits.length, 1);
});

test('zh-space-before-punct: the finding column points at the start of the space run', () => {
  const hits = checkText('你好 ，再见');
  assert.equal(hits[0].col, 3); // 你(1) 好(2) space(3)
});

test('zh-space-before-punct: the finding length covers the WHOLE space run, not just one space', () => {
  const hits = checkText('你好  ，再见'); // two spaces
  assert.equal(hits[0].length, 2);
});

// ---------------------------------------------------------------------------
// 2. Native clean -- correct text in that script yields 0.
// ---------------------------------------------------------------------------
test('native clean: full-width punctuation directly after Han, no gap, yields 0', () => {
  assert.equal(checkText('你好，再见。').length, 0);
});

// ---------------------------------------------------------------------------
// 3. Script boundary -- the same ASCII punctuation elsewhere yields 0.
// ---------------------------------------------------------------------------
test('script boundary: the same ASCII comma in a pure Latin sentence yields 0 (no Han neighbour)', () => {
  assert.equal(checkText('hello, world').length, 0);
});

test('script boundary: a Thai line with an ASCII comma yields 0 (no Han present)', () => {
  assert.equal(checkText('สวัสดี, ครับ').length, 0);
});

// ---------------------------------------------------------------------------
// 4. ZH/JA split -- a Kana-bearing line does NOT fire the ZH rule, even
// where the same Han-comma-Han pattern is structurally present.
// ---------------------------------------------------------------------------
test('ZH/JA split: a Kana-bearing line with an ASCII comma between Kanji does NOT fire the ZH rule', () => {
  // アメリカ (Kana) ... 可以,可以 (Han-comma-Han, the exact fireable shape) ... です (Kana)
  assert.equal(checkText('アメリカ可以,可以です').length, 0);
});

test('ZH/JA split: the SAME Han-comma-Han pattern with NO Kana on the line DOES fire (control proving the gate is live, not just absent Han)', () => {
  assert.equal(checkText('可以,可以').length, 1);
});

// ---------------------------------------------------------------------------
// 4b. ZH/KO split (HIGH-1, r34 INSPECT) -- any Hangul on the line VETOES 'zh',
// the same as any Kana. A Korean sentence writing a place name in Hanja
// (Han characters) is outside GB/T 15834-2011's own §1 scope (汉语的书面语),
// so firing the ZH rule on it is a false positive, not a bounded misread.
// ---------------------------------------------------------------------------
test('ZH/KO split: a Hangul-bearing line with Hanja and an ASCII comma does NOT fire the ZH rule', () => {
  assert.equal(checkText('大韓民國,日本은 이웃 나라다.').length, 0);
});

test('ZH/KO split: the pure-ZH control (no Hangul) still fires', () => {
  assert.equal(checkText('中文,测试').length, 1);
});

// ---------------------------------------------------------------------------
// 5. Markdown exclusions.
// ---------------------------------------------------------------------------
test('markdown exclusions: a fenced code block is skipped whole', () => {
  assert.equal(checkText('```\n你好,再见\n```').length, 0);
});

test('markdown exclusions: an inline code span is masked (no Han survives the mask)', () => {
  assert.equal(checkText('`你好,再见`').length, 0);
});

// MED-1 (r34 INSPECT): "markdown-aware exactly like emdash.mjs" was false --
// these four exclusions were measured missing, each red-first before fixing.
test('markdown exclusions: a 4-space-indented code block is skipped whole (parity with emdash.mjs)', () => {
  assert.equal(checkText('段落。\n\n    变量,函数').length, 0);
});

test('markdown exclusions: an HTML comment containing a space is masked', () => {
  assert.equal(checkText('<!-- 注释,注释 -->').length, 0);
});

test('markdown exclusions: an HTML tag with a spaced attribute is masked', () => {
  assert.equal(checkText('<span title="中,文">').length, 0);
});

test('markdown exclusions: a YAML front matter block is skipped whole', () => {
  assert.equal(checkText('---\ntitle: 标题,副标题\n---\n').length, 0);
});

test('markdown exclusions: a link destination is masked (Han-comma-Han hidden inside a URL)', () => {
  assert.equal(checkText('[链接](http://x你,好y)').length, 0);
});

test('markdown exclusions: a blockquote line is skipped whole', () => {
  assert.equal(checkText('> 你好,再见').length, 0);
});

test('markdown exclusions: opts.plain disables fence-skipping (the same text WOULD fire without markdown awareness)', () => {
  assert.equal(checkText('```\n你好,再见\n```', { plain: true }).length, 1);
});

// ---------------------------------------------------------------------------
// 6. CLI contract -- exit 0 on findings, exit 1 on an unreadable file,
// --json shape. Load-bearing (r32's own lesson): the CLI must be provably
// unable to fail on a findings-only run.
// ---------------------------------------------------------------------------
test('CLI: a findings run exits 0 and prints the "N finding(s) across N file(s)" summary', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clg-lang-cli-'));
  try {
    const f = path.join(tmp, 'a.md');
    fs.writeFileSync(f, '你好,再见\n');
    const r = spawnSync(process.execPath, [CLI, f], { encoding: 'utf8' });
    assert.equal(r.status, 0);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('CLI: the same findings run\'s stdout carries the summary line, never a non-zero exit as the finding signal', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clg-lang-cli-'));
  try {
    const f = path.join(tmp, 'a.md');
    fs.writeFileSync(f, '你好,再见\n');
    const r = spawnSync(process.execPath, [CLI, f], { encoding: 'utf8' });
    assert.match(r.stdout, /^1 finding\(s\) across 1 file\(s\)$/m);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('CLI: an unreadable file exits 1', () => {
  const r = spawnSync(process.execPath, [CLI, path.join(os.tmpdir(), 'clg-lang-does-not-exist-xyz.md')], { encoding: 'utf8' });
  assert.equal(r.status, 1);
});

test('CLI: --json emits a parseable array with one entry per file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clg-lang-cli-'));
  try {
    const f = path.join(tmp, 'a.md');
    fs.writeFileSync(f, '你好,再见\n');
    const r = spawnSync(process.execPath, [CLI, '--json', f], { encoding: 'utf8' });
    const out = JSON.parse(r.stdout);
    assert.equal(out.length, 1);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('CLI: --json\'s one entry names the rule that fired', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clg-lang-cli-'));
  try {
    const f = path.join(tmp, 'a.md');
    fs.writeFileSync(f, '你好,再见\n');
    const r = spawnSync(process.execPath, [CLI, '--json', f], { encoding: 'utf8' });
    const out = JSON.parse(r.stdout);
    assert.equal(out[0].findings[0].rule, 'zh-halfwidth-punct');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// authority field -- THE FORMAL STANDARD doctrine: a rule with no authority
// does not ship.
// ---------------------------------------------------------------------------
test('every shipped rule names a non-empty authority', () => {
  const missing = Object.values(RULES).filter((r) => !r.authority || !r.authority.trim());
  assert.equal(missing.length, 0);
});
