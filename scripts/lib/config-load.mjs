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
import { CONFIG_SCHEMA } from './config-schema.mjs';

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
// WRITE target = where the config was found; absent everywhere, ownDirDefault
// below (CWK-023: the write side now exists — `scripts/configure.mjs` — and
// a hook never performs this move on a mere READ, Phoenix #5; only
// configure.mjs's own explicit write can trigger a legacy-file migration,
// exactly the move-on-CONFIG-WRITE-only rail this comment already named
// before there was a writer to exercise it).
function candidatesForRoot(root) {
  const candidates = AGENT_DIR_ORDER.map((d) => path.join(root, d, 'coal', 'coalledger.json'));
  candidates.push(path.join(root, '.coalledger.json')); // LEGACY, always last
  return candidates;
}
export function projectConfigCandidates(cwd = process.cwd(), home = os.homedir()) {
  return candidatesForRoot(findProjectRoot(cwd, home));
}
// Fresh-default / migration write target when NO config exists anywhere yet
// (ported from CoalMine's INSPECT MEDIUM 2, 2026-08-08, CWK-023): the design
// doc's own intent is "nests under whichever agent config dir the project
// ALREADY HAS" — candidates[0] alone always means `.claude`, which plants a
// foreign `.claude/` into a project that only uses `.agents`/`.gemini` and
// has never touched Claude Code. Pick the first AGENT_DIR_ORDER entry that
// already exists as a DIRECTORY on disk (the agent dir itself, not the
// config file inside it); none present -> `.claude` (AGENT_DIR_ORDER[0]),
// the same default a never-configured project got before this fix.
function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
export function ownDirDefault(root) {
  const dir = AGENT_DIR_ORDER.find((d) => isDir(path.join(root, d))) ?? AGENT_DIR_ORDER[0];
  return path.join(root, dir, 'coal', 'coalledger.json');
}
export function projectConfigPath(cwd = process.cwd(), home = os.homedir()) {
  // root resolved ONCE and shared with both the candidate list and the
  // fallback (CWK-023 correction: calling findProjectRoot twice per read
  // walks the tree twice — a hook-path cost with no benefit).
  const root = findProjectRoot(cwd, home);
  const candidates = candidatesForRoot(root);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  // nothing found anywhere -- READS: behaviour-identical to the old
  // candidates[0] fallback (both this and `.claude` are equally absent, so
  // readJsonc returns {} either way — this change is only observable on a
  // WRITE, where configure.mjs uses this same path as its target).
  return ownDirDefault(root);
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
//   scanEverything   CWK-057, the owner's antivirus-scope law. Boolean gate =
//                    enum of two, same mechanism as docLeak, OPPOSITE polarity:
//                    coalledgerMode/docLeak's factory defaults already SIT at
//                    their own enum's ceiling (board #111's substitution had no
//                    live bite for those two — see the comment on that line).
//                    scanEverything's default (false) sits at the FLOOR instead
//                    — the substitution has REAL bite here: an absent global
//                    genuinely blocks a project's escalation attempt, it is not
//                    a structural-only fix. Direction: `true` is the LOUDER
//                    side (forces report treatment to severityFloor 'low' for
//                    the run, regardless of the configured floor) — MORE
//                    report volume and MORE disclosure a clone-borne project
//                    config did not have the owner's consent to force. That is
//                    the same escalation SHAPE docLeak already guards (a
//                    project unlocking what the global did not permit),
//                    applied here to report size/disclosure-consent instead of
//                    a canary offer — not a scan-file-count blast (this room
//                    has no auto-scan pipeline to bypass; CoalMine's identical
//                    key protects THAT variable, ours protects this one). So
//                    index 0 = 'false'; a project may only quieten toward it,
//                    never escalate past whatever the global (or its schema
//                    default) already permits. One flock, one colour with
//                    CoalMine's scanEverything order/default/name — reached
//                    independently from this room's own variable, not copied.
//                    HONEST CEILING (naming it the way THE CEILING below
//                    already does for severityFloor, so this entry cannot be
//                    over-claimed the moment it lands): this clamp is proven
//                    correct against `mergeSafety` directly, by test — but AS
//                    OF THIS UNIT it has ZERO live readers anywhere. No hook
//                    calls clampedRead(cfg,'scanEverything'); the agent-facing
//                    severityFloor-bypass wiring is a LATER station's to build,
//                    not this one's. SETTLED, same commit, and the answer is
//                    the unhappy one (CWK-057 INSPECT MED-1): that wiring
//                    landed as SKILL.md PROSE — the agent reads this key the
//                    way it reads severityFloor, from instruction text, never
//                    through loadMergedConfig(). So this clamp is OUT OF REACH
//                    on EVERY shipped route, exactly like severityFloor's own:
//                    it is proven correct against mergeSafety by test and
//                    protects nothing any agent actually traverses. Do NOT
//                    read the tests below it as evidence the shipped path is
//                    guarded — they are evidence about mergeSafety alone.
//                    It would become LIVE only if a future reader routes
//                    through loadMergedConfig()/clampedRead(); until then this
//                    is a named gap, never coverage. Kept rather than deleted
//                    because the day such a reader lands, the guard must
//                    already be correct and the direction already argued.
// NOT clamped, and each for its OWN reason — the classifier is BLAST, not type:
//   docsDriftNudge   also a boolean, but it suppresses ONE quiet model-only
//                    line: no offer, no scan, no spend. Re-enabling that in a
//                    single project is a legitimate use, so it stays plain.
//                    (docLeak vs docsDriftNudge is why two booleans must never
//                    share one parenthetical — it hides exactly this asymmetry.)
//   language · publicMode   no consent, spend or outward axis.
//   updateCheckDays  a numeric spend-RATE dial. CONSIDERED AND DECLINED (§9,
//                    2026-07-27): the action it paces is already gated by
//                    `updateMode`, which IS clamped, and clampedRead already
//                    floors the value — a second guard over a bounded cadence
//                    under an already-gated action is the over-hardening
//                    skill-authoring.md §2 forbids. Settled, not open.
// OUT OF REACH — read this as "the clamp CANNOT PROTECT them," never as
// "these keys are locked out." Both are FULLY SETTABLE by a project config,
// with or without a global present — proven at source, not asserted:
// mergeSafety({}, {quickVsFull:'full'}) and mergeSafety({}, {severityFloor:
// 'critical'}) both merge the project value untouched, because neither key
// is inspected by this function at all (CWK-038: a real reader inverted this
// exact block and cut a ticket to "restore settability" to keys that were
// never unsettable — what was missing was PROTECTION, not PERMISSION).
//   `quickVsFull` — CL's real paid-tier dial — is read by the AGENT from
//   the raw project file and never passes through this merge, so no clamp
//   here could protect it even if one were added; the setting is honoured
//   exactly as written. Its OWN backstop is UNCONDITIONAL and run-time, not
//   merely a documented intent: a paid Full-tier scan cannot be reached from
//   a config value alone, across all 7 canaries by THREE separate routes —
//   the 4 mixed-tier canaries (doc-grounding/doc-standard/doc-quality/
//   doc-rot) each carry "Full is always a separate consent" verbatim in
//   their own TIER line; doc-consistency and doc-leak are Full-ONLY and
//   carry their own "paid, always consent-gated" TIER line, so this key
//   never applies to them at all; doc-structure is Quick-only, so the key
//   is inert there too. §9's scope test is "does a HOOK read it?", not "is
//   it consent-bearing?". Named where a reader actually meets it
//   (config-schema.mjs `help:` + the .coalledger.json template), because
//   naming it only here would reach nobody.
//   `severityFloor`  is settable the same way and DOES have real blast (a
//                  cloned repo's project file setting this HIGH silently
//                  narrows what a run reports — a live finding suppressed,
//                  not merely a spend nobody wanted), and it FAILS
//                  mechanism-reach for the same structural reason as
//                  quickVsFull: every reader is the AGENT (the "honor
//                  severityFloor" step in all 7 SKILL.md + commands/stats.md),
//                  never a hook, so this merge never sees it either (U13/M-2).
//                  A clamp here would be coverage that only LOOKS like
//                  coverage (hooks-safety.md §9's THE CEILING) — and clamping
//                  toward the schema default ('low') would also break the
//                  ordinary user who legitimately sets a high floor on their
//                  own noisy repo, since the factory-default rule already
//                  treats an absent global as that same default. THE RULING
//                  RESTS ON THOSE TWO FACTS ALONE — mechanism-reach failure
//                  plus honest-user breakage — and holds regardless of how
//                  strong any mitigation is. The mitigation itself is
//                  honestly WEAKER than quickVsFull's structural one, on two
//                  independent axes (U13 findings-back, CWK-038 MED-1):
//                  it is OPT-IN — `/coalledger:stats` must be run; a user
//                  harmed by a cloned repo's floor sees a clean-looking
//                  report and has no reason to go looking — and EFFECT-BLIND
//                  — stats shows the floor's VALUE, never the count of
//                  findings it withheld, and no SKILL.md instructs the agent
//                  to disclose that either. So the value the user or the
//                  cloned repo wrote stands exactly as written, and the
//                  honest claim is narrower than "inspectable": a narrowed
//                  report is inspectable ON REQUEST, never visible by
//                  default. The residual is stated, not implied covered: a
//                  cloned repo CAN still narrow what it reports this way,
//                  silently, to a user who never thinks to run stats.
const SAFER_ENUM = {
  coalledgerMode: ['off', 'manual', 'auto'], // index 0 = safest
  updateMode: ['off', 'remind', 'ask', 'auto'], // order byte-identical to CM/CW
  docLeak: ['false', 'true'], // boolean gate = enum of two; String()+toLowerCase below makes it work unchanged
  scanEverything: ['false', 'true'], // CWK-057, index 0=safest — see the comment block above for the direction justification and its honest reach ceiling
};
const SAFER_UNION = ['disabledCanaries'];
const SCHEMA_DEFAULT = Object.fromEntries(CONFIG_SCHEMA.map((s) => [s.key, s.def]));

export function mergeSafety(global, project) {
  const out = { ...global, ...project };
  for (const [key, order] of Object.entries(SAFER_ENUM)) {
    if (project[key] === undefined) continue; // nothing to clamp
    // board #111: an ABSENT global is its schema default, never "no preference
    // to defend" (hooks-safety.md §9) — a comment defending the old `continue`
    // was part of the hole it defended. Per-key effect is NOT uniform: updateMode's
    // default ('ask', index 2 of 4) sits BELOW its enum's loudest ('auto'), so this
    // is the real bite — a cloned project can no longer reach 'auto' unclamped when
    // no global exists anywhere. coalledgerMode/docLeak's defaults ('auto' / true)
    // already SIT at their own enum's ceiling, so substituting them here changes no
    // observable output for those two — the fix is still required (closes the
    // mechanism's own hole structurally, holds for any future default change) but
    // has no live bite today for those two keys.
    const effectiveGlobal = global[key] !== undefined ? global[key] : SCHEMA_DEFAULT[key];
    // CASE-FOLD to match the schema's case-insensitive enums (clampedRead
    // lowercases). Comparing raw case let a project 'AUTO'/'Off' miss the
    // lookup (indexOf -> -1) and fall through to the overlay, re-enabling a
    // globally-off skill — CoalWash paid for this one (H5).
    let gi = order.indexOf(String(effectiveGlobal).toLowerCase());
    // board #111 R2 (INSPECT F1/F3/F5, ported from CoalWash's K1 fix,
    // scripts/lib/config-load.mjs:822-848 — narrowed to this room's simpler
    // model: readJsonc already collapses a corrupt global file to {} exactly
    // like an absent one, so no separate "whole file unreadable" state is
    // needed here). Leaving `gi === -1 || pi === -1` as a bare `continue` (the
    // old shape) let the RAW junk value ride into `out[key]` for
    // `clampedRead` to resolve downstream to the SCHEMA DEFAULT, never to the
    // global the user actually set — a project could defeat an EXPLICIT
    // global (`coalledgerMode: 'off'`) with a single typo (`'yes'`, null,
    // `' auto '`), no escalation attempt required. Fixed: an invalid/drifted
    // effective-global value falls back to its schema default's own index,
    // then to 0 (safest) as the unreachable-by-construction last resort — the
    // FALLBACK flag below is what tells the store step this branch, not the
    // user's own raw spelling, decided the outcome.
    let giFromFallback = false;
    if (gi === -1) { gi = order.indexOf(String(SCHEMA_DEFAULT[key]).toLowerCase()); giFromFallback = true; }
    if (gi === -1) { gi = 0; giFromFallback = true; }
    // CASE-FOLD to match the schema's case-insensitive enums (clampedRead
    // lowercases). Comparing raw case let a project 'AUTO'/'Off' miss the
    // lookup (indexOf -> -1) and fall through to the overlay, re-enabling a
    // globally-off skill — CoalWash paid for this one (H5).
    const pi = order.indexOf(String(project[key]).toLowerCase());
    if (pi !== -1 && pi <= gi) {
      out[key] = project[key]; // valid project value at or below the ceiling -> raw spelling preserved (unchanged from before this fix)
    } else if (giFromFallback) {
      // an invalid PROJECT value gets NO say (junk treated as absent) *and*
      // gi itself came from a fallback (the effective global was itself
      // invalid/absent-of-a-valid-member) — store the CANONICAL (order[],
      // lowercase) value here, never a raw invalid spelling: the fallback
      // value has no meaningful "user's own casing" to preserve.
      out[key] = order[gi];
    } else {
      out[key] = effectiveGlobal; // project loses to a genuinely explicit, valid global -> raw spelling preserved (unchanged from before this fix)
    }
  }
  for (const key of SAFER_UNION) {
    // PRECONDITION for any key added here: its schema default must be the
    // EMPTY array (board #111 F6) — an absent global is read as `[]` by the
    // fallthrough below (nothing to union with), so a non-empty default would
    // silently under-protect exactly like the SAFER_ENUM hole this board
    // fixed. `disabledCanaries`'s default is `[]` (config-schema.mjs), holds.
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
