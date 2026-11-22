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
  // The hard link to the target is made by each test that needs it, AFTER its canHardLink probe (29of T-91): a volume without hard links skips visibly.
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
  fs.linkSync(fx.entry, fx.target);
  const got = withFakeLink(fx, 'inside', () => readRepoFileOutcome(fx.entry, fx.proj, BOUND));
  assert.equal(got.status, 'refused', `a name swapped inside the root after the kind check must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('INSIDE'), `the swapped-in file's bytes came back: ${show(got)}`);
});

test('a fake link whose name is retargeted OUTSIDE the root after the kind check is refused, and no outside byte comes back', (t) => {
  const fx = sandbox(t);
  if (!canHardLink(fx.proj)) { t.skip('this account cannot make a hard link (the name-swap shim): the outside swap is not reproduced here'); return; }
  fs.linkSync(fx.entry, fx.target);
  const got = withFakeLink(fx, 'outside', () => readRepoFileOutcome(fx.entry, fx.proj, BOUND));
  assert.equal(got.status, 'refused', `a name swapped outside the root after the kind check must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('OUTSIDE'), `the outside bytes came back: ${show(got)}`);
});

test('CONTROL: with no swap the entry reads its own bytes (the same leg passes before and after the fix)', (t) => {
  const fx = sandbox(t);
  if (!canHardLink(fx.proj)) { t.skip('this account cannot make a hard link: the control needs the same shape as the swap legs'); return; }
  fs.linkSync(fx.entry, fx.target);
  const got = withFakeLink(fx, 'none', () => readRepoFileOutcome(fx.entry, fx.proj, BOUND));
  assert.equal(got.status, 'ok', `the control must read, got ${show(got)}`);
  assert.equal(got.text, VICTIM, `the control read the wrong bytes: ${show(got)}`);
});

test('REAL-LINK: a real symlink retargeted to an inside file after the kind check is refused (capability-gated; skipped visibly where a file symlink cannot be made)', (t) => {
  const fx = sandbox(t);
  if (!canSymlink(fx.proj)) { t.skip('this account cannot make a file symlink (capability probe): the real-link leg needs that privilege to run'); return; }
  fs.linkSync(fx.entry, fx.target);
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

// ---- 29oc (T-92): the map's legs. A link's identity is the lstat of its resolved target, taken after that target's folder chain is walked again
// under the root. The fixture: docs/target.md and docs/sub/t.md (inside), docs2/target.md (another inside folder), outside/target.md and
// outside/sub/t.md (VICTIM). The hard-link form gives the fake-link seam its entry; the real-link form needs a file symlink (probed, skipped visibly).
const T92_INSIDE = 'INSIDE-T92\n';
const T92_INSIDE2 = 'INSIDE2-T92\n';

function t92Base(t) {
  const root = fs.mkdtempSync(path.join(TMP, PREFIX));
  const real = fs.realpathSync.native(root);
  if (path.dirname(real) !== TMP) throw new Error(`refusing: ${real} is not directly under ${TMP}`);
  t.after(() => {
    if (path.dirname(real) === TMP && path.basename(real).startsWith(PREFIX)) fs.rmSync(real, { recursive: true, force: true });
  });
  const proj = path.join(real, 'proj');
  const outside = path.join(real, 'outside');
  const fx = {
    proj, outside,
    docs: path.join(proj, 'docs'),
    docs2: path.join(proj, 'docs2'),
    sub: path.join(proj, 'docs', 'sub'),
    target: path.join(proj, 'docs', 'target.md'),
    link: path.join(proj, 'docs', 'link.md'),
    subTarget: path.join(proj, 'docs', 'sub', 't.md'),
    inside2: path.join(proj, 'docs2', 'target.md'),
    inside2Link: path.join(proj, 'docs2', 'link.md'),
    outDocs: outside,
    outTarget: path.join(outside, 'target.md'),
    outLink: path.join(outside, 'link.md'),
    outSub: path.join(outside, 'sub'),
    outSubTarget: path.join(outside, 'sub', 't.md'),
  };
  fs.mkdirSync(fx.sub, { recursive: true });
  fs.mkdirSync(fx.docs2);
  fs.mkdirSync(fx.outSub, { recursive: true });
  fs.writeFileSync(fx.target, T92_INSIDE);
  fs.writeFileSync(fx.subTarget, T92_INSIDE);
  fs.writeFileSync(fx.inside2, T92_INSIDE2);
  fs.writeFileSync(fx.outTarget, VICTIM);
  fs.writeFileSync(fx.outSubTarget, VICTIM);
  return fx;
}

// Hard-link form: the entry and the inside/outside names are one inode each, so an open by name reads the judged file.
function t92Hard(fx) {
  fs.linkSync(fx.target, fx.link);
  fs.linkSync(fx.inside2, fx.inside2Link);
  fs.linkSync(fx.outTarget, fx.outLink);
}

// Folder swap: `folder` is renamed aside and replaced by a link to `dest`; restoreFolder puts the real folder back (idempotent).
function swapFolder(folder, dest, aside) {
  fs.renameSync(folder, aside);
  fs.symlinkSync(dest, folder, LINK_KIND);
}
function restoreFolder(folder, aside) {
  try { fs.rmdirSync(folder); } catch { try { fs.unlinkSync(folder); } catch { /* not a link: nothing to remove */ } }
  if (fs.existsSync(aside)) fs.renameSync(aside, folder);
}

// Runs `action` right after the FIRST realpath of `watch` returns (judgeEntry's second resolution). With `stubs` ({ link, target }) the seam's
// lstat stub and entry realpath stub are installed too (the fake link). Every stub is restored in finally.
function withAfterRealpath(watch, action, stubs, body) {
  const realL = fs.lstatSync;
  const realR = fs.realpathSync.native;
  let fired = false;
  const w = path.resolve(watch);
  if (stubs) {
    fs.lstatSync = function (q, ...rest) {
      const st = realL.call(fs, q, ...rest);
      if (typeof q === 'string' && path.resolve(q) === path.resolve(stubs.link)) {
        return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { isSymbolicLink: () => true });
      }
      return st;
    };
  }
  fs.realpathSync.native = function (q, ...rest) {
    const a = typeof q === 'string' ? path.resolve(q) : '';
    if (stubs && a === path.resolve(stubs.link)) return stubs.target;
    const r = realR.call(fs.realpathSync, q, ...rest);
    if (!fired && a === w) { fired = true; action(); }
    return r;
  };
  try { return body(); } finally {
    fs.lstatSync = realL;
    fs.realpathSync.native = realR;
  }
}

// The fake target link: the target reports as a link at its first lstat (the stat the map's step 1 takes), and the entry is a fake link.
function withT92b(fx, body) {
  const realL = fs.lstatSync;
  const realR = fs.realpathSync.native;
  fs.lstatSync = function (q, ...rest) {
    const st = realL.call(fs, q, ...rest);
    const a = typeof q === 'string' ? path.resolve(q) : '';
    if (a === path.resolve(fx.link) || a === path.resolve(fx.target)) {
      // A link reports as a link only: not a file, not a folder (the stub must say what a real link's lstat says).
      return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { isSymbolicLink: () => true, isFile: () => false, isDirectory: () => false });
    }
    return st;
  };
  fs.realpathSync.native = function (q, ...rest) {
    if (typeof q === 'string' && path.resolve(q) === path.resolve(fx.link)) return fx.target;
    return realR.call(fs.realpathSync, q, ...rest);
  };
  try { return body(); } finally {
    fs.lstatSync = realL;
    fs.realpathSync.native = realR;
  }
}

// The privileged forms probe their capability and skip visibly where this account cannot make the link.
function canT92Real(fx) { return canSymlink(fx.proj) && canFolderLink(fx.proj); }

test('T-92a INSIDE: a folder swapped for a link to another folder inside the root, after the entry realpath(dirname), is refused (a link in the chain is refused wherever it points)', (t) => {
  const fx = t92Base(t);
  t92Hard(fx);
  if (!canFolderLink(fx.proj)) { t.skip(`this account cannot make a ${LINK_KIND} (capability probe): the folder-swap leg needs it to run`); return; }
  const aside = path.join(fx.proj, 'docs-real');
  let got;
  try {
    got = withAfterRealpath(fx.docs, () => swapFolder(fx.docs, fx.docs2, aside), { link: fx.link, target: fx.target },
      () => readRepoFileOutcome(fx.link, fx.proj, BOUND));
  } finally { restoreFolder(fx.docs, aside); }
  assert.equal(got.status, 'refused', `a folder swapped inside the root after the chain walk must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('INSIDE2'), `the swapped-in folder's bytes came back: ${show(got)}`);
});

test('T-92a OUTSIDE: a folder swapped for a link to an outside tree with the same names, after the entry realpath(dirname), is refused and no outside byte comes back', (t) => {
  const fx = t92Base(t);
  t92Hard(fx);
  if (!canFolderLink(fx.proj)) { t.skip(`this account cannot make a ${LINK_KIND} (capability probe): the folder-swap leg needs it to run`); return; }
  const aside = path.join(fx.proj, 'docs-real');
  let got;
  try {
    got = withAfterRealpath(fx.docs, () => swapFolder(fx.docs, fx.outDocs, aside), { link: fx.link, target: fx.target },
      () => readRepoFileOutcome(fx.link, fx.proj, BOUND));
  } finally { restoreFolder(fx.docs, aside); }
  assert.equal(got.status, 'refused', `a folder swapped outside the root after the chain walk must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('VICTIM'), `the outside bytes came back through the swapped folder: ${show(got)}`);
});

test('T-92a subfolder (real link): the target in docs/sub/t.md with sub swapped after the entry realpath(dirname) is refused by the re-walk under the root (capability-gated; skipped visibly here)', (t) => {
  const fx = t92Base(t);
  if (!canT92Real(fx)) { t.skip(`this account cannot make a file symlink and a ${LINK_KIND} (capability probe): the subfolder leg needs both`); return; }
  fs.symlinkSync(fx.subTarget, fx.link, 'file');
  const aside = path.join(fx.docs, 'sub-real');
  let got;
  try {
    got = withAfterRealpath(fx.docs, () => swapFolder(fx.sub, fx.outSub, aside), null,
      () => readRepoFileOutcome(fx.link, fx.proj, BOUND));
  } finally { restoreFolder(fx.sub, aside); }
  assert.equal(got.status, 'refused', `a subfolder of the entry's folder swapped after the realpath must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('VICTIM'), `the outside bytes came back through the subfolder: ${show(got)}`);
});

test('T-92b INSIDE: a resolved target that reports as a link at its first lstat is refused (the handle is never read through a link)', (t) => {
  const fx = t92Base(t);
  t92Hard(fx);
  const got = withT92b(fx, () => readRepoFileOutcome(fx.link, fx.proj, BOUND));
  assert.equal(got.status, 'refused', `a resolved target that is a link must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('INSIDE-T92'), `the target's bytes came back through the link: ${show(got)}`);
});

test('T-92b OUTSIDE: a resolved target that is an outside file and reports as a link at its first lstat is refused, and no outside byte comes back', (t) => {
  const fx = t92Base(t);
  fs.unlinkSync(fx.target);
  fs.linkSync(fx.outTarget, fx.target);
  t92Hard(fx);
  const got = withT92b(fx, () => readRepoFileOutcome(fx.link, fx.proj, BOUND));
  assert.equal(got.status, 'refused', `an outside resolved target reported as a link must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('VICTIM'), `the outside bytes came back through the resolved target: ${show(got)}`);
});

test('T-92 real link, parent swapped: a real in-folder file link whose folder is swapped after the entry realpath(dirname) is refused (capability-gated; skipped visibly here)', (t) => {
  const fx = t92Base(t);
  if (!canT92Real(fx)) { t.skip(`this account cannot make a file symlink and a ${LINK_KIND} (capability probe): the real-link leg needs both`); return; }
  fs.symlinkSync(fx.target, fx.link, 'file');
  fs.symlinkSync(fx.outTarget, fx.outLink, 'file');
  const aside = path.join(fx.proj, 'docs-real');
  let got;
  try {
    got = withAfterRealpath(fx.docs, () => swapFolder(fx.docs, fx.outDocs, aside), null,
      () => readRepoFileOutcome(fx.link, fx.proj, BOUND));
  } finally { restoreFolder(fx.docs, aside); }
  assert.equal(got.status, 'refused', `a real link whose folder is swapped after the realpath must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('VICTIM'), `the outside bytes came back through the real link: ${show(got)}`);
});

test('T-92 real link, leaf replaced: a real link whose target leaf becomes a symlink to an outside file after the entry realpath is refused (capability-gated; skipped visibly here)', (t) => {
  const fx = t92Base(t);
  if (!canSymlink(fx.proj)) { t.skip('this account cannot make a file symlink (capability probe): the leaf-replaced leg needs it to run'); return; }
  fs.symlinkSync(fx.target, fx.link, 'file');
  const got = withAfterRealpath(fx.link, () => {
    fs.unlinkSync(fx.target);
    fs.symlinkSync(fx.outTarget, fx.target, 'file');
  }, null, () => readRepoFileOutcome(fx.link, fx.proj, BOUND));
  assert.equal(got.status, 'refused', `a real link whose leaf became a link must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('VICTIM'), `the outside bytes came back through the replaced leaf: ${show(got)}`);
});

test('T-92 real link CONTROL: an unchanged in-folder file link reads its target bytes (capability-gated; skipped visibly here)', (t) => {
  const fx = t92Base(t);
  if (!canSymlink(fx.proj)) { t.skip('this account cannot make a file symlink (capability probe): the real-link control needs it to run'); return; }
  fs.symlinkSync(fx.target, fx.link, 'file');
  const got = readRepoFileOutcome(fx.link, fx.proj, BOUND);
  assert.equal(got.status, 'ok', `the unchanged real link must read, got ${show(got)}`);
  assert.equal(got.text, T92_INSIDE, `the unchanged real link read the wrong bytes: ${show(got)}`);
});

// ---- 29of (T-94, T-93, T-81): the placeholder seam of the repaired map (scratchpad/29of/map.md, section 5, modelled on map-run.mjs). The link
// is a placeholder FILE: the lstat stub reports it as a symlink (isFile false) while cur.isLink holds, and the realpath and open stubs follow
// cur.target. So a link replaced, retargeted or moved with its folder is modelled without the symlink privilege. Each swap is one hook at one call.
let of29Seq = 0;
function of29Write(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); }

function of29Fixture(t) {
  const root = fs.mkdtempSync(path.join(TMP, PREFIX));
  const real = fs.realpathSync.native(root);
  if (path.dirname(real) !== TMP) throw new Error(`refusing: ${real} is not directly under ${TMP}`);
  t.after(() => {
    if (path.dirname(real) === TMP && path.basename(real).startsWith(PREFIX)) fs.rmSync(real, { recursive: true, force: true });
  });
  const proj = path.join(real, 'proj');
  const docs = path.join(proj, 'docs');
  of29Write(path.join(docs, 'target.md'), 'INSIDE\n');
  of29Write(path.join(docs, 'target2.md'), 'OTHER\n');
  of29Write(path.join(docs, 'x.md'), 'INSIDE\n');
  of29Write(path.join(docs, 'sub', 't.md'), 'INSIDE\n');
  of29Write(path.join(docs, 'link.md'), 'PLACEHOLDER\n');
  return {
    proj, docs, sub: path.join(docs, 'sub'),
    link: path.join(docs, 'link.md'), target: path.join(docs, 'target.md'), target2: path.join(docs, 'target2.md'),
    subT: path.join(docs, 'sub', 't.md'), plain: path.join(docs, 'x.md'),
  };
}

// Another REAL folder at the same name: the same file names, other bytes, inside the root. The old folder is moved aside under a unique name.
function of29ReplaceFolder(dir, tag) {
  fs.renameSync(dir, `${dir}-old${of29Seq++}`);
  of29Write(path.join(dir, 'target.md'), `${tag}\n`);
  of29Write(path.join(dir, 'x.md'), `${tag}\n`);
  of29Write(path.join(dir, 't.md'), `${tag}\n`);
  of29Write(path.join(dir, 'link.md'), 'PLACEHOLDER2\n');
  of29Write(path.join(dir, 'sub', 't.md'), `${tag}\n`);
}

// A replaced regular file: the old one is RENAMED aside inside the root, not unlinked, so its inode stays allocated and no new file can take its number
// (ext4 reuses a freed inode number at once; NTFS and APFS do not). The aside file lives under the fixture root, removed with it.
function of29ReplaceFile(file, body) {
  fs.renameSync(file, `${file}-old${of29Seq++}`);
  of29Write(file, body);
}

// One swap, at one call. `row.before` fires before the call, `row.after` after it returns (the call's own result is taken first).
function runPlaceholder(read, fx, row) {
  const cur = { isLink: true, target: row.sub ? fx.subT : fx.target };
  const who = {
    link: fx.link, docs: fx.docs, proj: fx.proj,
    targetReal: fs.realpathSync.native(fx.target), subTReal: fs.realpathSync.native(fx.subT),
  };
  const realL = fs.lstatSync;
  const realR = fs.realpathSync.native;
  const realO = fs.openSync;
  let fired = false;
  let linkBigLstats = 0; // T-96: the entry's bigint lstats, counted so the nth one can be made to fail
  const fire = (spec, op, a, o) => {
    if (!spec || fired || spec.op !== op || who[spec.who] !== a) return;
    if (spec.big !== undefined && !!(o && o.bigint) !== spec.big) return;
    fired = true;
    spec.act(fx, cur);
  };
  const isFake = (a) => a === path.resolve(fx.link) && cur.isLink;
  fs.lstatSync = function (p, o) {
    const a = path.resolve(String(p));
    fire(row.before, 'lstat', a, o);
    if (row.failAt && isFake(a) && o && o.bigint && ++linkBigLstats === row.failAt.nth) {
      throw Object.assign(new Error(`${row.failAt.code}: lstat '${p}'`), { code: row.failAt.code });
    }
    const st = realL.call(fs, p, o);
    const res = isFake(a)
      ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, { isSymbolicLink: () => true, isFile: () => false })
      : st;
    fire(row.after, 'lstat', a, o);
    return res;
  };
  fs.realpathSync.native = function (p, ...rest) {
    const a = path.resolve(String(p));
    fire(row.before, 'rp', a);
    const res = isFake(a) ? realR.call(fs.realpathSync, cur.target, ...rest) : realR.call(fs.realpathSync, p, ...rest);
    fire(row.after, 'rp', a);
    return res;
  };
  fs.openSync = function (p, ...rest) {
    const a = path.resolve(String(p));
    fire(row.before, 'open', a);
    return isFake(a) ? realO.call(fs, cur.target, ...rest) : realO.call(fs, p, ...rest);
  };
  try {
    return read(fx.link, fx.proj, BOUND);
  } finally {
    fs.lstatSync = realL;
    fs.realpathSync.native = realR;
    fs.openSync = realO;
  }
}

// The seven legs of the map's section 5, in its order. Each swap is kept in place, and each must read on d174959 and be refused after the fix.
const OF29_LEGS = [
  {
    name: 'T-94 KT-R-g', swapped: 'REPLACED',
    row: { before: { op: 'lstat', who: 'targetReal', big: true, act: (fx) => of29ReplaceFile(fx.target, 'REPLACED\n') } },
  },
  {
    name: 'T-93 KTs-D-g (the subfolder, placeholder form)', swapped: 'NEWSUB',
    row: { sub: true, before: { op: 'lstat', who: 'subTReal', big: true, act: (fx) => of29ReplaceFolder(fx.sub, 'NEWSUB') } },
  },
  {
    name: 'KD-D-g', swapped: 'NEWDIR',
    row: { before: { op: 'lstat', who: 'targetReal', big: true, act: (fx) => of29ReplaceFolder(fx.docs, 'NEWDIR') } },
  },
  {
    name: 'KF-R-c', swapped: 'REPLACED',
    row: { after: { op: 'lstat', who: 'link', big: true, act: (fx, cur) => { of29ReplaceFile(fx.link, 'REPLACED\n'); cur.isLink = false; } } },
  },
  {
    name: 'KF-L-c', swapped: 'OTHER',
    row: { after: { op: 'lstat', who: 'link', big: true, act: (fx, cur) => { of29ReplaceFile(fx.link, 'PLACEHOLDER3\n'); cur.target = fx.target2; } } },
  },
  {
    name: 'KD-D-c', swapped: 'NEWDIR',
    row: { after: { op: 'lstat', who: 'link', big: true, act: (fx) => of29ReplaceFolder(fx.docs, 'NEWDIR') } },
  },
  {
    name: 'KD-D-e', swapped: 'NEWDIR',
    row: { after: { op: 'rp', who: 'link', act: (fx) => of29ReplaceFolder(fx.docs, 'NEWDIR') } },
  },
];
for (const leg of OF29_LEGS) {
  test(`${leg.name}: the swap lands in one gap of the reader's pass and the read is refused, no swapped byte returned`, (t) => {
    const fx = of29Fixture(t);
    const got = runPlaceholder(readRepoFileOutcome, fx, leg.row);
    assert.equal(got.status, 'refused', `${leg.name}: the swapped-in file must be refused, got ${show(got)}`);
    assert.ok(!(got.text ?? '').includes(leg.swapped), `${leg.name}: the swapped-in bytes came back: ${show(got)}`);
  });
}

// The kept legs: the CONTROL reads the target, and the two swaps at the open are refused on both sides of the fix (the window after the re-check is pinned).
test('CONTROL (placeholder): with no swap the placeholder link reads its target bytes, before and after the fix', (t) => {
  const fx = of29Fixture(t);
  const got = runPlaceholder(readRepoFileOutcome, fx, {});
  assert.equal(got.status, 'ok', `the control must read, got ${show(got)}`);
  assert.equal(got.text, 'INSIDE\n', `the control read the wrong bytes: ${show(got)}`);
});

test('KF-R-k (kept): the link replaced by a regular file just before the open is refused, the new file is not read', (t) => {
  const fx = of29Fixture(t);
  const got = runPlaceholder(readRepoFileOutcome, fx, {
    before: { op: 'open', who: 'link', act: (f, cur) => { of29ReplaceFile(f.link, 'REPLACED\n'); cur.isLink = false; } },
  });
  assert.equal(got.status, 'refused', `the replaced link must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('REPLACED'), `the replacement's bytes came back: ${show(got)}`);
});

test('KD-D-k (kept): the folder swapped for another real folder just before the open is refused, the new bytes are not read', (t) => {
  const fx = of29Fixture(t);
  const got = runPlaceholder(readRepoFileOutcome, fx, {
    before: { op: 'open', who: 'link', act: (f) => of29ReplaceFolder(f.docs, 'NEWDIR') },
  });
  assert.equal(got.status, 'refused', `the replaced folder must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('NEWDIR'), `the replacement folder's bytes came back: ${show(got)}`);
});

// T-93 (29of bounce 1): the target's subfolder is swapped for a junction right after the entry folder's realpath returns (gap e, kind L on the subfolder).
// HEAD's re-walk runs from the target's own folder and refuses the junction. A re-walk from the entry's folder would not see it, and the open would
// read the junction's bytes.
test('T-93 KTs-L-e (the subfolder swapped for a junction after realpath(dirname), placeholder form): the read is refused, no swapped byte returned', (t) => {
  const fx = of29Fixture(t);
  if (!canFolderLink(fx.proj)) { t.skip(`this account cannot make a ${LINK_KIND} (capability probe): the subfolder junction leg needs it to run`); return; }
  const got = runPlaceholder(readRepoFileOutcome, fx, {
    sub: true,
    after: {
      op: 'rp', who: 'docs',
      act: (f) => {
        fs.renameSync(f.sub, `${f.sub}-old${of29Seq++}`);
        of29Write(path.join(f.docs, 'sub-new', 't.md'), 'NEWSUB\n');
        fs.symlinkSync(path.join(f.docs, 'sub-new'), f.sub, LINK_KIND);
      },
    },
  });
  assert.equal(got.status, 'refused', `the junction-swapped subfolder must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('NEWSUB'), `the junction's bytes came back: ${show(got)}`);
});

// T-96 (29of bounce 1): the re-check is the entry's second bigint lstat. When that call throws, the read is refused and no byte of the target comes back.
test('T-96: the re-check\'s own lstat fails with EACCES and the read is refused, no bytes returned', (t) => {
  const fx = of29Fixture(t);
  const got = runPlaceholder(readRepoFileOutcome, fx, { failAt: { nth: 2, code: 'EACCES' } });
  assert.equal(got.status, 'refused', `a failing re-check must refuse, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('INSIDE'), `the target's bytes came back past a failing re-check: ${show(got)}`);
});

// T-97 (29of bounce 3): a PLAIN entry whose folder is swapped for a junction to an outside tree, right after the chain walk, is read from OUTSIDE the root
// wherever the identity measure is blind. Every bigint lstat, stat and fstat carries one ino (as the reviewer's reuse-witness.mjs does), so the dev/ino
// agreement and the compare both pass; only the containment check against the root can refuse. The escape check ran for links only.
test('T-97 P-OUT: a plain entry whose folder becomes a junction to an outside tree is refused even when every ino is equal, and no outside byte comes back', (t) => {
  const fx = of29Fixture(t);
  if (!canFolderLink(fx.proj)) { t.skip(`this account cannot make a ${LINK_KIND} (capability probe): the P-OUT leg needs it to run`); return; }
  const outside = path.join(path.dirname(fx.proj), 'outside');
  of29Write(path.join(outside, 'x.md'), 'VICTIM\n');
  const reuse = (st) => (st && typeof st.ino === 'bigint' ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, { ino: 7n }) : st);
  const realL = fs.lstatSync, realS = fs.statSync, realF = fs.fstatSync, realR = fs.realpathSync.native;
  let swapped = false;
  fs.lstatSync = function (p, o) { const st = realL.call(fs, p, o); return o && o.bigint ? reuse(st) : st; };
  fs.statSync = function (p, o) { const st = realS.call(fs, p, o); return o && o.bigint ? reuse(st) : st; };
  fs.fstatSync = function (fd, o) { const st = realF.call(fs, fd, o); return o && o.bigint ? reuse(st) : st; };
  fs.realpathSync.native = function (p, ...rest) {
    if (!swapped && path.resolve(String(p)) === path.resolve(fx.plain)) {
      swapped = true; // the first resolution of the entry, after the chain walk
      fs.renameSync(fx.docs, `${fx.docs}-real`);
      fs.symlinkSync(outside, fx.docs, LINK_KIND);
    }
    return realR.call(fs.realpathSync, p, ...rest);
  };
  let got;
  try { got = readRepoFileOutcome(fx.plain, fx.proj, BOUND); } finally {
    fs.lstatSync = realL; fs.statSync = realS; fs.fstatSync = realF; fs.realpathSync.native = realR;
  }
  assert.equal(got.status, 'refused', `a plain entry read through a junction to an outside tree must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('VICTIM'), `the outside bytes came back: ${show(got)}`);
});

// T-81: the reader's own lstat (no bigint) succeeds, then judgeEntry's bigint lstat throws EACCES. The read is refused with that code, phase
// inspect; it is never reported as absent (absent is the ENOENT answer only).
test('T-81: an lstat that fails with EACCES inside the judgement refuses the read with that code, phase inspect, never absent', (t) => {
  const fx = of29Fixture(t);
  const realL = fs.lstatSync;
  fs.lstatSync = function (p, o) {
    if (o && o.bigint && path.resolve(String(p)) === path.resolve(fx.plain)) {
      throw Object.assign(new Error(`EACCES: permission denied, lstat '${fx.plain}'`), { code: 'EACCES' });
    }
    return realL.call(fs, p, o);
  };
  let got;
  try { got = readRepoFileOutcome(fx.plain, fx.proj, BOUND); } finally { fs.lstatSync = realL; }
  assert.equal(got.status, 'refused', `an EACCES inside the judgement must refuse, got ${show(got)}`);
  assert.equal(got.code, 'EACCES', `the refusal must carry the lstat's code, got ${show(got)}`);
  assert.equal(got.phase, 'inspect', `the refusal must be phase inspect, got ${show(got)}`);
});
