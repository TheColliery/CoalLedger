// The room half of the git-spawn census (09a commit B): the canon census and its witness corpus are adopted by blob id (git-env-census.mjs / .test.mjs / .vectors.mjs);
// this file holds what is THIS ROOM's: its pins, and the proof that its real scripts/ tree reads clean under them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanGitSpawns, collectScriptsMjs, gitBlobId } from './git-env-census.mjs';
import { ROOM_GIT_ENV_PINS } from './git-env-pins.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => ({ rel, text: fs.readFileSync(path.join(repo, rel), 'utf8') });

test('this room\'s real scripts/ tree reads clean under its pins, every pin matched its live file, and the census saw the git spawns (non-vacuity)', () => {
  const files = collectScriptsMjs(repo);
  const r = scanGitSpawns(files, ROOM_GIT_ENV_PINS);
  assert.deepEqual(r.findings, []);
  assert.equal(r.exempted, ROOM_GIT_ENV_PINS.length, 'a pin that matches no live file (a stale blob) hides nothing and must be removed or re-measured');
  assert.ok(r.calls >= 10 && r.safe >= 10, `the census counted ${r.calls} git spawns (${r.safe} safe); a tree walk that sees almost none is a broken walk, not a clean tree`);
});

test('every pin is NEEDED: with the pin out, the census refuses exactly that file (a pin that hides nothing is a stale pin)', () => {
  assert.ok(ROOM_GIT_ENV_PINS.length >= 1);
  for (const pin of ROOM_GIT_ENV_PINS) {
    assert.ok(pin.why && pin.why.length > 40, `${pin.rel} carries its reason`);
    const f = read(pin.rel);
    assert.equal(gitBlobId(f.text), pin.blob, `${pin.rel} changed: re-measure the pin (its findings, its reason) before updating the blob`);
    const bare = scanGitSpawns([f], []);
    assert.ok(bare.findings.length >= 1, `${pin.rel} reads clean without its pin: remove the pin`);
    assert.ok(bare.findings.every((x) => x.startsWith(`${pin.rel}:`)));
  }
});

test('pins are blob-bound: one edited byte spends the pin, and a pin names its file', () => {
  const pin = ROOM_GIT_ENV_PINS[0];
  const f = read(pin.rel);
  assert.deepEqual(scanGitSpawns([f], [pin]).findings, []);
  assert.ok(scanGitSpawns([{ rel: pin.rel, text: `${f.text}\n// edited\n` }], [pin]).findings.length >= 1);
  assert.ok(scanGitSpawns([f], [{ ...pin, rel: 'scripts/other.mjs' }]).findings.length >= 1);
});

test('the files that left the pin list read clean with NO pin: the canon secret-gate.test.mjs (rewritten to named keys, 2f066650), verify.mjs and verify.test.mjs (fixed room-side), and the canon release-notes pair', () => {
  for (const rel of ['scripts/secret-gate.test.mjs', 'scripts/verify.mjs', 'scripts/verify.test.mjs', 'scripts/release-notes.mjs', 'scripts/release-notes.test.mjs']) {
    const f = read(rel);
    const r = scanGitSpawns([f], []);
    assert.deepEqual(r.findings, [], `${rel} is refused now`);
  }
  assert.equal(gitBlobId(read('scripts/secret-gate.test.mjs').text), '2f066650926ac6b8bc161bdcf069fd741a241a24');
  assert.ok(gitBlobId(read('scripts/release-notes.mjs').text).startsWith('f8d998d8'));
  assert.ok(gitBlobId(read('scripts/release-notes.test.mjs').text).startsWith('7e779ef8'));
});
