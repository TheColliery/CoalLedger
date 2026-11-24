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

// 29pl bounce 1 (T-107, the existence oracle). A path OUTSIDE the run's root must give the same output whether it exists or
// not: a caller may not learn from md-checks that an outside path is there. Each leg runs one world twice, with the outside
// file present and then removed, so every absolute path in both runs is identical. Capability-gated where a junction cannot be made.
const OUTSIDE_LINKS_DOTDOT = '# Doc\n\n[a](../../outside/secret.md#top-secret) [b](../../outside/secret.md#nope)\n';
const OUTSIDE_LINKS_JUNCTION = '# Doc\n\n[a](sub/secret.md#top-secret) [b](sub/secret.md#nope)\n';
const SKIP_JUNCTION = 'this volume cannot make a folder junction (probe: symlinkSync with junction failed)';
function oracleWorld(t, { junction }) {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(TMP, 'cl-29pl-')));
  if (path.dirname(d) !== TMP || !path.basename(d).startsWith('cl-29pl-')) throw new Error(`refusing temp root ${d}`);
  t.after(() => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }));
  const outside = path.join(d, 'outside');
  const repo = path.join(d, 'repo');
  const docs = path.join(repo, 'docs');
  fs.mkdirSync(outside);
  fs.mkdirSync(docs, { recursive: true });
  if (junction) fs.symlinkSync(outside, path.join(docs, 'sub'), 'junction'); // throws where a junction cannot be made: the caller skips
  return { repo, docs, target: path.join(outside, 'secret.md') };
}
function runCliIn(cwd, args) {
  return spawnSync(process.execPath, ['--max-old-space-size=256', MD_CHECKS, ...args],
    { encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL', cwd, env: SANDBOX_ENV });
}
function presentThenAbsent(w, argv) {
  fs.writeFileSync(w.target, OUTSIDE_HEADING);
  const present = runCliIn(w.repo, argv);
  fs.rmSync(w.target);
  const absent = runCliIn(w.repo, argv);
  return { present, absent };
}
function sameOutput(a, b) {
  assert.equal(a.status, b.status, 'the same exit code');
  assert.equal(a.stdout, b.stdout, 'the same stdout');
  assert.equal(a.stderr, b.stderr, 'the same stderr');
}

test('29pl P-EXIST: a `..` link to an outside path gives the same output whether that path exists or not', (t) => {
  const w = oracleWorld(t, { junction: false });
  fs.writeFileSync(path.join(w.docs, 'doc.md'), OUTSIDE_LINKS_DOTDOT);
  const { present, absent } = presentThenAbsent(w, ['--json', '--root=.', 'docs/doc.md']);
  assert.equal(present.status, 0, `exit 0; stderr: ${present.stderr}`);
  assert.deepEqual(JSON.parse(present.stdout)[0].findings, [], 'present: the outside file is not read or reported');
  assert.deepEqual(JSON.parse(absent.stdout)[0].findings, [], 'absent: no file-missing for the outside path (the oracle)');
  sameOutput(present, absent);
});

test('29pl J-EXIST: a link through a junction to an outside path gives the same output whether that path exists or not (capability-gated)', (t) => {
  let w;
  try { w = oracleWorld(t, { junction: true }); } catch { t.skip(SKIP_JUNCTION); return; }
  fs.writeFileSync(path.join(w.docs, 'doc.md'), OUTSIDE_LINKS_JUNCTION);
  const { present, absent } = presentThenAbsent(w, ['--json', '--root=.', 'docs/doc.md']);
  assert.equal(present.status, 0, `exit 0; stderr: ${present.stderr}`);
  assert.deepEqual(JSON.parse(present.stdout)[0].findings, [], 'present: the outside file is not read or reported');
  assert.deepEqual(JSON.parse(absent.stdout)[0].findings, [], 'absent: no file-missing through the junction (the oracle)');
  sameOutput(present, absent);
});

test('29pl NAMED-P: a named doc outside the root is refused the same way whether it exists or not', (t) => {
  const w = oracleWorld(t, { junction: false });
  const { present, absent } = presentThenAbsent(w, ['--root=.', '../outside/secret.md']);
  assert.equal(present.status, 1, `refused, exit 1; stdout: ${present.stdout}`);
  sameOutput(present, absent);
});

test('29pl NAMED-J: a named doc reached through a junction outside the root is refused the same way whether it exists or not (capability-gated)', (t) => {
  let w;
  try { w = oracleWorld(t, { junction: true }); } catch { t.skip(SKIP_JUNCTION); return; }
  const { present, absent } = presentThenAbsent(w, ['--root=.', 'docs/sub/secret.md']);
  assert.equal(present.status, 1, `refused, exit 1; stdout: ${present.stdout}`);
  sameOutput(present, absent);
});

// Control: a named doc missing INSIDE the root keeps its ENOENT answer; only outside paths lose it.
test('29pl CTRL-NAMED-IN: a named doc missing inside the root still reports ENOENT', (t) => {
  const w = oracleWorld(t, { junction: false });
  const r = runCliIn(w.repo, ['--root=.', 'docs/missing.md']);
  assert.equal(r.status, 1, `exit 1; stdout: ${r.stdout}`);
  assert.match(r.stderr, /ENOENT/, 'the inside missing doc is still named as absent');
});

// 29po bounce 2 (T-108, T-109, T-110, T-112): the shared reader answers 'missing' only inside the root, so no reader gives an
// existence answer for a path outside it. X1 and X2 are the two named-doc readers (emdash, lang-mechanics): the refusal text
// must be the same whether an outside doc exists or not, through `..` and through a junction. Capability-gated where a junction
// cannot be made.
function errorText(fn) { try { fn(); return 'no error'; } catch (e) { return e.message; } }
function presentThenAbsentFn(w, fn) {
  fs.writeFileSync(w.target, OUTSIDE_HEADING);
  const present = errorText(fn);
  fs.rmSync(w.target);
  const absent = errorText(fn);
  return { present, absent };
}

test('29po X1 emdash: a named doc outside the root is refused the same way whether it exists or not (`..` path)', (t) => {
  const w = oracleWorld(t, { junction: false });
  const doc = path.join(w.repo, 'docs', '..', '..', 'outside', 'secret.md');
  const { present, absent } = presentThenAbsentFn(w, () => scanFile(doc, 'spaced', w.repo));
  assert.notEqual(present, 'no error', 'present: refused, not read');
  assert.equal(absent, present, 'absent: the same refusal text, with no ENOENT for a path outside the root');
});

test('29po X1-J emdash: a named doc through a junction outside the root is refused the same way whether it exists or not (capability-gated)', (t) => {
  let w;
  try { w = oracleWorld(t, { junction: true }); } catch { t.skip(SKIP_JUNCTION); return; }
  const doc = path.join(w.docs, 'sub', 'secret.md');
  const { present, absent } = presentThenAbsentFn(w, () => scanFile(doc, 'spaced', w.repo));
  assert.notEqual(present, 'no error', 'present: refused, not read');
  assert.equal(absent, present, 'absent: the same refusal text through the junction');
});

test('29po X2 lang-mechanics: a named doc outside the root is refused the same way whether it exists or not (`..` path)', (t) => {
  const w = oracleWorld(t, { junction: false });
  const doc = path.join(w.repo, 'docs', '..', '..', 'outside', 'secret.md');
  const { present, absent } = presentThenAbsentFn(w, () => checkFile(doc, { root: w.repo }));
  assert.notEqual(present, 'no error', 'present: refused, not read');
  assert.equal(absent, present, 'absent: the same refusal text, with no ENOENT for a path outside the root');
});

test('29po X2-J lang-mechanics: a named doc through a junction outside the root is refused the same way whether it exists or not (capability-gated)', (t) => {
  let w;
  try { w = oracleWorld(t, { junction: true }); } catch { t.skip(SKIP_JUNCTION); return; }
  const doc = path.join(w.docs, 'sub', 'secret.md');
  const { present, absent } = presentThenAbsentFn(w, () => checkFile(doc, { root: w.repo }));
  assert.notEqual(present, 'no error', 'present: refused, not read');
  assert.equal(absent, present, 'absent: the same refusal text through the junction');
});

// T-112: a folder whose name starts with two dots (`..x`) is INSIDE the root. Its absent doc is named absent, and its absent link
// target is file-missing. A prefix test on the relative path reads it as outside, so both legs are red on 3a58d69.
test('29po T-112: a folder named `..x` inside the root is inside: its absent named doc is ENOENT and its absent link target is file-missing', (t) => {
  const w = oracleWorld(t, { junction: false });
  fs.mkdirSync(path.join(w.repo, '..x'));
  const named = runCliIn(w.repo, ['--root=.', '..x/missing.md']);
  assert.equal(named.status, 1, `exit 1; stdout: ${named.stdout}`);
  assert.match(named.stderr, /ENOENT/, 'a `..x` folder is inside the root: its absent doc is named absent');
  fs.writeFileSync(path.join(w.docs, 'doc.md'), '# Doc\n\n[m](../..x/missing.md)\n');
  const linked = findingsOf(runCliIn(w.repo, ['--json', '--root=.', 'docs/doc.md']));
  assert.ok(linked.some((x) => x.check === 'file-missing' && x.message.includes('missing.md')), 'a `..x` link target inside the root is checked and reported missing');
});
