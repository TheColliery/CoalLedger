// Unit tests for scripts/lib/desc-cap.mjs — the skill-listing description-length
// gate. Zero-dep (node:test + built-ins), per scripts-quality.md section 2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontmatterField, descriptionCapCheck, DESC_CAP } from './desc-cap.mjs';

test('bare single-line description parses', () => {
  const text = '---\nname: x\ndescription: hello world\n---\nbody';
  assert.equal(frontmatterField(text, 'description'), 'hello world');
});

test('quoted single-line description strips the quotes', () => {
  const text = '---\nname: x\ndescription: "hello, world"\n---\nbody';
  assert.equal(frontmatterField(text, 'description'), 'hello, world');
});

test('block-scalar (>-) description joins indented lines with single spaces', () => {
  const text = '---\nname: x\ndescription: >-\n  line one\n  line two\n---\nbody';
  assert.equal(frontmatterField(text, 'description'), 'line one line two');
});

test('missing frontmatter block or missing key returns null', () => {
  assert.equal(frontmatterField('no frontmatter here', 'description'), null);
  assert.equal(frontmatterField('---\nname: x\n---\nbody', 'description'), null);
});

test('description at the cap passes (boundary, not over)', () => {
  const text = `---\nname: x\ndescription: ${'a'.repeat(DESC_CAP)}\n---\nbody`;
  const r = descriptionCapCheck(text);
  assert.equal(r.len, DESC_CAP);
  assert.equal(r.over, false);
});

test('description over the cap fails — the negative-path case', () => {
  const text = `---\nname: x\ndescription: ${'a'.repeat(DESC_CAP + 1)}\n---\nbody`;
  const r = descriptionCapCheck(text);
  assert.equal(r.len, DESC_CAP + 1);
  assert.equal(r.over, true);
});

test('description + when_to_use combine toward the cap', () => {
  const text = `---\nname: x\ndescription: ${'a'.repeat(600)}\nwhen_to_use: ${'b'.repeat(500)}\n---\nbody`;
  const r = descriptionCapCheck(text);
  assert.equal(r.len, 1100);
  assert.equal(r.over, true);
});

// ---------------------------------------------------------------------------
// CWK-120 row 9 (CodeRabbit, `desc-cap.mjs:29`): a YAML block scalar may carry
// an internal BLANK line followed by more indented text. The continuation loop
// stopped at the blank line, so the parser returned a TRUNCATED value -- and
// the consequence is not cosmetic: `descriptionCapCheck` then UNDERCOUNTS and a
// description over the cap passes the gate. One assertion per behaviour.
// ---------------------------------------------------------------------------
test('block scalar: an internal blank line does NOT terminate the value', () => {
  const text = '---\nname: x\ndescription: >-\n  line one\n\n  line two\n---\nbody';
  assert.equal(frontmatterField(text, 'description'), 'line one line two');
});

test('block scalar: the scan still STOPS at the next top-level field (the fix must not over-reach)', () => {
  const text = '---\ndescription: >-\n  only this\n\nname: not-part-of-the-description\n---\nbody';
  assert.equal(frontmatterField(text, 'description'), 'only this');
});

test('block scalar with a blank line: the cap check no longer undercounts (an over-cap value FAILS)', () => {
  const half = 'a'.repeat(600);
  const text = `---\nname: x\ndescription: >-\n  ${half}\n\n  ${half}\n---\nbody`;
  assert.equal(descriptionCapCheck(text).over, true);
});
