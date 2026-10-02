// CWK-137 — bounded reads on repo-derived paths. Every Coal* skill runs its logic
// wherever the user invokes it, including a repo neither we nor the user fully trust
// (common/security.md, "the agent product's own adversary model"). A plain
// `fs.readFileSync(path)` on a path that came from the repo being scanned opens
// WHATEVER is at that path: a symlink to `/dev/zero` reads forever, a FIFO with no
// writer blocks forever, and a multi-GB file allocates the whole thing into memory. A
// docs-health tool exists specifically to be pointed at a cloned repo's docs, so this is
// not a hypothetical caller.
//
// Ported from CoalMine's scripts/lib/repo-fs.mjs (the exemplar this room's build order
// names; "FOR SIBLINGS TO MIRROR" at CoalMine a7f3925) -- the MECHANISM transfers
// (lstat kind gate BEFORE open, O_NONBLOCK open, fstat re-check, bound the read; a
// contained temp+rename write, with the Windows EPERM-rename-over-an-open-file
// fallback), the two size constants are re-measured on THIS room's own tree (Step 2 of
// the mirror sheet), never copied from CoalMine's numbers. CoalMine's
// `readRepoBytesBounded` / `prefixOnly` are NOT ported -- this room has no hashing
// caller that would need the lossless byte variant.
//
// CORRECTED mid-unit (self-caught, not assumed): an earlier header here claimed "this
// room's only write-through-a-repo-path surface is its own scratch state... there is no
// WRITE side to cure" -- FALSE. `scripts/configure.mjs` writes the project/global
// `.coalledger.json` BACK through `readPath`/`writePath`, a repo-derived (or home-file)
// target, via a plain `fs.writeFileSync` that FOLLOWS a symlink at the destination
// (node/runtime.md §5) -- a repo-planted symlink there would write arbitrary config JSON
// into whatever the link points at, the exact PoC-2 class CoalMine's own CWK-137 named.
import fs from 'node:fs';
import path from 'node:path';

// Step 2 of the mirror sheet, re-measured HERE: the largest JSONC config this room
// ships or documents is its own `.coalledger.json` template (a few KB); 1 MiB gives
// three orders of magnitude of headroom for a hand-edited config. The largest shipped
// doc this room has is this very MEMORY.md file (its own DECLARED CAP is 107,000
// characters, well under 1 MiB) -- 4 MiB gives similar headroom over any doc a user
// would plausibly hand this room to scan (re-derive: `node -e "console.log(Math.max(...
// require('fs').readdirSync('.').filter(f=>f.endsWith('.md')).map(f=>require('fs').statSync(f).size)))"`
// from the repo root, or just: this room's biggest tracked .md file is well under 1 MB).
export const MAX_CONFIG_BYTES = 1024 * 1024; // 1 MiB
export const MAX_DOC_BYTES = 4 * 1024 * 1024; // 4 MiB

// Is `child` inside `root` (both already resolved)? `root == null` means "no
// containment required" -- used for a user's OWN home files (the global config), which
// a dotfile manager may legitimately symlink; they still get the kind gate + size bound
// below, since `/dev/zero` there is still a hang (CoalMine's Step 3 ruling 1, re-derived
// for this room: the global config is this room's ONE home-file read).
export function isContained(child, root) {
  if (root == null) return true;
  const rel = path.relative(root, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// lstat-FIRST kind gate, before anything opens the path. Returns 'file' (proceed),
// 'dir' | 'missing' | 'other' (FIFO, socket, device, a directory, an escaping or
// dangling symlink, or anything realpath/stat cannot resolve -- refuse, never open).
// A symlink proceeds only if its realpath lies inside root's realpath (or root is
// null) AND resolves to a regular file.
export function repoEntryKind(p, root) {
  let st;
  try { st = fs.lstatSync(p); } catch { return 'missing'; }
  if (st.isSymbolicLink()) {
    let real;
    try { real = fs.realpathSync.native(p); } catch { return 'other'; } // dangling link
    if (root != null) {
      let realRoot;
      try { realRoot = fs.realpathSync.native(root); } catch { return 'other'; }
      if (real !== realRoot && !isContained(real, realRoot)) return 'other'; // escaping link
    }
    let rst;
    try { rst = fs.statSync(real); } catch { return 'other'; }
    return rst.isFile() ? 'file' : 'other';
  }
  if (st.isDirectory()) return 'dir';
  return st.isFile() ? 'file' : 'other'; // FIFO/socket/device/block-or-char-special -> 'other'
}

// O_NONBLOCK: belt-and-suspenders on top of the lstat gate above, for the TOCTOU window
// between the lstat and this open -- a FIFO swapped in between the two would otherwise
// block the open itself. 0 on Windows (the constant does not exist there; `|| 0` keeps
// the bitwise OR a no-op rather than NaN).
const REPO_READ_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0);

// Bounded, kind-gated, repo-aware read. Returns the file's UTF-8 text, or null if the
// path is not a plain file reachable from `root` (`root = null` = no containment, still
// kind-gated and bounded) or is over `maxBytes`. OVER THE BOUND IS SKIPPED, NEVER
// TRUNCATED: a truncated config parses as malformed, a truncated doc half-scans
// silently -- both worse than a visible skip.
export function readRepoFileBounded(file, root, maxBytes) {
  if (repoEntryKind(file, root) !== 'file') return null;
  let fd;
  try { fd = fs.openSync(file, REPO_READ_FLAGS); } catch { return null; }
  try {
    const st = fs.fstatSync(fd); // re-check AFTER open -- the TOCTOU window the O_NONBLOCK flag also guards
    if (!st.isFile()) return null;
    if (st.size > maxBytes) return null;
    const buf = Buffer.alloc(st.size);
    let readSoFar = 0;
    while (readSoFar < st.size) {
      const n = fs.readSync(fd, buf, readSoFar, st.size - readSoFar, readSoFar);
      if (n <= 0) break;
      readSoFar += n;
    }
    // R12 bounce 1 F2: a short read (the file shrank between fstat and here) must be
    // SKIPPED, never returned as a truncated prefix -- the header above says exactly this
    // and the old code violated it: a truncated config parses as "malformed JSON" (a wrong
    // diagnosis) and a truncated doc half-scans silently (worse than a skip).
    if (readSoFar !== st.size) return null;
    return buf.slice(0, readSoFar).toString('utf8');
  } catch { return null; }
  finally { try { fs.closeSync(fd); } catch {} }
}

export class RepoWriteRefused extends Error {
  constructor(target, why) {
    super(`[refused] ${target}: ${why} — replace it with a regular file inside the project (or remove it) and re-run.`);
    this.name = 'RepoWriteRefused';
    this.target = target;
  }
}

// The nearest ancestor of `p` that actually EXISTS on disk — `p` itself may not exist
// yet (the normal case for a config being created for the first time).
function nearestExistingAncestor(p) {
  let cur = p;
  while (true) {
    if (fs.existsSync(cur)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return cur; // filesystem root — give up, caller's containment check will fail honestly
    cur = parent;
  }
}

// Bounded, kind-gated, CONTAINED write on a repo-derived (or home-file) path. Refuses
// (throws RepoWriteRefused, never silently skips a write the caller asked for) when:
// the nearest existing ancestor's realpath escapes `root` (root = null skips this
// check, same meaning as the reader's root=null); the target EXISTS and is a symlink
// or anything but a regular file. Otherwise: write a per-pid temp with `wx` (fails if
// it already exists — never overwrite-in-place, never follow a link at the temp name
// either, since `wx` names a BRAND NEW path), then `renameSync` over the target — a
// rename REPLACES the directory entry rather than writing through whatever it names,
// so a symlink or hard link planted at `target` AFTER the check above is replaced, not
// followed. The Windows fallback (EPERM/EBUSY/EACCES from the rename, e.g. the target
// is a file another process holds open) re-lstats the target and writes in place ONLY
// if it is still a regular file with nlink === 1 (a hard link or a symlink still
// refuses — there is no "safe in place" write for either).
export function writeRepoFile(target, content, root) {
  const ancestor = nearestExistingAncestor(target);
  if (root != null) {
    let realAncestor, realRoot;
    try { realAncestor = fs.realpathSync.native(ancestor); } catch { throw new RepoWriteRefused(target, 'its nearest existing ancestor could not be resolved'); }
    try { realRoot = fs.realpathSync.native(root); } catch { throw new RepoWriteRefused(target, 'the write root could not be resolved'); }
    if (realAncestor !== realRoot && !isContained(realAncestor, realRoot)) {
      throw new RepoWriteRefused(target, 'its nearest existing ancestor resolves OUTSIDE the project root');
    }
  }
  let existingKind;
  try {
    const st = fs.lstatSync(target);
    existingKind = st.isSymbolicLink() ? 'symlink' : st.isFile() ? 'file' : 'other';
  } catch { existingKind = 'missing'; }
  if (existingKind === 'symlink') throw new RepoWriteRefused(target, 'it already exists and is a symlink');
  if (existingKind === 'other') throw new RepoWriteRefused(target, 'it already exists and is not a regular file');

  // R12 bounce 1 F3: the temp name is predictable (pid alone) and a stale leftover from a
  // crashed earlier run blocks this one. A raw EEXIST from the open is not an actionable
  // message (security.md's problem-report MUST — "never a raw stack trace or an internal
  // error code standing alone"), so it is caught and reported through this module's own
  // RepoWriteRefused channel. A throw from the write itself (ENOSPC, a full disk) must not
  // leave the temp on disk either (Phoenix #1) — unlike the open failure, the temp DOES
  // exist here, so it is unlinked before the error propagates.
  const temp = `${target}.coalledger-tmp-${process.pid}`;
  let fd;
  try {
    fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL);
  } catch (e) {
    if (e.code === 'EEXIST') {
      throw new RepoWriteRefused(target, `a leftover temp file blocks the write — remove ${temp} and re-run`);
    }
    throw e;
  }
  try {
    fs.writeSync(fd, content);
  } catch (e) {
    try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(temp); } catch {}
    throw e;
  }
  fs.closeSync(fd);
  try {
    fs.renameSync(temp, target);
  } catch (e) {
    try { fs.unlinkSync(temp); } catch {}
    if (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES') {
      // Windows: a rename over a file another process holds open (e.g. this process's
      // own .githooks/pre-commit running the installer that rewrites it) fails here
      // while the old in-place writeFileSync succeeded.
      //
      // R12 bounce 1 F1 (ported verbatim from CoalMine 3cd7c4c, "R8 INSPECT MEDIUM-1 +
      // LOW-1" — the CoalMine commit this room's own header cited as the port source for
      // this fallback, before that fix had landed there): the OLD shape here checked the
      // PATH (lstatSync) and then wrote the PATH (writeFileSync(target, ...)) — anything
      // planted between those two calls redirects the write, and a hard link swapped in
      // is written THROUGH the shared inode because nlink was read from the stale lstat
      // and never re-checked. The fix is check-the-FD, not the path: open the target
      // directly without truncating, O_NOFOLLOW so a symlink planted in this window fails
      // the OPEN on POSIX instead of being followed, O_NONBLOCK so a FIFO planted in the
      // same window fails ENXIO at the open instead of blocking until a reader appears
      // (the installer would otherwise hang). fstat the FD itself (never lstat the path
      // again — the open already resolved past any link or hard link) and refuse unless
      // it is a regular file with exactly one link; only THEN truncate and write through
      // that SAME fd, so a link or hard link swapped in after this point can no longer
      // redirect anything. RESIDUAL, named rather than claimed closed: Windows has no
      // O_NOFOLLOW/O_NONBLOCK (both fall back to 0 there), so a symlink planted in this
      // exact window on Windows would still be followed — it must still resolve to a
      // single-link regular file, and creating a file symlink on Windows needs a
      // privilege most callers of this module do not have.
      const flags = fs.constants.O_WRONLY | (fs.constants.O_NONBLOCK || 0) | (fs.constants.O_NOFOLLOW || 0);
      let wfd;
      try { wfd = fs.openSync(target, flags); } catch { throw new RepoWriteRefused(target, 'the rename failed (file busy) and the fallback open also failed'); }
      try {
        const st = fs.fstatSync(wfd);
        if (!st.isFile() || st.nlink > 1) {
          throw new RepoWriteRefused(target, 'the rename failed (file busy) and the target is a symlink or hard-linked — no safe in-place fallback');
        }
        const buf = Buffer.from(content, 'utf8');
        fs.ftruncateSync(wfd, 0);
        let off = 0;
        while (off < buf.length) off += fs.writeSync(wfd, buf, off, buf.length - off, off);
      } finally {
        fs.closeSync(wfd);
      }
      return;
    }
    throw e;
  }
}
