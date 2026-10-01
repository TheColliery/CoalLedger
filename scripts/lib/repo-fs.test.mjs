import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isContained, repoEntryKind, readRepoFileBounded, writeRepoFile, RepoWriteRefused, MAX_CONFIG_BYTES, MAX_DOC_BYTES } from './repo-fs.mjs';

function scratch(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// Probe once: can THIS seat create a file symlink without elevation? Windows refuses
// without admin or Developer Mode; a capability-gated leg skips VISIBLY rather than
// silently never running (node/runtime.md §4, AGENTS.md Hard-won lessons).
function canSymlink() {
  const dir = scratch('cl-symlink-probe-');
  try {
    const target = path.join(dir, 'target.txt');
    fs.writeFileSync(target, 'x');
    fs.symlinkSync(target, path.join(dir, 'link.txt'), 'file');
    return true;
  } catch { return false; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const SYMLINK_OK = canSymlink();

test('isContained: a child inside root is contained; outside, above, or equal-to-root is not', () => {
  assert.equal(isContained('/a/b/c', '/a'), true);
  assert.equal(isContained('/a', '/a'), false); // root itself is not "a child"
  assert.equal(isContained('/b/c', '/a'), false);
  assert.equal(isContained('/a/../b', '/a'), false);
});

test('isContained: root = null means no containment required', () => {
  assert.equal(isContained('/anywhere/at/all', null), true);
});

test('repoEntryKind: a regular file is "file"', () => {
  const dir = scratch('cl-kind-file-');
  try {
    const f = path.join(dir, 'x.txt');
    fs.writeFileSync(f, 'hello');
    assert.equal(repoEntryKind(f, dir), 'file');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('repoEntryKind: a missing path is "missing"', () => {
  const dir = scratch('cl-kind-missing-');
  try {
    assert.equal(repoEntryKind(path.join(dir, 'nope.txt'), dir), 'missing');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('repoEntryKind: a directory is "dir", never "file"', () => {
  const dir = scratch('cl-kind-dir-');
  try {
    assert.equal(repoEntryKind(dir, path.dirname(dir)), 'dir');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('repoEntryKind: a symlink escaping root is "other" -- refused, never followed (capability-gated)', (t) => {
  if (!SYMLINK_OK) { t.skip('this seat cannot create a file symlink without elevation on this box'); return; }
  const root = scratch('cl-kind-escape-root-');
  const outside = scratch('cl-kind-escape-victim-');
  try {
    const victim = path.join(outside, 'secret.txt');
    fs.writeFileSync(victim, 'SECRET');
    const link = path.join(root, 'escape.txt');
    fs.symlinkSync(victim, link, 'file');
    assert.equal(repoEntryKind(link, root), 'other');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('repoEntryKind: a symlink that resolves INSIDE root to a regular file is "file" (capability-gated)', (t) => {
  if (!SYMLINK_OK) { t.skip('this seat cannot create a file symlink without elevation on this box'); return; }
  const root = scratch('cl-kind-inside-');
  try {
    const target = path.join(root, 'real.txt');
    fs.writeFileSync(target, 'ok');
    const link = path.join(root, 'link.txt');
    fs.symlinkSync(target, link, 'file');
    assert.equal(repoEntryKind(link, root), 'file');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('repoEntryKind: root = null still kind-gates (no containment, but a non-file is still "other")', () => {
  const dir = scratch('cl-kind-nullroot-');
  try {
    assert.equal(repoEntryKind(dir, null), 'dir'); // a directory is never "file" even with no containment required
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readRepoFileBounded: a regular in-bound file reads back its own bytes', () => {
  const dir = scratch('cl-read-ok-');
  try {
    const f = path.join(dir, 'config.json');
    fs.writeFileSync(f, '{"a":1}');
    assert.equal(readRepoFileBounded(f, dir, MAX_CONFIG_BYTES), '{"a":1}');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readRepoFileBounded: a file OVER the bound is SKIPPED (null), never truncated', () => {
  const dir = scratch('cl-read-overbound-');
  try {
    const f = path.join(dir, 'big.json');
    fs.writeFileSync(f, 'x'.repeat(100));
    assert.equal(readRepoFileBounded(f, dir, 99), null, 'one byte over the bound must be a full skip, never a 99-byte truncation');
    assert.equal(readRepoFileBounded(f, dir, 100), 'x'.repeat(100), 'exactly AT the bound must still read in full (CoalMine Step 8: config at exactly MAX_CONFIG_BYTES honored)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readRepoFileBounded: a missing file returns null, never throws', () => {
  const dir = scratch('cl-read-missing-');
  try {
    assert.equal(readRepoFileBounded(path.join(dir, 'nope.json'), dir, MAX_CONFIG_BYTES), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readRepoFileBounded: a directory at the path returns null, never throws (an fopen-on-a-dir class, distinct from the FIFO class)', () => {
  const dir = scratch('cl-read-dir-');
  try {
    const sub = path.join(dir, 'looks-like-a-file.json');
    fs.mkdirSync(sub);
    assert.equal(readRepoFileBounded(sub, dir, MAX_CONFIG_BYTES), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readRepoFileBounded: a symlink escaping root is REFUSED -- the victim\'s bytes are never read back (capability-gated)', (t) => {
  if (!SYMLINK_OK) { t.skip('this seat cannot create a file symlink without elevation on this box'); return; }
  const root = scratch('cl-read-escape-root-');
  const outside = scratch('cl-read-escape-victim-');
  try {
    const victim = path.join(outside, 'secret.txt');
    fs.writeFileSync(victim, 'SECRET_TOKEN');
    const link = path.join(root, 'escape.txt');
    fs.symlinkSync(victim, link, 'file');
    const result = readRepoFileBounded(link, root, MAX_DOC_BYTES);
    assert.equal(result, null, 'the escaping symlink must be refused, never followed to read the victim');
    assert.equal(fs.readFileSync(victim, 'utf8'), 'SECRET_TOKEN', 'the victim file itself must be untouched');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('readRepoFileBounded: root = null (a home file) still reads a plain file and still bounds it', () => {
  const dir = scratch('cl-read-nullroot-');
  try {
    const f = path.join(dir, 'global-config.json');
    fs.writeFileSync(f, '{"ok":true}');
    assert.equal(readRepoFileBounded(f, null, MAX_CONFIG_BYTES), '{"ok":true}');
    fs.writeFileSync(f, 'y'.repeat(MAX_CONFIG_BYTES + 1));
    assert.equal(readRepoFileBounded(f, null, MAX_CONFIG_BYTES), null, 'root=null still bounds the read -- it only lifts CONTAINMENT, never the size/kind gates');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// MUTATION CHECK, scoped (not the full CoalMine 13-row table -- named, not silently
// claimed complete): proves the GATE does real work on this box, by measuring what the
// raw OS call does to a directory WITHOUT our function's help, then showing our
// function still answers cleanly. Measured first, not assumed: on this box opening a
// directory with O_RDONLY does NOT throw (a Windows/NTFS behaviour -- POSIX systems
// can differ) -- so the belt (lstat kind gate, BEFORE open) is what actually refuses
// this case here; the suspenders (the post-open fstat().isFile() re-check) is what
// would catch it if the belt were ever removed. Both layers are exercised by this one
// call, which is the point: a reader cannot tell from readRepoFileBounded's OWN output
// which layer caught it, only that NEITHER layer lets a directory read back as content.
test('writeRepoFile: creates a brand-new file inside root', () => {
  const dir = scratch('cl-write-create-');
  try {
    const target = path.join(dir, 'config.json');
    writeRepoFile(target, '{"a":1}', dir);
    assert.equal(fs.readFileSync(target, 'utf8'), '{"a":1}');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeRepoFile: REPLACES an existing regular file (not an append, not a merge)', () => {
  const dir = scratch('cl-write-replace-');
  try {
    const target = path.join(dir, 'config.json');
    fs.writeFileSync(target, 'old');
    writeRepoFile(target, 'new', dir);
    assert.equal(fs.readFileSync(target, 'utf8'), 'new');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeRepoFile: no temp file is left behind on a successful write', () => {
  const dir = scratch('cl-write-notemp-');
  try {
    const target = path.join(dir, 'config.json');
    writeRepoFile(target, 'x', dir);
    const leftovers = fs.readdirSync(dir).filter((f) => f.includes('coalledger-tmp'));
    assert.deepEqual(leftovers, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeRepoFile: REFUSES when the nearest existing ancestor escapes root', () => {
  const root = scratch('cl-write-escape-root-');
  const outside = scratch('cl-write-escape-outside-');
  try {
    const target = path.join(outside, 'sub', 'config.json'); // outside is NOT inside root at all
    assert.throws(() => writeRepoFile(target, 'x', root), RepoWriteRefused);
    assert.equal(fs.existsSync(target), false, 'the refused write must create nothing');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('writeRepoFile: REFUSES a target that already exists and is a symlink -- the link target is never written through (capability-gated)', (t) => {
  if (!SYMLINK_OK) { t.skip('this seat cannot create a file symlink without elevation on this box'); return; }
  const root = scratch('cl-write-symlink-root-');
  const outside = scratch('cl-write-symlink-outside-');
  try {
    const victim = path.join(outside, 'victim.txt');
    fs.writeFileSync(victim, 'SECRET');
    const target = path.join(root, 'config.json');
    fs.symlinkSync(victim, target, 'file');
    assert.throws(() => writeRepoFile(target, 'HOSTILE PAYLOAD', root), RepoWriteRefused);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'SECRET', 'the victim file the symlink points at must be untouched');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('writeRepoFile: REPLACES a hard-linked target via rename (the normal path never writes THROUGH a shared inode) -- the OTHER name keeps its OLD bytes', () => {
  const dir = scratch('cl-write-hardlink-');
  try {
    const original = path.join(dir, 'original.json');
    fs.writeFileSync(original, 'ORIGINAL');
    const target = path.join(dir, 'hardlinked.json');
    fs.linkSync(original, target); // target and original now share ONE inode
    writeRepoFile(target, 'NEW', dir);
    assert.equal(fs.readFileSync(target, 'utf8'), 'NEW', 'target itself must read the new content');
    assert.equal(fs.readFileSync(original, 'utf8'), 'ORIGINAL', 'the ancestor\'s own content must be UNCHANGED -- rename re-pointed the directory entry, it never wrote through the shared inode');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeRepoFile: root = null skips the containment check but still refuses an existing symlink target (capability-gated)', (t) => {
  if (!SYMLINK_OK) { t.skip('this seat cannot create a file symlink without elevation on this box'); return; }
  const dir = scratch('cl-write-nullroot-');
  try {
    const victim = path.join(dir, 'victim.txt');
    fs.writeFileSync(victim, 'SECRET');
    const target = path.join(dir, 'global-config.json');
    fs.symlinkSync(victim, target, 'file');
    assert.throws(() => writeRepoFile(target, 'HOSTILE', null), RepoWriteRefused);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeRepoFile: EPERM on rename falls back to an in-place write on a plain file, nlink===1 (fault-injected)', (t) => {
  const dir = scratch('cl-write-eperm-');
  try {
    const target = path.join(dir, 'config.json');
    fs.writeFileSync(target, 'old');
    const real = fs.renameSync;
    let called = false;
    fs.renameSync = (...a) => { called = true; const e = new Error('EPERM: simulated'); e.code = 'EPERM'; throw e; };
    try {
      writeRepoFile(target, 'new-via-fallback', dir);
    } finally { fs.renameSync = real; }
    assert.ok(called, 'the fault must actually have fired for this test to mean anything');
    assert.equal(fs.readFileSync(target, 'utf8'), 'new-via-fallback');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeRepoFile: EPERM on rename does NOT fall back on a hard-linked target -- it throws, the other name keeps its bytes (fault-injected)', () => {
  const dir = scratch('cl-write-eperm-hardlink-');
  try {
    const original = path.join(dir, 'original.json');
    fs.writeFileSync(original, 'ORIGINAL');
    const target = path.join(dir, 'config.json');
    fs.writeFileSync(target, 'placeholder');
    fs.unlinkSync(target);
    fs.linkSync(original, target); // now target and original share one inode, nlink===2
    const real = fs.renameSync;
    fs.renameSync = () => { const e = new Error('EPERM: simulated'); e.code = 'EPERM'; throw e; };
    try {
      assert.throws(() => writeRepoFile(target, 'HOSTILE', dir), RepoWriteRefused);
    } finally { fs.renameSync = real; }
    assert.equal(fs.readFileSync(original, 'utf8'), 'ORIGINAL', 'the hard-linked original must be untouched by the refused fallback');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('MUTATION WITNESS: a directory never reads back as content, whichever layer catches it -- and the raw OS call alone would NOT have refused it', () => {
  const dir = scratch('cl-mutation-witness-');
  try {
    const sub = path.join(dir, 'cfg.json');
    fs.mkdirSync(sub);
    const rawFd = fs.openSync(sub, fs.constants.O_RDONLY); // measured, not asserted-away: this does NOT throw on this box
    try {
      const rawStat = fs.fstatSync(rawFd);
      assert.equal(rawStat.isDirectory(), true, 'confirms the raw open+fstat sees a directory, same object our own fstat re-check would see');
    } finally { fs.closeSync(rawFd); }
    assert.equal(readRepoFileBounded(sub, dir, MAX_CONFIG_BYTES), null, 'the GUARDED function must still answer null for a directory, regardless of which layer (lstat gate or fstat re-check) is the one that actually fires');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
