// CoalLedger config path resolution — the flock-canonical cascade (global
// ~/.claude/.coalledger.json overlaid by the nearest project config). Per-
// project config now lives under an agent dir (namespace campaign #69+#39,
// owner-designated 2026-08-08) — see `projectConfigPath`'s own header for
// the full read order and the LEGACY root-dotfile fallback it still honors.
// The project walk STOPS AT HOME (an upward config search that doesn't stop at
// home once escaped a HOME-overridden test sandbox into the real global config)
// and compares PHYSICAL paths on both sides (macOS /var -> /private/var symlink:
// a lexical `dir === home` never matches and the walk escapes above home).
//
// Pure + node built-ins only (fs, path, os).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseJsonc } from './jsonc.mjs';

export function claudeBaseDir(home = os.homedir()) {
  const c = process.env.CLAUDE_CONFIG_DIR;
  return (c && c.split(',')[0].trim()) || path.join(home, '.claude');
}
export function globalConfigPath(home = os.homedir()) {
  return path.join(claudeBaseDir(home), '.coalledger.json');
}

// realpath a dir to its PHYSICAL path, falling back to a lexical resolve if
// realpath throws (an absent dir has no realpath). Fail-open is correct here —
// this feeds a read-only COMPARE, not a delete (SKILL-REPO-PATTERN CI rules).
export function physicalDir(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

// Fixed agent-dir search order (namespace campaign #69+#39, owner-designated
// 2026-08-08) — shared by findProjectRoot's marker check below AND
// projectConfigCandidates, so the two can never drift apart (DRY).
const AGENT_DIR_ORDER = ['.claude', '.agents', '.gemini'];

// Walk up from startDir looking for a project-root marker (`.git`, the LEGACY
// `.coalledger.json`, or a per-agent-dir config under AGENT_DIR_ORDER); NEVER
// walk above `home` — stop there and fall back to startDir. The three
// agent-dir markers were added by the namespace campaign alongside the
// legacy dotfile: a project configured ONLY through the new shape (no
// `.git`, and — since it migrated — no root `.coalledger.json` either) would
// otherwise match nothing and fall through to the raw startDir fallback.
// Adding a marker can only make the walk stop LOWER — a narrower anchor —
// never higher; it never widens the search past what `.git`/the legacy file
// already covers.
export function findProjectRoot(startDir = process.cwd(), home = os.homedir()) {
  let dir = physicalDir(startDir);
  const homeAbs = physicalDir(home);
  while (true) {
    const hasAgentConfig = AGENT_DIR_ORDER.some((d) => fs.existsSync(path.join(dir, d, 'coal', 'coalledger.json')));
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, '.coalledger.json')) || hasAgentConfig) return dir;
    if (dir === homeAbs) return startDir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir; // filesystem root reached
    dir = parent;
  }
}
// Namespace campaign (#69+#39, owner-designated 2026-08-08). Per-project
// config lives under an agent dir, never bare at the project root any more.
// THE READ ORDER IS A RAIL — identical wording in every room's readCfg
// comment and README Configure section, one flock:
//   1. <project>/.<the running agent's OWN dir>/coal/<skill>.json — the dir
//      of the agent actually executing. loadMergedConfig takes no
//      agent-identity parameter (cwd only) — the CC hook
//      (hooks/coalledger-conductor.js) and the ported Antigravity adapter
//      (hooks/ag-conductor.js) both call it identically, so there is no
//      signal here to distinguish them; step 1 collapses onto the fixed
//      `.claude` entry of step 2 below for every caller, not because only
//      Claude Code can activate this room.
//   2. Other known agent dirs, fixed order: `.claude` -> `.agents` ->
//      `.gemini` (first FOUND wins).
//   3. LEGACY: <project>/.<skill-dotfile>.json at the project root (today's
//      shape) — read normally, no breakage for an existing user.
// WRITE target = where the config was found; absent everywhere, the running
// agent's own dir. Hooks never perform this move on a READ (Phoenix #5, no
// side effects) — and CoalLedger has NO project-config WRITER anywhere in
// this codebase to begin with (no configure.mjs, no consent-persistence
// call): `.coalledger.json` (global or project) is hand-edited by the user,
// never written by CoalLedger itself. So "move on write" has no code path to
// hook here — this function is the READ side only, which is this room's
// entire scope for the campaign.
export function projectConfigCandidates(cwd = process.cwd(), home = os.homedir()) {
  const root = findProjectRoot(cwd, home);
  const candidates = AGENT_DIR_ORDER.map((d) => path.join(root, d, 'coal', 'coalledger.json'));
  candidates.push(path.join(root, '.coalledger.json')); // LEGACY, always last
  return candidates;
}
export function projectConfigPath(cwd = process.cwd(), home = os.homedir()) {
  const candidates = projectConfigCandidates(cwd, home);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0]; // nothing found anywhere -- own-dir is both the read and write target
}

function readJsonc(file) {
  try {
    let content = fs.readFileSync(file, 'utf8');
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
    const parsed = parseJsonc(content); // proto-pollution-guarded parse
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Consent-cascade clamp (hooks-safety.md §9). The project `.coalledger.json`
// ARRIVES WITH A CLONED REPO — untrusted. A plain project-wins overlay lets it
// ESCALATE a consent-bearing key, so the conductor then spends tokens or fires
// standing-consent actions nobody agreed to. For the hook-read keys that gate
// CONSENT, SPEND or an OUTWARD action the project layer may QUIETEN, never
// escalate; every other key stays plain project-wins (caps, language, floors).
// Flock shape: CoalMine `updateMode` + CoalWash `mergeSafety`.
//
// SCOPE — why exactly these three, and not the rest:
//   coalledgerMode   'auto' makes the SessionStart conductor inject its offer
//                    directive every session (tokens, and it drives paid-scan
//                    offers); 'off' is silence. A `coal*Mode`, named by §9.
//   updateMode       'auto' is standing consent to CHECK and offer an update —
//                    it sends the AGENT to the network. The flock's exemplar.
//   disabledCanaries the documented silence switch (`["all"]`), so a SHORTER
//                    project list revives canaries the user silenced globally.
//                    Set-valued, so "safer" = MORE disabled = a UNION (same
//                    direction as CoalBoard's criticalPaths REPLACE->UNION).
//   docLeak          gates whether the doc-leak canary is OFFERED at all, on
//                    the SAME conductor filter expression as disabledCanaries
//                    (coalledger-conductor.js) — both halves suppress the same
//                    offer, so guarding one and not the other was arbitrary. A
//                    boolean gating a CAPABILITY is just an enum of two and
//                    clamps with this same mechanism; `false` is the safer
//                    index. Attack it closes: a global `docLeak:false` (the
//                    private-project case the template itself documents) that a
//                    cloned repo flips back to `true`.
// NOT clamped, and each for its OWN reason — the classifier is BLAST, not type:
//   docsDriftNudge   also a boolean, but it suppresses ONE quiet model-only
//                    line: no offer, no scan, no spend. Re-enabling that in a
//                    single project is a legitimate use, so it stays plain.
//                    (docLeak vs docsDriftNudge is why two booleans must never
//                    share one parenthetical — it hides exactly this asymmetry.)
//   language · severityFloor · publicMode   no consent, spend or outward axis.
//   updateCheckDays  a numeric spend-RATE dial. CONSIDERED AND DECLINED (§9,
//                    2026-07-27): the action it paces is already gated by
//                    `updateMode`, which IS clamped, and clampedRead already
//                    floors the value — a second guard over a bounded cadence
//                    under an already-gated action is the over-hardening
//                    skill-authoring.md §2 forbids. Settled, not open.
// OUT OF REACH (not a gap in this list): `quickVsFull` — CL's real paid-tier
// dial — is read by the AGENT from the raw project file and never passes
// through this merge, so no clamp here could protect it. §9's scope test is
// "does a HOOK read it?", not "is it consent-bearing?". It is named where a
// reader actually meets it (config-schema.mjs `help:` + the .coalledger.json
// template), because naming it only here would reach nobody.
const SAFER_ENUM = {
  coalledgerMode: ['off', 'manual', 'auto'], // index 0 = safest
  updateMode: ['off', 'remind', 'ask', 'auto'], // order byte-identical to CM/CW
  docLeak: ['false', 'true'], // boolean gate = enum of two; String()+toLowerCase below makes it work unchanged
};
const SAFER_UNION = ['disabledCanaries'];

export function mergeSafety(global, project) {
  const out = { ...global, ...project };
  for (const [key, order] of Object.entries(SAFER_ENUM)) {
    // Constrain only against an EXPLICIT global choice: a global sitting on the
    // factory default (key absent) leaves the project free to set anything.
    if (global[key] === undefined || project[key] === undefined) continue;
    // CASE-FOLD to match the schema's case-insensitive enums (clampedRead
    // lowercases). Comparing raw case let a project 'AUTO'/'Off' miss the
    // lookup (indexOf -> -1) and fall through to the overlay, re-enabling a
    // globally-off skill — CoalWash paid for this one (H5).
    const gi = order.indexOf(String(global[key]).toLowerCase());
    const pi = order.indexOf(String(project[key]).toLowerCase());
    if (gi === -1 || pi === -1) continue; // genuinely unknown value: leave the overlay (clampedRead clamps downstream)
    out[key] = pi <= gi ? project[key] : global[key]; // project may not move PAST global toward the louder end
  }
  for (const key of SAFER_UNION) {
    if (!Array.isArray(global[key]) || !Array.isArray(project[key])) continue;
    out[key] = [...new Set([...global[key], ...project[key]])]; // a project may add, never remove
  }
  return out;
}

// Two-level cascade: global overlaid by the nearest project config, with the
// consent-bearing keys clamped safer-value-wins (mergeSafety above).
export function loadMergedConfig({ cwd = process.cwd(), home = os.homedir() } = {}) {
  const global = readJsonc(globalConfigPath(home));
  const project = readJsonc(projectConfigPath(cwd, home));
  return mergeSafety(global, project);
}
