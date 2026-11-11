// The staleness sweep for the room's own temp markers (29ea). One directory, non-recursive, node builtins only (Phoenix #2): the hooks reach it through a
// dynamic import, from the SessionEnd hook and from the AG conductor's first run of a session. A file is removed only when ALL hold: its name matches
// the caller's exact pattern, lstat says a REGULAR file (a link or a folder is never touched, and unlinking a link would remove the link alone, never its
// target), its mtime is older than the age bound, and the folder's realpath is the one the caller named. Every error is a skip, never a throw.
// The work is bounded by a named count of directory entries read and of files removed, so a huge temp folder cannot take SessionEnd's shared budget;
// a run cut short leaves only stale files of the room's own pattern, which the next run sweeps.
import fs from 'node:fs';
import path from 'node:path';

export const SESSION_MARKER_PATTERN = /^coalledger-[A-Za-z0-9_-]+\.(docmemmoved|docs)$/;
// The AG conductor's marker name is the djb2 hash written in base 36 (hooks/ag-conductor.js hashKey), so the token is [0-9a-z], not hex.
export const AG_MARKER_PATTERN = /^ag-conductor-[0-9a-z]+\.marker$/;
export const STALE_AFTER_MS = 7 * 24 * 3600 * 1000;
export const MAX_DELETIONS = 200;
export const MAX_SCANNED = 5000;

export function sweepStaleFiles(dir, pattern, {
  nowMs = Date.now(),
  staleAfterMs = STALE_AFTER_MS,
  maxDeletions = MAX_DELETIONS,
  maxScanned = MAX_SCANNED,
} = {}) {
  let removed = 0;
  let handle;
  try { handle = fs.opendirSync(dir); } catch { return 0; }
  try {
    let realDir;
    try { realDir = fs.realpathSync.native(dir); } catch { return 0; }
    let scanned = 0;
    let entry;
    while (scanned < maxScanned && removed < maxDeletions && (entry = handle.readSync()) !== null) {
      scanned++;
      if (!pattern.test(entry.name)) continue;
      const candidate = path.join(dir, entry.name);
      try {
        const st = fs.lstatSync(candidate);
        if (!st.isFile()) continue;
        if (nowMs - st.mtimeMs < staleAfterMs) continue;
        if (fs.realpathSync.native(path.dirname(candidate)) !== realDir) continue;
        fs.unlinkSync(candidate);
        removed++;
      } catch { /* a file that vanished, or cannot be removed, is a skip */ }
    }
  } finally {
    try { handle.closeSync(); } catch { /* closing a handle that is already gone is a no-op */ }
  }
  return removed;
}
