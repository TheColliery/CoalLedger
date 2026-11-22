// 29nx (T-82, candidate 5): a file link's identity is taken from the target the kind check resolved, never from a second stat of the name.
// The seam needs no symlink privilege: an lstat stub reports the entry as a link, and the FIRST realpath of the entry returns the target's
// path. Just after that realpath the entry's name is retargeted (unlink, then a hard link to another file). Before the fix the identity is
// the retargeted file's (a second resolution of the name after the check), so the swapped file is read. After the fix the open is refused
// (ECHANGED): the identity is the target the kind check judged, and the handle is not that file.
// Legs: INSIDE (the swapped file is inside the root), OUTSIDE (outside the root), CONTROL (no swap: the entry's own bytes), and REAL-LINK
// (a real symlink, INSIDE swap; skipped visibly where the account cannot make one). Temp roots are made, asserted and removed by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { readRepoFileOutcome } = await import(pathToFileURL(path.join(here, 'repo-fs.mjs')).href);
const TMP = fs.realpathSync.native(os.tmpdir());
const PREFIX = 'repofs-expected-';
const BOUND = 1024 * 1024;
const VICTIM = 'VICTIM\n';
const INSIDE = 'INSIDE-SWAP\n';
const OUTSIDE = 'OUTSIDE-SWAP\n';
// The outcome carries a bigint identity, which JSON.stringify refuses; a message must still print, never throw.
const show = (g) => JSON.stringify(g, (k, v) => (typeof v === 'bigint' ? v.toString() : v));

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(TMP, PREFIX));
  const real = fs.realpathSync.native(root);
  if (path.dirname(real) !== TMP) throw new Error(`refusing: ${real} is not directly under ${TMP}`);
  t.after(() => {
    if (path.dirname(real) === TMP && path.basename(real).startsWith(PREFIX)) fs.rmSync(real, { recursive: true, force: true });
  });
  const proj = path.join(real, 'proj');
  const outside = path.join(real, 'outside');
  fs.mkdirSync(proj);
  fs.mkdirSync(outside);
  const fx = {
    proj,
    entry: path.join(proj, 'coalmine.json'), // the name the reader is asked for
    target: path.join(proj, 'victim.json'), // what the entry resolves to; the same inode as the entry, so the control is one file
    inside: path.join(proj, 'inside.json'),
    outside: path.join(outside, 'secret.json'),
  };
  fs.writeFileSync(fx.entry, VICTIM);
  fs.linkSync(fx.entry, fx.target);
  fs.writeFileSync(fx.inside, INSIDE);
  fs.writeFileSync(fx.outside, OUTSIDE);
  return fx;
}

// Can this account make a hard link on this volume? (the name-swap shim; a file symlink needs a privilege some accounts lack)
function canHardLink(dir) {
  const a = path.join(dir, 'link-probe-a');
  const b = path.join(dir, 'link-probe-b');
  fs.writeFileSync(a, 'x');
  try { fs.linkSync(a, b); return true; } catch { return false; } finally {
    fs.rmSync(b, { force: true });
    fs.rmSync(a, { force: true });
  }
}

// Can this account make a file symlink? (capability probe: Windows refuses without elevation or Developer Mode)
function canSymlink(dir) {
  const a = path.join(dir, 'symlink-probe-a');
  const b = path.join(dir, 'symlink-probe-b');
  fs.writeFileSync(a, 'x');
  try { fs.symlinkSync(a, b, 'file'); return true; } catch { return false; } finally {
    fs.rmSync(b, { force: true });
    fs.rmSync(a, { force: true });
  }
}

// The fake link: ONE lstat stub (the entry reports a link) and ONE realpath stub (its first call returns the target's path, then the name is
// retargeted to `mode` 'inside' or 'outside'; 'none' is the control). Every stub is restored in finally.
function withFakeLink(fx, mode, body) {
  const realL = fs.lstatSync;
  const realR = fs.realpathSync.native;
  let retargeted = false;
  fs.lstatSync = function (q, ...rest) {
    const st = realL.call(this, q, ...rest);
    if (typeof q === 'string' && path.resolve(q) === path.resolve(fx.entry)) {
      return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { isSymbolicLink: () => true });
    }
    return st;
  };
  fs.realpathSync.native = function (q, ...rest) {
    if (!retargeted && typeof q === 'string' && path.resolve(q) === path.resolve(fx.entry)) {
      retargeted = true;
      if (mode !== 'none') {
        fs.unlinkSync(fx.entry);
        fs.linkSync(mode === 'inside' ? fx.inside : fx.outside, fx.entry);
      }
      return fx.target;
    }
    return realR.call(this, q, ...rest);
  };
  try { return body(); } finally {
    fs.lstatSync = realL;
    fs.realpathSync.native = realR;
  }
}

// The real link: the entry is a real symlink to the target. The FIRST realpath of the entry returns the target, then the link is replaced by one
// to `next` (the INSIDE file). Restored in finally.
function withRealLink(fx, next, body) {
  const realR = fs.realpathSync.native;
  let swapped = false;
  fs.realpathSync.native = function (q, ...rest) {
    const r = realR.call(this, q, ...rest);
    if (!swapped && typeof q === 'string' && path.resolve(q) === path.resolve(fx.entry)) {
      swapped = true;
      fs.unlinkSync(fx.entry);
      fs.symlinkSync(next, fx.entry, 'file');
    }
    return r;
  };
  try { return body(); } finally { fs.realpathSync.native = realR; }
}

test('a fake link whose name is retargeted INSIDE the root after the kind check is refused: the handle is not the file the check judged', (t) => {
  const fx = sandbox(t);
  if (!canHardLink(fx.proj)) { t.skip('this account cannot make a hard link (the name-swap shim): the inside swap is not reproduced here'); return; }
  const got = withFakeLink(fx, 'inside', () => readRepoFileOutcome(fx.entry, fx.proj, BOUND));
  assert.equal(got.status, 'refused', `a name swapped inside the root after the kind check must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('INSIDE'), `the swapped-in file's bytes came back: ${show(got)}`);
});

test('a fake link whose name is retargeted OUTSIDE the root after the kind check is refused, and no outside byte comes back', (t) => {
  const fx = sandbox(t);
  if (!canHardLink(fx.proj)) { t.skip('this account cannot make a hard link (the name-swap shim): the outside swap is not reproduced here'); return; }
  const got = withFakeLink(fx, 'outside', () => readRepoFileOutcome(fx.entry, fx.proj, BOUND));
  assert.equal(got.status, 'refused', `a name swapped outside the root after the kind check must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('OUTSIDE'), `the outside bytes came back: ${show(got)}`);
});

test('CONTROL: with no swap the entry reads its own bytes (the same leg passes before and after the fix)', (t) => {
  const fx = sandbox(t);
  if (!canHardLink(fx.proj)) { t.skip('this account cannot make a hard link: the control needs the same shape as the swap legs'); return; }
  const got = withFakeLink(fx, 'none', () => readRepoFileOutcome(fx.entry, fx.proj, BOUND));
  assert.equal(got.status, 'ok', `the control must read, got ${show(got)}`);
  assert.equal(got.text, VICTIM, `the control read the wrong bytes: ${show(got)}`);
});

test('REAL-LINK: a real symlink retargeted to an inside file after the kind check is refused (capability-gated; skipped visibly where a file symlink cannot be made)', (t) => {
  const fx = sandbox(t);
  if (!canSymlink(fx.proj)) { t.skip('this account cannot make a file symlink (capability probe): the real-link leg needs that privilege to run'); return; }
  fs.unlinkSync(fx.entry);
  fs.symlinkSync(fx.target, fx.entry, 'file');
  const got = withRealLink(fx, fx.inside, () => readRepoFileOutcome(fx.entry, fx.proj, BOUND));
  assert.equal(got.status, 'refused', `a real link retargeted inside the root after the kind check must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('INSIDE'), `the swapped-in file's bytes came back through the real link: ${show(got)}`);
});

// 29nx bounce 1 (T-88): a folder in the chain swapped for a link AFTER the chain walk, kept in place through the kind check and the open. The
// folder is the one a plain entry sits in. Windows: a junction; POSIX: a directory symlink. Each leg skips visibly where the account cannot make one.
const DOCS_INSIDE = 'DOCS-INSIDE\n';
const LINK_KIND = process.platform === 'win32' ? 'junction' : 'dir';

// proj/docs/x.md is the plain entry; outside/x.md holds the victim bytes. The entry's folder is proj/docs.
function folderFixture(t) {
  const root = fs.mkdtempSync(path.join(TMP, PREFIX));
  const real = fs.realpathSync.native(root);
  if (path.dirname(real) !== TMP) throw new Error(`refusing: ${real} is not directly under ${TMP}`);
  t.after(() => {
    if (path.dirname(real) === TMP && path.basename(real).startsWith(PREFIX)) fs.rmSync(real, { recursive: true, force: true });
  });
  const proj = path.join(real, 'proj');
  const outside = path.join(real, 'outside');
  fs.mkdirSync(path.join(proj, 'docs'), { recursive: true });
  fs.mkdirSync(outside);
  const fx = { proj, outside, docs: path.join(proj, 'docs'), target: path.join(proj, 'docs', 'x.md') };
  fs.writeFileSync(fx.target, DOCS_INSIDE);
  fs.writeFileSync(path.join(outside, 'x.md'), VICTIM);
  return fx;
}

// Can this account make a folder link of the kind the swap uses? (probe in its own folder, removed by name)
function canFolderLink(dir) {
  const a = path.join(dir, 'folderlink-probe-target');
  const b = path.join(dir, 'folderlink-probe-link');
  fs.mkdirSync(a);
  try { fs.symlinkSync(a, b, LINK_KIND); return true; } catch { return false; } finally {
    try { fs.rmdirSync(b); } catch { /* the probe link may be absent */ }
    fs.rmdirSync(a);
  }
}

// The swap: docs is renamed aside and replaced by a link to outside. swapBack restores the real folder (the link is removed first).
function swapIn(fx) {
  fs.renameSync(fx.docs, path.join(fx.proj, 'docs-real'));
  fs.symlinkSync(fx.outside, fx.docs, LINK_KIND);
}
function swapBack(fx) {
  try { fs.rmdirSync(fx.docs); } catch { try { fs.unlinkSync(fx.docs); } catch { /* not a link: nothing to remove */ } }
  if (fs.existsSync(path.join(fx.proj, 'docs-real'))) fs.renameSync(path.join(fx.proj, 'docs-real'), fx.docs);
}

test('C4 (T-88): a folder swapped for a link after the chain walk, and kept there, is refused: the victim bytes do not come back', (t) => {
  const fx = folderFixture(t);
  if (!canFolderLink(fx.proj)) { t.skip(`this account cannot make a ${LINK_KIND} (capability probe): the one-swap leg needs it to run`); return; }
  const realR = fs.realpathSync.native;
  let fired = false;
  // The swap fires at the FIRST realpath of the entry, which judgeEntry takes after its chain walk.
  fs.realpathSync.native = function (p, ...rest) {
    if (!fired && typeof p === 'string' && path.resolve(p) === path.resolve(fx.target)) { fired = true; swapIn(fx); }
    return realR.call(fs.realpathSync, p, ...rest);
  };
  let got;
  try { got = readRepoFileOutcome(fx.target, fx.proj, BOUND); } finally {
    fs.realpathSync.native = realR;
    if (fired) swapBack(fx);
  }
  assert.equal(got.status, 'refused', `a folder swapped for a link after the chain walk must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('VICTIM'), `the victim bytes came back through the swapped folder: ${show(got)}`);
});

test('C2h (T-88, kept refused): a folder swapped in before the entry lstat, back at the chain lstat, and in again before the open is refused', (t) => {
  const fx = folderFixture(t);
  if (!canFolderLink(fx.proj)) { t.skip(`this account cannot make a ${LINK_KIND} (capability probe): the multi-swap leg needs it to run`); return; }
  const realL = fs.lstatSync;
  const realO = fs.openSync;
  let phase = 0;
  // phase 0 -> 1: the judgement's bigint lstat of the entry, with the folder swapped in before the stat runs.
  // phase 1 -> 2: the chain lstat of the folder, with the folder swapped back before the stat runs.
  // phase 2 -> 3: the open of the entry, with the folder swapped in again before the open runs.
  fs.lstatSync = function (p, o) {
    const a = typeof p === 'string' ? path.resolve(p) : '';
    if (phase === 0 && o && o.bigint && a === path.resolve(fx.target)) { swapIn(fx); phase = 1; }
    else if (phase === 1 && a === path.resolve(fx.docs)) { swapBack(fx); phase = 2; }
    return realL.call(fs, p, o);
  };
  fs.openSync = function (p, ...rest) {
    if (phase === 2 && typeof p === 'string' && path.resolve(p) === path.resolve(fx.target)) { swapIn(fx); phase = 3; }
    return realO.call(fs, p, ...rest);
  };
  let got;
  try { got = readRepoFileOutcome(fx.target, fx.proj, BOUND); } finally {
    fs.lstatSync = realL;
    fs.openSync = realO;
    if (phase >= 1) swapBack(fx);
  }
  assert.ok(phase >= 2, `the multi-swap did not reach its second swap (phase ${phase}): the leg proves nothing`);
  assert.equal(got.status, 'refused', `the multi-swap must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('VICTIM'), `the victim bytes came back through the multi-swap: ${show(got)}`);
});
