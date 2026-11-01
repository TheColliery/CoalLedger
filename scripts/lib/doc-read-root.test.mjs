// T-17: the doc readers (emdash scanFile, lang-mechanics checkFile, the md-checks CLI) read a named doc under a
// literal root. A link at a folder between that root and the doc is refused, so no text from outside the root is
// returned or printed; a project folder that is itself a link still reads its own docs when it is passed as the root.
// Each test needs a folder link: a junction on Windows (no privilege), a directory symlink elsewhere; a volume that
// cannot make one skips the test visibly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanFile } from './emdash.mjs';
import { checkFile } from './lang-mechanics.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MD_CHECKS = path.join(here, 'md-checks.mjs');
const MARK = 'OUTSIDE-ROOT-MARK';
const BODY = `# note\n\n${MARK} a — b\n\n${MARK}，한국어\n\nhttps://example.com/${MARK}\n`;
const TMP = fs.realpathSync.native(os.tmpdir());

// repo/real/note.md is a real file; repo/docs is a folder link to outside/, which holds note.md with MARK in it;
// linkedRepo is a folder link to repo itself. `linked` is false when this volume cannot make a folder link.
function sandbox(t) {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(TMP, 'cl-docroot-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }));
  const outside = path.join(d, 'outside');
  const repo = path.join(d, 'repo');
  const linkedRepo = path.join(d, 'linkedRepo');
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(repo, 'real'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'note.md'), BODY);
  fs.writeFileSync(path.join(repo, 'real', 'note.md'), BODY.replaceAll(MARK, 'INSIDE'));
  let linked = true;
  try {
    fs.symlinkSync(outside, path.join(repo, 'docs'), 'junction');
    fs.symlinkSync(repo, linkedRepo, 'junction');
  } catch { linked = false; }
  return {
    repo, linkedRepo, linked,
    viaLink: path.join(repo, 'docs', 'note.md'),
    real: path.join(repo, 'real', 'note.md'),
    realViaLinkedRepo: path.join(linkedRepo, 'real', 'note.md'),
  };
}
const SKIP = 'this volume cannot make a folder link (probe: symlinkSync with junction failed)';

function runMdChecks(args) {
  return spawnSync(process.execPath, ['--max-old-space-size=256', MD_CHECKS, ...args],
    { encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL' });
}

test('emdash scanFile refuses a doc reached through a folder link, with or without a root, and reads a real folder (capability-gated)', (t) => {
  const s = sandbox(t);
  if (!s.linked) { t.skip(SKIP); return; }
  assert.throws(() => scanFile(s.viaLink, 'spaced', s.repo), /refused/, 'a folder link inside the root is refused');
  assert.throws(() => scanFile(s.viaLink, 'spaced'), /refused/, 'with no root the filesystem root is pinned, so the link is refused');
  assert.ok(Array.isArray(scanFile(s.real, 'spaced', s.repo)), 'a doc in a real folder under the root still reads');
  assert.ok(Array.isArray(scanFile(s.realViaLinkedRepo, 'spaced', s.linkedRepo)), 'a root that is itself a link still reads its own docs');
});

test('lang-mechanics checkFile refuses a doc reached through a folder link, with or without a root, and reads a real folder (capability-gated)', (t) => {
  const s = sandbox(t);
  if (!s.linked) { t.skip(SKIP); return; }
  assert.throws(() => checkFile(s.viaLink, { root: s.repo }), /refused/, 'a folder link inside the root is refused');
  assert.throws(() => checkFile(s.viaLink), /refused/, 'with no root the filesystem root is pinned, so the link is refused');
  assert.ok(Array.isArray(checkFile(s.real, { root: s.repo })), 'a doc in a real folder under the root still reads');
  assert.ok(Array.isArray(checkFile(s.realViaLinkedRepo, { root: s.linkedRepo })), 'a root that is itself a link still reads its own docs');
});

test('md-checks CLI refuses a doc reached through a folder link and prints none of its text; a linked root reads its own docs (capability-gated)', (t) => {
  const s = sandbox(t);
  if (!s.linked) { t.skip(SKIP); return; }
  for (const args of [[`--root=${s.repo}`, s.viaLink], [s.viaLink], [s.realViaLinkedRepo]]) {
    const r = runMdChecks(args);
    assert.equal(r.status, 1, `exit 1 for ${JSON.stringify(args)}; stdout: ${r.stdout}`);
    assert.match(r.stderr, /refused/, `names the refusal for ${JSON.stringify(args)}`);
    assert.equal((r.stdout + r.stderr).includes(MARK), false, `no text from outside the root for ${JSON.stringify(args)}`);
  }
  const ok = runMdChecks(['--json', `--root=${s.linkedRepo}`, s.realViaLinkedRepo]);
  assert.equal(ok.status, 0, `a root that is itself a link reads its own docs; stderr: ${ok.stderr}`);
  assert.equal(JSON.parse(ok.stdout).length, 1, 'one file in the JSON batch');
});
