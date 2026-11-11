#!/usr/bin/env node
// SessionEnd (29ea): removes THIS session's own temp markers, then runs the staleness sweep over the room's temp files and the per-user
// run-list folder's AG markers. Claude Code only: the doc-tracker (coalledger-doctrack.js) writes the markers, the Stop hook keeps the
// satisfier on purpose (Stop fires per response), so the end of the SESSION is the one event that may unlink it. Fail-silent (Phoenix #4):
// no stdout, no stderr, the exit code is never set, and the entry point never calls process.exit().
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function lib(name) {
  return pathToFileURL(path.join(__dirname, '..', 'scripts', 'lib', name)).href;
}

async function main() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { return; }
  if (!raw) return;
  let input;
  // trim() also strips a leading BOM some shells prepend when piping stdin.
  try { input = JSON.parse(raw.trim()); } catch { return; }

  // This session's own files only. The sid is allowlisted exactly as the doc-tracker allowlists it, so a traversal-shaped value
  // (../../x) can never reach a path outside the temp folder (Phoenix #10).
  const sid = input && typeof input === 'object' ? input.session_id : undefined;
  if (typeof sid === 'string' && /^[A-Za-z0-9_-]+$/.test(sid)) {
    const base = path.join(os.tmpdir(), `coalledger-${sid}`);
    for (const ext of ['.docmemmoved', '.docs']) {
      try { fs.unlinkSync(base + ext); } catch { /* already gone */ }
    }
  }

  const sweep = await import(lib('temp-sweep.mjs'));
  sweep.sweepStaleFiles(os.tmpdir(), sweep.SESSION_MARKER_PATTERN);
  try {
    const { runListFolder, checkRunListFolder } = await import(lib('repo-fs.mjs'));
    const dir = runListFolder();
    // checkRunListFolder throws on a link, a foreign owner or an open folder, and returns false when the folder is absent: both are skips.
    if (checkRunListFolder(dir)) sweep.sweepStaleFiles(dir, sweep.AG_MARKER_PATTERN);
  } catch { /* a refused or absent run-list folder is skipped */ }
}

main().catch(() => {
  // Phoenix #4: fail-silent, never throw, never crash the host.
});
// No process.exit() (Phoenix #4): it could truncate a pending stdout write, and this hook writes none.
