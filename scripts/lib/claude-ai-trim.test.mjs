import test from 'node:test';
import assert from 'node:assert/strict';
import { trimDescription, CLAUDE_AI_DESC_CAP } from './claude-ai-trim.mjs';

test('CLAUDE_AI_DESC_CAP is 200 (the platform constraint this exists to satisfy)', () => {
  assert.equal(CLAUDE_AI_DESC_CAP, 200);
});

test('a description already under the cap is returned unchanged', () => {
  const d = 'Short description.';
  assert.equal(trimDescription(d), d);
});

test('a description exactly at the cap is returned unchanged (boundary, not over)', () => {
  const d = 'x'.repeat(200);
  assert.equal(trimDescription(d), d);
  assert.equal(trimDescription(d).length, 200);
});

test('a description one char over the cap is trimmed and never exceeds it', () => {
  const d = 'word '.repeat(50); // 250 chars, always word-boundary-safe
  const out = trimDescription(d);
  assert.ok(out.length <= 200, `trimmed length ${out.length} must be <= 200`);
  assert.ok(out.endsWith('...'), 'trimmed output carries the ellipsis');
});

test('trim cuts at the last whitespace boundary, never mid-word', () => {
  const d = 'a'.repeat(150) + ' ' + 'b'.repeat(100); // 251 chars total
  const out = trimDescription(d);
  const withoutEllipsis = out.slice(0, -3);
  assert.ok(!withoutEllipsis.includes('b'), 'the cut lands before the second word, never splitting it');
});

test('deterministic: the same input always produces the same output', () => {
  const d = 'x'.repeat(300);
  assert.equal(trimDescription(d), trimDescription(d));
});

test('a real CoalLedger description (doc-quality, the longest at 895 chars) trims to <=200 and stays non-empty', () => {
  // Verbatim from skills/doc-quality/SKILL.md's frontmatter -- read via
  // frontmatterField and printed at the time this test was written, not
  // approximated: a fabricated fixture text is a defect this room's own
  // source-grounding discipline exists to catch.
  const real = 'Docs-health readability scan — two axes: QUALITY (bloat: filler, repetition, walls of text, buried leads; clarity: unexplained jargon, ambiguity, sentences that fight the reader) and language MECHANICS (typo, grammar, spelling, orthography — including script-level defects like decomposed characters that render right but break search, doubled spaces, wrong ellipsis/quote characters, spacing rules of the doc\'s language). Catches UNREADABLE or MALFORMED-LANGUAGE docs. Triggers on: "/doc-quality", "doc-quality", "tighten this doc", "proofread", "typos and grammar", "is this readable". Mechanical layer = deterministic mechanics (Unicode normalization, spacing, punctuation shape — ~free, report-only); semantic layer = bloat/clarity judgment + grammar in context (paid, consent-gated). Honors the project\'s own style/language rules where defined. Severity judged by context, never mechanical.';
  assert.ok(real.length > 200, 'fixture must actually exceed the cap to test trimming');
  const out = trimDescription(real);
  assert.ok(out.length <= 200);
  assert.ok(out.length > 0);
});
