#!/usr/bin/env node
'use strict';
// CoalLedger docs-drift tracker (PostToolUse: Write|Edit|MultiEdit) — the DOCS
// mirror of CoalMine's rot-canary-touch. Records which DOC files were edited
// this session into coalledger-<sid>.docs, and treats a MEMORY.md edit as the
// SATISFIER marker coalledger-<sid>.docmemmoved. The Stop hook
// (coalledger-drift-stop.js) reads both to decide the one quiet nudge.
//
// DISJOINT with CoalMine (the "ห้ามชนกัน" rule): CM watches CODE extensions, CL
// watches DOC extensions — the two sets never overlap, so a .js edit is CM's
// alone and a .md edit is CL's alone. MEMORY.md is the SATISFIER for BOTH and a
// trigger for NEITHER (intercepted before the extension gate, exactly like CM's
// touch hook), so editing the record clears both drifts and double-counts
// neither. State files carry the coalledger-<sid> prefix (CM uses
// rot-canary-<sid>) so nothing collides in os.tmpdir().
//
// CONFIG-FREE by design (a NAMED divergence from CM's touch hook, which reads
// config to gate an expensive tripwire SCAN): this tracker runs NO scan, so it
// has nothing costly to gate — recording is a single appendFileSync. Gating it
// on config would pay an ESM config import on EVERY doc edit (the common path
// when the feature is ON, the default) only to skip an invisible, OS-reaped
// temp write in the OFF case. So ALL config gating lives in the Stop hook,
// which runs once per edit BATCH: when the feature is off the Stop hook emits
// nothing and the stray temp file is OS-tmp reaped — CoalLedger's
// already-accepted ceiling for its AG conductor markers.
//
// Phoenix-13: fail-silent (try/catch around main), exit 0 on every path,
// zero-dep (node builtins only), no spawn, no network, never process.exit.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The DOC extensions CoalLedger owns. Disjoint from CoalMine's code set by
// construction (prose/markup formats; none is a source-code extension). Not
// configurable in v1 (YAGNI — add a watchedDocExtensions key when a real
// project needs a custom one; a named v1 ceiling).
const DOC_EXTS = new Set(['.md', '.mdx', '.markdown', '.rst', '.txt', '.adoc', '.asciidoc', '.org']);

// Defensive edited-path extraction across CC + AG payload shapes (mirror CM):
//   Claude Code:  input.tool_input.file_path
//   Antigravity:  input.toolCall.args.<name> / camelCase toolInput
function extractEditedPath(input) {
  if (!input || typeof input !== 'object') return null;
  const bags = [input.tool_input, input.toolInput, input.toolCall && input.toolCall.args];
  for (const bag of bags) {
    if (bag && typeof bag === 'object') {
      for (const k of ['file_path', 'filePath', 'path', 'filename', 'file']) {
        if (typeof bag[k] === 'string' && bag[k]) return bag[k];
      }
    }
  }
  return null;
}

// Never record a file living under the hook's own os.tmpdir() — throwaway
// lab/scratch (the session scratchpad, a one-shot harness) never ships as a doc
// (the exact dogfood miss CoalMine closed in v3.12.2). Scan-SCOPE exclude, not a
// security boundary: a lexical resolve-and-contain is correct (a missed
// symlinked-temp edge just means the file gets tracked — harmless), no
// realpath/fail-closed needed. Boundary-safe (a trailing sep so "<tmp>X" never
// matches "<tmp>"); case-insensitive on win32.
function isUnderTmpdir(absPath) {
  const tmp = path.resolve(os.tmpdir());
  let p = path.resolve(absPath);
  let t = tmp;
  if (process.platform === 'win32') { p = p.toLowerCase(); t = t.toLowerCase(); }
  return p === t || p.startsWith(t + path.sep);
}

function main() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { return; }
  if (!raw) return;
  let input;
  // trim() also strips a leading BOM some shells prepend when piping stdin.
  try { input = JSON.parse(raw.trim()); } catch { return; }

  const f = extractEditedPath(input);
  if (!f) return;
  // Resolve a relative path against the payload's workspace when provided (AG
  // launches the hook with cwd = the hooks.json dir; on CC payload cwd equals
  // process.cwd(), so this is a no-op there — an absolute file_path ignores the
  // base either way). workspacePaths[0] = the current AG spec field; cwd is the
  // CC + legacy fallback.
  const wsBase = Array.isArray(input.workspacePaths) ? input.workspacePaths[0] : undefined;
  const baseDir = (typeof wsBase === 'string' && wsBase)
    || ((typeof input.cwd === 'string' && input.cwd) ? input.cwd : process.cwd());
  const normF = path.resolve(baseDir, f);

  // Throwaway temp never counts — checked BEFORE anything is recorded, ahead of
  // both the MEMORY.md marker branch and the doc-extension gate (a tmp-resident
  // MEMORY.md must not set the satisfier either).
  if (isUnderTmpdir(normF)) return;

  // conversationId = the current AG spec's session field; session_id (CC's core
  // field) + camelCase sessionId stay as fallbacks. MUST match the Stop hook's
  // chain — it reads the coalledger-<sid> state keyed here.
  const sid = input.conversationId || input.session_id || input.sessionId;
  // Phoenix #10 (sandbox): allowlist the sid so a traversal-shaped value (e.g.
  // ../../etc/x) cannot escape os.tmpdir() via path.join. Non-conforming → bail.
  if (!sid || typeof sid !== 'string' || !/^[A-Za-z0-9_-]+$/.test(sid)) return;
  const base = path.join(os.tmpdir(), `coalledger-${sid}`);

  // MEMORY.md = the SATISFIER (never a docs-trigger): record it as a 0-byte
  // marker BEFORE the doc-extension gate so a MEMORY.md edit CLEARS the drift
  // instead of tripping it (MEMORY.md is a .md, but it is the record, not the
  // doc work). Mirrors CM's .memmoved. Atomic wx create (O_CREAT|O_EXCL):
  // EEXIST = already recorded this session → swallowed; wx also refuses to
  // write through a pre-planted symlink (js/insecure-temporary-file). The
  // sid-scoped name (unpredictable session UUID) matches CM's dismissed-FP class.
  if (path.basename(normF).toLowerCase() === 'memory.md') {
    try { fs.writeFileSync(base + '.docmemmoved', '', { flag: 'wx' }); } catch {}
    return; // MEMORY.md is never in the watched doc set — nothing else to record
  }

  // A DOC file edited this session → record it (dedup, case-insensitive on win32).
  if (!DOC_EXTS.has(path.extname(normF).toLowerCase())) return;
  const docs = base + '.docs';
  let existing = [];
  try { existing = fs.readFileSync(docs, 'utf8').split('\n').filter(Boolean).map((x) => path.normalize(x)); } catch {}
  const isWin = process.platform === 'win32';
  const fCompare = isWin ? normF.toLowerCase() : normF;
  const existingCompare = isWin ? existing.map((x) => x.toLowerCase()) : existing;
  if (!existingCompare.includes(fCompare)) { try { fs.appendFileSync(docs, normF + '\n'); } catch {} }
}

try { main(); } catch {}
