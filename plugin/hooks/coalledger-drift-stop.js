#!/usr/bin/env node
'use strict';
// CoalLedger docs memory-drift nudge (Stop) — the DOCS mirror of CoalMine's
// memory-drift, on the QUIET channel. Stop fires when the agent finishes
// responding — i.e. per EDIT BATCH, several times a session, NOT once at a
// session end. On each: if DOC files were edited in this batch
// (coalledger-<sid>.docs, written by the doc-tracker) but MEMORY.md has not been
// updated at any point this session (no coalledger-<sid>.docmemmoved marker —
// it deliberately OUTLIVES each batch, see cleanup) and the project uses the
// MEMORY.md convention, emit ONE quiet advisory line — no report, no severity
// table, no skill-invoke, no fix menu, and it never blocks the stop (no
// decision:block, ever).
//
// board #82 (2026-08-09): the emit is `systemMessage`, NOT
// hookSpecificOutput.additionalContext — empirically proven that a Stop hook
// returning a non-empty additionalContext forces Claude Code to run ONE MORE
// agent turn to "digest" the injected context; under `-p --output-format
// json` that extra turn REPLACES the real final `result` with whatever the
// model says in reaction to the injected note (observed: a genuine answer
// discarded, `result` came back empty). additionalContext on
// SessionStart/UserPromptSubmit does NOT do this — the extra turn is
// specific to the STOP event. A prior
// version of this file used additionalContext here on the mistaken premise
// that "never decision:block" meant "never disruptive" — it still forced a
// second turn that stole the real result. systemMessage carries the same
// text to the same surfaces (the session transcript, an interactive user)
// without forcing that extra turn.
// Off-switchable via docsDriftNudge=false.
//
// It is NOT a canary: it does no doc scan and produces no findings — just this
// one hygiene reminder that the doc work isn't recorded yet.
//
// CC-only: Antigravity's engine documents no Stop inject channel (CoalMine's AG
// Stop emits {} for that reason), so a docs-drift nudge there is a separate
// design, deliberately NOT wired (the CC hooks.json wires this; the AG template
// does not).
//
// Phoenix-13: fail-silent, exit 0 always, zero-dep (node builtins + the repo's
// own ESM config lib — never a re-implemented reader, which silently diverged
// once in a sibling), no network, no spawn, never process.exit (it would
// truncate the sanctioned stdout write).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function lib(name) {
  return pathToFileURL(path.join(__dirname, '..', 'scripts', 'lib', name)).href;
}

// One quiet English model-context line. CL's conductor idiom is an English
// directive TO the agent, which then surfaces user-facing prose in the session's
// language per the SessionStart language lock — so there is no per-language
// table here (a NAMED divergence from CoalMine's translated Stop line; the note
// is model-facing, not shown verbatim). DISTINCT from CoalMine's CODE note (this
// names DOCS) so a session that edited both code and docs gets two
// non-redundant notes, one per axis.
//
// ROUTED, not commanded (board #25): the hook cannot tell whether the
// responder holding this Stop owns MEMORY.md or is a production-line station
// worker forbidden to write it (org law — writes gate to the room-gate OUT
// step). An unconditional "update MEMORY.md" either tells a station worker to
// violate that law or reads as noise it correctly ignores. The line states the
// fact (drift never lost) and branches the ACTION on who can act on it.
const DRIFT_LINE = "[CoalLedger] Docs memory-drift: documentation changed this session but no MEMORY.md update was recorded. If you own this session's record, update MEMORY.md before ending; if you are a station worker who cannot write it, report the drift in your return instead. (Advisory; disable: docsDriftNudge=false in .coalledger.json)";

// Clear the edit BATCH, never the session-long SATISFIER. CC's Stop fires per
// RESPONSE (many per session), so deleting `.docmemmoved` here would forget a
// turn-1 MEMORY.md update and falsely nudge on turn-2 doc work (reproduced;
// regression test "the satisfier SURVIVES a stop"). CoalMine avoids this with
// its `.scanned` ACK-mtime machinery — overkill for a one-line advisory, so the
// satisfier simply persists.
// ponytail: the 0-byte sid-scoped `.docmemmoved` leftover is OS-tmp reaped —
// the same accepted tmp ceiling as the AG conductor markers; port CoalMine's
// ACK machinery only if this tier ever needs re-nudging within a session.
function cleanup(base) {
  try { fs.unlinkSync(base + '.docs'); } catch {}
}

async function main() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { return; }
  if (!raw) return;
  let input;
  try { input = JSON.parse(raw.trim()); } catch { return; }
  if (!input || input.stop_hook_active) return; // loop guard (no re-entrant nudge)

  const sid = input.conversationId || input.session_id || input.sessionId;
  // Phoenix #10: allowlist the sid so a traversal-shaped value cannot escape
  // os.tmpdir() via path.join. Non-conforming → bail (fail-silent).
  if (!sid || typeof sid !== 'string' || !/^[A-Za-z0-9_-]+$/.test(sid)) return;
  const base = path.join(os.tmpdir(), `coalledger-${sid}`);

  // No doc work recorded this session → nothing to nudge (the common case; no
  // config read paid).
  if (!fs.existsSync(base + '.docs')) return;

  // The payload names the workspace (CC: cwd == process.cwd(); AG:
  // workspacePaths[0]) — authoritative for both the config walk and the
  // MEMORY.md probe.
  const wsBase = Array.isArray(input.workspacePaths) ? input.workspacePaths[0] : undefined;
  const cwd = (typeof wsBase === 'string' && wsBase)
    || ((typeof input.cwd === 'string' && input.cwd) ? input.cwd : process.cwd());

  // ALL config gating lives here (the tracker is config-free): the master switch
  // off, a global 'all' disable, or the feature's own off-switch each silence
  // the nudge. The shared ESM config lib is imported only on a stop that
  // actually has recorded doc edits (the early bail above spares every other one).
  let cfg, clampedRead, findProjectRoot;
  try {
    const [cl, cs] = await Promise.all([import(lib('config-load.mjs')), import(lib('config-schema.mjs'))]);
    findProjectRoot = cl.findProjectRoot;
    clampedRead = cs.clampedRead;
    cfg = cl.loadMergedConfig({ cwd });
  } catch { cleanup(base); return; }

  const disabled = clampedRead(cfg, 'disabledCanaries');
  if (clampedRead(cfg, 'coalledgerMode') === 'off'
      || disabled.includes('all')
      || clampedRead(cfg, 'docsDriftNudge') === false) { cleanup(base); return; }

  // Emit only when MEMORY.md was NOT updated this session AND the project uses
  // the MEMORY.md convention (a root MEMORY.md exists — a read-only existence
  // probe, the same access class as the .coalledger.json read, Phoenix #10).
  const out = {};
  try {
    const root = findProjectRoot(cwd);
    if (!fs.existsSync(base + '.docmemmoved') && fs.existsSync(path.join(root, 'MEMORY.md'))) {
      // systemMessage, not hookSpecificOutput.additionalContext (board #82) —
      // additionalContext on Stop forces an extra agent turn that eats the
      // real result under -p --output-format json; systemMessage does not,
      // and still surfaces (session transcript, interactive UI). Never
      // decision:block, never a fix menu.
      out.systemMessage = DRIFT_LINE;
    }
  } catch {}

  // Close this edit BATCH: drop .docs so the next Stop with no new doc edit
  // stays silent (the satisfier persists — see cleanup). A crashed session's
  // leftover is OS-tmp reaped, CoalLedger's accepted ceiling for its tmp markers.
  cleanup(base);
  process.stdout.write(JSON.stringify(out)); // {} when not drifting (allow stop, no context)
}

main().catch(() => {
  // Phoenix #4: fail-silent, never throw, never crash the parent agent.
});
// No process.exit() — Phoenix #4 (it would truncate the sanctioned stdout write above).
