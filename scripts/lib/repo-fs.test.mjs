import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isContained, repoEntryKind, readRepoFileBounded, writeRepoFile, RepoWriteRefused, MAX_CONFIG_BYTES, MAX_DOC_BYTES } from './repo-fs.mjs';

function scratch(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// For the child-process tests below (a `git`-independent child that imports this very
// module fresh, so a stub it installs cannot bleed into the parent's own test state).
const REPOFS_URL = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'repo-fs.mjs')).href;

// R12 bounce 1 F5: probe once, visibly skip where absent -- no FIFOs on Windows at all,
// and mkfifo may be missing even on a POSIX box.
function canMkfifo(dir) {
  if (process.platform === 'win32') return false;
  const probe = path.join(dir, '.cl-probe-fifo');
  const r = spawnSync('mkfifo', [probe], { timeout: 10_000 });
  if (r.status !== 0) return false;
  try { fs.unlinkSync(probe); } catch {}
  return true;
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

// R12 bounce 1 F2: a short read (the file shrank between fstat and the read loop) must be
// SKIPPED, never returned as a truncated prefix. Fault-injected because the race is not
// naturally deterministic -- the room already fault-injects fs.renameSync the same way.
test('readRepoFileBounded: a short read (fstat saw N bytes, the read loop got fewer) returns null, never a truncated prefix', () => {
  const dir = scratch('cl-read-short-');
  try {
    const f = path.join(dir, 'a.json');
    fs.writeFileSync(f, '{"coalledger":true}');
    const origRead = fs.readSync;
    let calls = 0;
    fs.readSync = (...a) => {
      calls += 1;
      if (calls === 1) { const n = origRead(...a); return Math.min(n, 5); } // under-report the first read
      return 0; // every further call reports EOF, so the loop cannot recover the rest
    };
    try {
      assert.equal(readRepoFileBounded(f, dir, MAX_CONFIG_BYTES), null, 'a short read must be a visible skip (null), never the 5-byte prefix it actually read');
    } finally { fs.readSync = origRead; }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// R12 bounce 1 F3, half 1: a stale/predictable temp from an earlier crashed run must refuse
// through this module's own RepoWriteRefused channel, never a raw node EEXIST.
test('writeRepoFile: REFUSES through RepoWriteRefused when a leftover temp file blocks the write, and the real target is untouched', () => {
  const dir = scratch('cl-write-staletemp-');
  try {
    const target = path.join(dir, 'config.json');
    fs.writeFileSync(target, 'OLD');
    const temp = `${target}.coalledger-tmp-${process.pid}`;
    fs.writeFileSync(temp, 'stale leftover from a crashed earlier run');
    try {
      assert.throws(() => writeRepoFile(target, 'NEW', dir), (e) => e instanceof RepoWriteRefused && /leftover temp file/.test(e.message));
      assert.equal(fs.readFileSync(target, 'utf8'), 'OLD', 'a refused write must not touch the real target');
    } finally { try { fs.unlinkSync(temp); } catch {} }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// R12 bounce 1 F3, half 2: a throw from the write itself (ENOSPC, a full disk) must not
// leave the temp on disk -- Phoenix #1, zero garbage, on the failure path too.
test('writeRepoFile: a failed write (fault-injected) leaves NO temp file behind', () => {
  const dir = scratch('cl-write-failleak-');
  try {
    const target = path.join(dir, 'leak.json');
    const origWriteSync = fs.writeSync;
    fs.writeSync = () => { const e = new Error('ENOSPC: simulated'); e.code = 'ENOSPC'; throw e; };
    try {
      assert.throws(() => writeRepoFile(target, 'x', dir));
    } finally { fs.writeSync = origWriteSync; }
    const leftovers = fs.readdirSync(dir).filter((f) => f.includes('coalledger-tmp'));
    assert.deepEqual(leftovers, [], 'a failed write must leave no temp file -- the leak this test would have caught before the fix');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// R12 bounce 1 F1: the exemplar's TWO mutation rows, ported. CoalMine 3cd7c4c itself:
// "R8 INSPECT MEDIUM-1 + LOW-1 -- pin O_NOFOLLOW, and O_NONBLOCK on the EPERM fallback".
// MEDIUM-1: the fallback must check the FD, not the path -- a link planted in the window
// right before the fallback's own open must never be followed. LOW-1: an O_WRONLY open of
// a FIFO planted in the same window must fail fast (ENXIO), never block on a reader that
// will never come.
test('writeRepoFile EPERM fallback: a link planted BEFORE the fallback opens (inside the refused rename) is never followed (capability-gated: O_NOFOLLOW + file-symlink privilege)', (t) => {
  if (!fs.constants.O_NOFOLLOW) { t.skip('no O_NOFOLLOW on this platform (the named Windows residual)'); return; }
  if (!SYMLINK_OK) { t.skip('this seat cannot create a file symlink without elevation on this box'); return; }
  const root = scratch('cl-wpre-');
  const outside = scratch('cl-wpre-out-');
  try {
    const victim = path.join(outside, 'bashrc');
    fs.writeFileSync(victim, 'export SECRET_TOKEN=abc123\n');
    const target = path.join(root, 'pre-commit');
    fs.writeFileSync(target, 'OLD');
    const orig = fs.renameSync;
    fs.renameSync = () => {
      fs.unlinkSync(target);
      fs.symlinkSync(victim, target, 'file');
      throw Object.assign(new Error('EPERM: simulated'), { code: 'EPERM' });
    };
    try {
      assert.throws(() => writeRepoFile(target, 'PWNED', root), RepoWriteRefused);
    } finally { fs.renameSync = orig; }
    assert.equal(fs.readFileSync(victim, 'utf8'), 'export SECRET_TOKEN=abc123\n', 'the victim behind the pre-planted link must keep its bytes');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

// R12 bounce 3 (CI, ubuntu + macos): this test's own expectation was wrong, not the code.
// It was ported from CoalMine's exemplar, which rethrows the ORIGINAL caught error `e`
// verbatim when the EPERM fallback's own open ALSO fails ("catch { throw e; }") -- but
// OUR port (bounce 1, F1) deliberately wraps THAT branch in this module's own
// RepoWriteRefused, for consistency with every OTHER refusal branch in writeRepoFile
// (the upfront symlink/other checks, the stale-temp EEXIST) -- all of which already throw
// RepoWriteRefused, never a raw node error. The FUNCTIONAL property under test (O_NONBLOCK
// makes the FIFO open fail fast -- ENXIO -- so the fallback refuses instead of hanging or
// writing) still holds; only the error SHAPE differs, and ours is the more actionable one
// (security.md's problem-report MUST) -- configure.mjs already branches on
// `instanceof RepoWriteRefused` for exactly this reason. Fixed in its own named step
// (testing.md's own rule): the test now checks for OUR module's actual contract.
test('writeRepoFile EPERM fallback: a FIFO planted before the fallback opens fails fast via RepoWriteRefused, never hangs, never writes (capability-gated: O_NONBLOCK + mkfifo, run in a child with a timeout)', (t) => {
  if (!fs.constants.O_NONBLOCK) { t.skip('no O_NONBLOCK on this platform'); return; }
  const root = scratch('cl-wfifo-');
  try {
    if (!canMkfifo(root)) { t.skip('mkfifo unavailable on this platform/volume'); return; }
    const target = path.join(root, 'pre-commit');
    fs.writeFileSync(target, 'OLD');
    const child = [
      "import fs from 'node:fs';",
      "import { spawnSync } from 'node:child_process';",
      "const { writeRepoFile, RepoWriteRefused } = await import(process.env.CL_REPOFS_URL);",
      "const target = process.env.CL_TARGET;",
      "fs.renameSync = () => {",
      "  fs.unlinkSync(target);",
      "  if (spawnSync('mkfifo', [target]).status !== 0) throw new Error('mkfifo failed');",
      "  throw Object.assign(new Error('EPERM: simulated'), { code: 'EPERM' });",
      "};",
      "try { writeRepoFile(target, 'NEW', process.env.CL_ROOT); console.log('wrote'); }",
      "catch (e) { console.log('threw ' + (e instanceof RepoWriteRefused ? 'RepoWriteRefused' : (e && e.code))); }",
    ].join('\n');
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', child], {
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, CL_REPOFS_URL: REPOFS_URL, CL_TARGET: target, CL_ROOT: root },
    });
    assert.equal(r.status, 0, `the child must exit cleanly, not time out -- a hang here IS the regression this test exists to catch (stderr: ${r.stderr})`);
    assert.match(r.stdout, /threw RepoWriteRefused/, 'O_NONBLOCK must make the FIFO open fail fast (ENXIO), so writeRepoFile refuses via its own RepoWriteRefused channel -- never a hang, never a write, never a raw node error');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// R12 bounce 1 F5: corrects the f411f33 commit message's "CI will exercise the FIFO case"
// claim by making it true -- no venue in this room exercised a real FIFO before this test.
test('repoEntryKind + readRepoFileBounded: a real FIFO is refused as "other", and the read never hangs on it (POSIX, capability-gated, run in a child with a timeout)', (t) => {
  const root = scratch('cl-realfifo-');
  try {
    if (!canMkfifo(root)) { t.skip('no mkfifo on this platform/volume'); return; }
    const fifo = path.join(root, 'AGENTS.md');
    assert.equal(spawnSync('mkfifo', [fifo], { timeout: 10_000 }).status, 0);
    const child = [
      "const { repoEntryKind, readRepoFileBounded, MAX_DOC_BYTES } = await import(process.env.CL_REPOFS_URL);",
      "const fifo = process.env.CL_FIFO;",
      "const root = process.env.CL_ROOT;",
      "const kind = repoEntryKind(fifo, root);",
      "const read = readRepoFileBounded(fifo, root, MAX_DOC_BYTES);",
      "console.log(JSON.stringify({ kind, read }));",
    ].join('\n');
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', child], {
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, CL_REPOFS_URL: REPOFS_URL, CL_FIFO: fifo, CL_ROOT: root },
    });
    assert.equal(r.status, 0, `the child must exit cleanly, not time out -- stderr: ${r.stderr}`);
    const { kind, read } = JSON.parse(r.stdout.trim());
    assert.equal(kind, 'other', 'a FIFO is neither a symlink, a directory, nor a regular file');
    assert.equal(read, null, 'the bounded read must refuse a FIFO, never block on it');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// R12 bounce 1 mutation table, M1: the table's own finding is that the ONLY test killing
// this mutant needs real file-symlink privilege (SYMLINK_OK), which this box lacks. This
// test kills it a SECOND way that needs no privilege at all: it stubs what lstatSync
// REPORTS about the target, which is all `writeRepoFile`'s guard ever consults -- it never
// re-derives "is this really a symlink" from anywhere else. Platform-independent.
test('MUTATION M1: writeRepoFile REFUSES when lstat reports the target as a symlink, even with no real symlink on disk (stubbed, no platform privilege needed)', () => {
  const dir = scratch('cl-m1-stub-');
  try {
    const target = path.join(dir, 'cfg.json');
    fs.writeFileSync(target, 'OLD');
    const origLstat = fs.lstatSync;
    fs.lstatSync = (p, ...rest) => {
      if (String(p) === target) return { isSymbolicLink: () => true, isFile: () => false };
      return origLstat(p, ...rest);
    };
    try {
      assert.throws(() => writeRepoFile(target, 'NEW', dir), RepoWriteRefused);
    } finally { fs.lstatSync = origLstat; }
    assert.equal(fs.readFileSync(target, 'utf8'), 'OLD', 'the real (non-symlink) file must be untouched -- the refusal fired on the stubbed lstat report alone');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// M5: repoEntryKind's non-dir branch must distinguish "file" from "other" (FIFO/socket/
// device) -- stubbed the same way as M1, so this box's lack of mkfifo capability (the real
// FIFO test above is capability-gated) does not leave this mutant un-killed here too.
test('MUTATION M5: repoEntryKind classifies a non-file, non-dir, non-symlink entry as "other", never "file" (stubbed, no platform privilege needed)', () => {
  const dir = scratch('cl-m5-stub-');
  try {
    const p = path.join(dir, 'AGENTS.md');
    fs.writeFileSync(p, '');
    const origLstat = fs.lstatSync;
    fs.lstatSync = (q, ...rest) => {
      if (String(q) === p) return { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => false };
      return origLstat(q, ...rest);
    };
    try {
      assert.equal(repoEntryKind(p, dir), 'other', 'a FIFO/socket/device entry must classify as "other", never "file"');
    } finally { fs.lstatSync = origLstat; }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// M6: needs no capability on any platform -- a directory at the write target is neither a
// symlink nor a regular file, so it must hit the SAME "exists and is not a regular file"
// refusal a FIFO would, real and unstubbed.
test('MUTATION M6: writeRepoFile REFUSES when a directory sits at the target path', () => {
  const dir = scratch('cl-m6-dir-');
  try {
    const target = path.join(dir, 'cfg.json');
    fs.mkdirSync(target);
    assert.throws(() => writeRepoFile(target, 'NEW', dir), RepoWriteRefused);
    assert.equal(fs.statSync(target).isDirectory(), true, 'the directory itself must be untouched -- still a directory, never replaced');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// M6, direct form -- measured, named honestly: the test above ALONE does not discriminate
// M6 on this box. Removing the existingKind==='other' refusal still ends in a thrown
// RepoWriteRefused here, because fs.renameSync(tempFile, aDirectory) happens to fail with
// EPERM on this Windows volume, which the fallback's OWN catch filter treats as "maybe
// recoverable" -- it then opens the directory (fails) and throws RepoWriteRefused for a
// DIFFERENT reason. The mutant is MASKED here, not killed (testing.md's own vocabulary);
// on POSIX, rename(2) over an existing directory fails EISDIR, which is outside that
// filter and would surface as a raw, un-refused error instead -- killed there directly
// (reasoned from POSIX rename(2) semantics, not run on this box: a DRY witness). This test
// discriminates the SPECIFIC line, on every platform, by proving the refusal fires BEFORE
// any rename is even attempted -- independent of whatever the fallback would do after.
test('MUTATION M6 (direct, platform-independent): the directory refusal fires BEFORE any rename is attempted', () => {
  const dir = scratch('cl-m6-direct-');
  try {
    const target = path.join(dir, 'cfg.json');
    fs.mkdirSync(target);
    const origRename = fs.renameSync;
    let renameCalled = false;
    fs.renameSync = (...a) => { renameCalled = true; return origRename(...a); };
    try {
      assert.throws(() => writeRepoFile(target, 'NEW', dir), RepoWriteRefused);
    } finally { fs.renameSync = origRename; }
    assert.equal(renameCalled, false, 'the refusal must fire before any rename is attempted -- proves THIS check caught it, not a platform-specific fallback side effect that happens to also refuse');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
