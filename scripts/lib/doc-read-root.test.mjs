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
import { SANDBOX_ENV } from '../test-sandbox.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MD_CHECKS = path.join(here, 'md-checks.mjs');
const MARK = 'OUTSIDE-ROOT-MARK';
const BODY = `# note\n\n${MARK} a — b\n\n${MARK}，한국어\n\nhttps://example.com/${MARK}\n`;
// a real doc with one known hit per reader: an unspaced em dash (emdash, spaced mode), a Han-comma-Han line (lang-mechanics zh-halfwidth-punct), a bare URL (md-checks bare-url)
const REAL = `# note\n\nalpha—beta\n\n你好,再见\n\nhttps://example.com/INSIDE\n`;
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
  fs.writeFileSync(path.join(repo, 'real', 'note.md'), REAL);
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

// the same real doc with no link made anywhere, so a control never skips.
function plainRepo(t) {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(TMP, 'cl-docroot-plain-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }));
  const repo = path.join(d, 'repo');
  fs.mkdirSync(path.join(repo, 'real'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'real', 'note.md'), REAL);
  return { repo, real: path.join(repo, 'real', 'note.md') };
}

function runMdChecks(args) {
  return spawnSync(process.execPath, ['--max-old-space-size=256', MD_CHECKS, ...args],
    { encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL', env: SANDBOX_ENV });
}

test('emdash scanFile refuses a doc reached through a folder link, with or without a root, and reads a real folder (capability-gated)', (t) => {
  const s = sandbox(t);
  if (!s.linked) { t.skip(SKIP); return; }
  assert.throws(() => scanFile(s.viaLink, 'spaced', s.repo), /refused/, 'a folder link inside the root is refused');
  assert.throws(() => scanFile(s.viaLink, 'spaced'), /refused/, 'with no root the filesystem root is pinned, so the link is refused');
  assert.equal(scanFile(s.realViaLinkedRepo, 'spaced', s.linkedRepo).length, 1, 'a root that is itself a link still reads its own docs: the one em dash is found');
});

test('lang-mechanics checkFile refuses a doc reached through a folder link, with or without a root, and reads a real folder (capability-gated)', (t) => {
  const s = sandbox(t);
  if (!s.linked) { t.skip(SKIP); return; }
  assert.throws(() => checkFile(s.viaLink, { root: s.repo }), /refused/, 'a folder link inside the root is refused');
  assert.throws(() => checkFile(s.viaLink), /refused/, 'with no root the filesystem root is pinned, so the link is refused');
  assert.ok(checkFile(s.realViaLinkedRepo, { root: s.linkedRepo }).some((f) => f.rule === 'zh-halfwidth-punct'), 'a root that is itself a link still reads its own docs: the Han comma is found');
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
  assert.ok(JSON.parse(ok.stdout)[0].findings.some((f) => f.check === 'bare-url'), 'the bare URL in the real doc is found');
});

// Control. Mutant run once by the coder (29x): scanFile returning [] after a successful read turns this red.
test('emdash scanFile reads a doc in a real folder under its root and finds its em dash', (t) => {
  const p = plainRepo(t);
  assert.equal(scanFile(p.real, 'spaced', p.repo).length, 1, 'the one unspaced em dash in the real doc is found');
});

// Control. Mutant run once by the coder (29x): checkFile returning [] after a successful read turns this red.
test('lang-mechanics checkFile reads a doc in a real folder under its root and finds its Han comma', (t) => {
  const p = plainRepo(t);
  assert.ok(checkFile(p.real, { root: p.repo }).some((f) => f.rule === 'zh-halfwidth-punct'), 'the half-width comma between Han characters is found');
});

// Control. Mutant run once by the coder (29x): the CLI using [] in place of checkDocument's findings turns this red.
test('md-checks CLI reads a doc in a real folder under its root and finds its bare URL', (t) => {
  const p = plainRepo(t);
  const r = runMdChecks(['--json', `--root=${p.repo}`, p.real]);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.ok(JSON.parse(r.stdout)[0].findings.some((f) => f.check === 'bare-url'), 'the bare URL in the real doc is found');
});

// 29ph (T-107): a cross-file anchor target is read, and its existence checked, only under the run's root. A target that
// leaves the root by a `..` path, a folder link or a file link is never read: it gives no finding, and its bytes never
// reach the result. Each leg makes its own fixture under the OS temp folder, asserted and removed by the test, and runs
// the md-checks CLI with --root=<the project folder>, the way the skills run it.
const OUTSIDE_HEADING = '# Top Secret\n';
const SKIP_LINK = 'this volume cannot make the link (probe: symlinkSync failed)';
function linkWorld(t) {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(TMP, 'cl-29ph-')));
  if (path.dirname(d) !== TMP || !path.basename(d).startsWith('cl-29ph-')) throw new Error(`refusing temp root ${d}`);
  t.after(() => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }));
  const outside = path.join(d, 'outside');
  const repo = path.join(d, 'repo');
  const docs = path.join(repo, 'docs');
  fs.mkdirSync(outside);
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.md'), OUTSIDE_HEADING);
  return { outside, repo, docs };
}
function findingsOf(r) {
  assert.equal(r.status, 0, `exit 0; stderr: ${r.stderr}`);
  return JSON.parse(r.stdout)[0].findings;
}

test('29ph P: a cross-file link that climbs out of the run root with `..` is not read (no finding, no outside heading)', (t) => {
  const w = linkWorld(t);
  const doc = path.join(w.docs, 'doc.md');
  fs.writeFileSync(doc, '# Doc\n\n[a](../../outside/secret.md#top-secret) [b](../../outside/secret.md#nope)\n');
  assert.deepEqual(findingsOf(runMdChecks(['--json', `--root=${w.repo}`, doc])), [], 'the outside file is not read: its heading does not answer #top-secret and #nope is not reported missing');
});

test('29ph J: a cross-file link through a folder link to outside the root is not read (capability-gated)', (t) => {
  const w = linkWorld(t);
  try { fs.symlinkSync(w.outside, path.join(w.docs, 'sub'), 'junction'); } catch { t.skip(SKIP_LINK); return; }
  const doc = path.join(w.docs, 'doc.md');
  fs.writeFileSync(doc, '# Doc\n\n[b](sub/secret.md#nope)\n');
  assert.deepEqual(findingsOf(runMdChecks(['--json', `--root=${w.repo}`, doc])), [], 'a target reached through a folder link that leaves the root is not read: #nope is not reported missing');
});

test('29ph F: a cross-file link through a file link to outside the root is not read (capability-gated)', (t) => {
  const w = linkWorld(t);
  try { fs.symlinkSync(path.join(w.outside, 'secret.md'), path.join(w.docs, 'link.md'), 'file'); } catch { t.skip(SKIP_LINK); return; }
  const doc = path.join(w.docs, 'doc.md');
  fs.writeFileSync(doc, '# Doc\n\n[b](link.md#nope)\n');
  assert.deepEqual(findingsOf(runMdChecks(['--json', `--root=${w.repo}`, doc])), [], 'a file link that leaves the root is not read: #nope is not reported missing');
});

// Control: an inside target still resolves, and an inside missing file is still reported. Green before the fix, and must stay green.
test('29ph IN: a cross-file link inside the run root still finds its anchor and reports a missing inside file', (t) => {
  const w = linkWorld(t);
  fs.writeFileSync(path.join(w.docs, 'real.md'), '# Here\n');
  const doc = path.join(w.docs, 'doc.md');
  fs.writeFileSync(doc, '# Doc\n\n[ok](./real.md#here) [bad](./real.md#nope) [gone](./missing.md)\n');
  const f = findingsOf(runMdChecks(['--json', `--root=${w.repo}`, doc]));
  assert.deepEqual(f.map((x) => x.check).sort(), ['anchor-missing', 'file-missing'], 'the inside anchor resolves; the missing anchor and the missing file are each reported');
  assert.ok(f.some((x) => x.check === 'anchor-missing' && x.message.includes('#nope')), 'the missing inside anchor is named');
  assert.ok(f.some((x) => x.check === 'file-missing' && x.message.includes('missing.md')), 'the missing inside file is named');
});
