#!/usr/bin/env node
'use strict';
// CoalLedger conductor — Antigravity (AG 2.0 hooks.json) adapter. AG has NO
// one-shot session-start event (SessionStart is a valid name but never fires —
// pilot 2026-07-12), so the docs-health offer directive rides the FIRST
// `PreInvocation` of a session instead. PreInvocation fires per MODEL CALL
// (many times per user prompt), so an unguarded port would re-inject the
// directive into EVERY model call (context spam + token burn). Guard: an
// atomic once-per-session marker in the per-user run folder (below).
//
// The offer text + config semantics come from ./coalledger-conductor.js
// (require'd, never re-typed): ONE implementation for both platforms — the
// CoalHearth/CoalFace shared-core one-flock pattern. Deliberately NOT ported:
//   - the KIND 1 self-update nudge: its payload ("claude plugin update
//     coalledger@coalledger") is Claude-Code plugin machinery; AG installs by
//     file-copy, so that instruction would be wrong there — and firing here
//     would consume the shared ~/.claude update stamp, throttling a
//     co-installed real CC's own nudge (the CM/CF/CH named decision). No
//     update stamp is read or written on the AG path.
// NAMED mechanism divergence from CoalFace's adapter (which process.chdir()s
// to the payload workspace): CL's config lib takes the cwd as a parameter
// (loadMergedConfig({ cwd })), so the same "payload workspace is
// authoritative" rule is honored without mutating process state. Same rule,
// cleaner seam.
//
// Emit = the one sanctioned AG channel: a single-line PreInvocation output
// JSON, {"injectSteps":[{"ephemeralMessage": <offers>}]} (camelCase
// protojson) — the CURRENT engine's documented contract (re-derived
// 2026-07-23 from the installed build's own hooks doc; the pilot-era
// `additionalContext` key is a DEAD LETTER there — 0 engine hits — and
// dual-emitting risks protojson rejecting the whole payload; ephemeralMessage
// = a transient system message, the advisory class — userMessage would
// fabricate a user turn).
// Delivery into the agent context was measured on agy 1.4.12 (headless agy -p,
// Windows, 2026-10-31, one run per route): the once-per-session marker was written
// on both routes. The interactive IDE was not exercised.
// Manual canary invocation (the AG floor tier) is unaffected either way.
//
// Phoenix-13 throughout: fail-silent, exit 0 always, zero-dep (node builtins
// only), no network, no child process, no process.exit(); the only write is
// the tmp marker.

const fs = require('node:fs');
const path = require('node:path');
const { buildOffers, languageLine, lib } = require('./coalledger-conductor.js');

// First non-empty string among keys (defensive: AG core fields are snake_case;
// accept camelCase too — the pilot captured the payload shape only partially).
function firstString(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

// Deterministic djb2 (Phoenix #8: same key -> same marker name): arbitrary
// session key (UUID or transcript path) -> stable filesystem-safe token.
function hashKey(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0);
  return h.toString(36);
}

async function main() {
  let payload = {};
  try {
    const p = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (p && typeof p === 'object' && !Array.isArray(p)) payload = p;
  } catch { /* absent/garbage stdin -> {} -> no session key -> skip below */ }

  // A per-session key is REQUIRED for the once-per-session guard.
  // `conversationId` = the CURRENT spec's documented common field (re-derived
  // 2026-07-23); the rest stay defensive fallbacks (transcriptPath is also
  // documented + per-conversation). Absent -> skip silently (Phoenix #12)
  // rather than risk re-injecting per model call.
  const key = firstString(payload, ['conversationId', 'session_id', 'sessionId', 'transcript_path', 'transcriptPath']);
  if (!key) return;

  // Atomic once-per-session latch (CodeQL js/insecure-temporary-file /
  // js/file-system-race — the one-flock wx-create shape, CM/CF/CH 2026-07-14).
  // The marker is created with the `wx` flag (O_CREAT|O_EXCL): the write
  // atomically FAILS with EEXIST if the path already exists in ANY form (a prior
  // model call's marker, or a planted file/symlink) — killing the check-then-write
  // TOCTOU race AND refusing a symlink target in one syscall. The folder needs its
  // own guard, the one checkRunListFolder gives: mkdirSync SILENTLY succeeds on a
  // folder that already exists (the 0o700 mode is NOT applied to it), so the
  // folder is checked after the make — a link, another account's folder, or one
  // open to others is refused before any marker is written.
  // FAIL-CLOSED (the CF/CM advisory-payload class, a NAMED divergence from
  // CoalHearth's shim which emits + a "may repeat" note): this payload is
  // ADVISORY — repeating it on every model call IS the spam this guard
  // prevents — so ANY create failure (EEXIST = already ran this session, OR an
  // unwritable tmp) skips the emit entirely. Marker BEFORE the config read:
  // every later PreInvocation of the session returns here at ~1ms, never
  // paying the ESM config import again (Phoenix #3).
  // Markers are session-scoped. AG has no SessionEnd, so the run that writes its
  // marker (the one run per session that gets this far) also sweeps the folder's
  // stale AG markers (scripts/lib/temp-sweep.mjs, seven days, bounded), below.
  // The folder is the room's per-user folder (repo-fs.mjs runListFolder, the one the run list uses). mkdir's mode is NOT applied to a folder
  // that already exists, so the folder is checked after the make: a link, a folder another account owns, or one open to group or other bits
  // is refused (checkRunListFolder throws) and the emit is skipped. Where the platform reports no uid, only the link leg runs.
  try {
    const { runListFolder, checkRunListFolder } = await import(lib('repo-fs.mjs'));
    const markerDir = runListFolder();
    try { fs.mkdirSync(markerDir, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') return; }
    if (!checkRunListFolder(markerDir)) return; // absent after the make -> fail-closed
    fs.writeFileSync(path.join(markerDir, `ag-conductor-${hashKey(key)}.marker`), '', { flag: 'wx' });
    // 29ea: this run wrote its marker, so it sweeps the folder's stale AG markers once. A failed sweep never blocks the emit below.
    try {
      const sweep = await import(lib('temp-sweep.mjs'));
      sweep.sweepStaleFiles(markerDir, sweep.AG_MARKER_PATTERN);
    } catch { /* a failed sweep is skipped */ }
  } catch { return; } // refused folder, EEXIST (already ran), or any write failure -> fail-closed, no emit

  // AG does not guarantee the hook process's cwd is the workspace (documented:
  // hook cwd = the directory containing hooks.json); the payload names the
  // workspace — `workspacePaths[0]` = the current spec's field (re-derived
  // 2026-07-23), `cwd` kept as the legacy fallback — authoritative for the
  // project-config walk when present.
  const [{ loadMergedConfig, configNotices }, { clampedRead }] = await Promise.all([
    import(lib('config-load.mjs')),
    import(lib('config-schema.mjs')),
  ]);
  const wsPaths = payload.workspacePaths;
  const cwd = (Array.isArray(wsPaths) && typeof wsPaths[0] === 'string' && wsPaths[0])
    ? wsPaths[0] : firstString(payload, ['cwd']);
  const cfg = loadMergedConfig(cwd ? { cwd } : {});
  // UMB-133: the config-path notices, bound to THIS platform's workspace (the
  // payload's, not the hook process's cwd) and handed to the shared assembly as
  // a THUNK — LAZY (bounce-1 F4), so a gated-off session never pays the root
  // walk; buildOffers resolves it past its own gates and owns the fail-silent
  // wrap, which is why there is no try/catch here any more.
  const out = buildOffers(cfg, clampedRead, () => configNotices(cwd));
  // null = off/disabled (the Phoenix #13 consent gate: no notice either — see
  // buildOffers); [] = manual mode with nothing to say (offers silent, and
  // KIND 1 is not ported here). A non-empty array in manual mode is the
  // config-path notices alone.
  if (!out || !out.length) return;
  const lang = languageLine(clampedRead(cfg, 'language'));
  if (lang) out.push(lang);
  process.stdout.write(JSON.stringify({ injectSteps: [{ ephemeralMessage: out.join('\n') }] }) + '\n'); // the one sanctioned AG stdout (current PreInvocation output contract)
}

main().catch(() => {
  // Phoenix #4: fail-silent, never throw, never crash the host agent.
});
// No process.exit() — Phoenix #4 (it would truncate the sanctioned stdout write above).
