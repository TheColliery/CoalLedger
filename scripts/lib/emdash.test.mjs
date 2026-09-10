// CWK-073 -- emdash.mjs became core shared logic the moment it moved into
// scripts/lib/ (item 4), so scripts-quality.md section 2's MUST ("core
// shared logic must have unit tests runnable with node --test") now binds
// it. Its own --selftest/CASES mechanism (CWK-062) predates that move and
// stays the CLI-facing proof; this file wires the SAME table into the
// automated gate (node scripts/test.mjs) rather than forking a second table
// that could drift from it -- one source of truth, two consumers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanText, scanFile, isLegalPath, THIRD_PARTY_MARKER, CASES } from './emdash.mjs';

for (const [name, text, want, mode] of CASES) {
  test('CASES: ' + name, () => {
    assert.equal(scanText(text, mode).length, want);
  });
}

// isLegalPath (CWK-073 exclusion-class widening) -- the basename glob, each
// class named so a reviewer can see which real-world shape it covers.
test('isLegalPath: the original two-name set still matches (LICENSE/NOTICE, exact and with extensions)', () => {
  for (const p of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'NOTICE', 'NOTICE.md', 'NOTICE.txt']) {
    assert.ok(isLegalPath(p), p);
  }
});

test('isLegalPath: WIDENED past the original set -- COPYING* and case-insensitive', () => {
  for (const p of ['COPYING', 'COPYING.txt', 'copying', 'license.md', 'Notice.TXT']) {
    assert.ok(isLegalPath(p), p);
  }
});

test('isLegalPath: a docs/license.md-CLASS rendering matches by BASENAME regardless of directory', () => {
  for (const p of ['docs/license.md', 'vendor/COPYING', 'third_party/notice.md', path.join('a', 'b', 'LICENSE.txt')]) {
    assert.ok(isLegalPath(p), p);
  }
});

test('isLegalPath: an ordinary doc that merely STARTS with a legal word is not swept in', () => {
  for (const p of ['LICENSING-GUIDE.md', 'NOTICEBOARD.md', 'notice-of-changes.md']) {
    assert.equal(isLegalPath(p), false, p);
  }
});

// scanFile, file-based -- proves the isLegalPath check actually gates the
// filesystem entry point, not merely the pure predicate in isolation.
test('scanFile: a LICENSE-class file is skipped even though it carries a real hit under the configured mode', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-emdash-legal-'));
  try {
    const bad = 'alpha' + String.fromCharCode(0x2014) + 'beta'; // unspaced -> a finding under 'spaced' mode
    fs.writeFileSync(path.join(tmp, 'LICENSE.md'), bad);
    fs.writeFileSync(path.join(tmp, 'ordinary.md'), bad);
    assert.deepEqual(scanFile(path.join(tmp, 'LICENSE.md'), 'spaced'), [], 'LICENSE.md must be skipped by filename alone');
    assert.equal(scanFile(path.join(tmp, 'ordinary.md'), 'spaced').length, 1, 'CONTROL: the identical text in a non-legal filename must still fire');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// THIRD_PARTY_MARKER -- file-level exclusion, proven against a document that
// ALSO carries a real, would-otherwise-fire hit elsewhere in the same text.
test('THIRD_PARTY_MARKER: excludes the whole document even when a real hit sits on another line', () => {
  const text = THIRD_PARTY_MARKER + '\nintro\n\nalpha' + String.fromCharCode(0x2014) + 'beta\n';
  assert.deepEqual(scanText(text, 'spaced'), []);
});

test('THIRD_PARTY_MARKER: absent, the identical hit fires -- proves the marker is doing the work, not the text shape', () => {
  const text = 'intro\n\nalpha' + String.fromCharCode(0x2014) + 'beta\n';
  assert.equal(scanText(text, 'spaced').length, 1);
});

// mode='off' -- both entry points, both never fire regardless of content.
test("mode 'off': scanText never fires, whatever the text", () => {
  assert.deepEqual(scanText('alpha' + String.fromCharCode(0x2014) + 'beta', 'off'), []);
});

test("mode 'off': scanFile never fires either, even on an ordinary (non-legal) filename", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-emdash-off-'));
  try {
    fs.writeFileSync(path.join(tmp, 'ordinary.md'), 'alpha' + String.fromCharCode(0x2014) + 'beta alpha ' + String.fromCharCode(0x2014) + ' beta');
    assert.deepEqual(scanFile(path.join(tmp, 'ordinary.md'), 'off'), []);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// BLOCKQUOTE ruling (CWK-073 item 3) -- a mechanically visible quotation
// marker is excluded under EITHER mode, proving the ruling is mode-independent.
test('blockquote is excluded under BOTH modes -- the ruling this unit made, not a silent carry-over', () => {
  const line = '> quoted alpha' + String.fromCharCode(0x2014) + 'beta';
  assert.deepEqual(scanText(line, 'spaced'), []);
  assert.deepEqual(scanText(line, 'unspaced'), []);
});
