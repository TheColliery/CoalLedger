#!/usr/bin/env node
'use strict';
// CoalLedger SessionStart conductor (Phoenix-13 hook: fail-silent, zero-dep,
// no network, no spawn, never process.exit — hooks-safety.md). Injects the
// docs-health offer rules so the suite drives itself: the user remembers no
// commands, the agent offers the right doc canary on domain entry, and every
// costly action asks first.
//
// The full 6+1 canary set is live (blueprint §1/§8). Lines stay TERSE — this
// directive is paid every session (skill-authoring §1); the shared offer rules
// live ONCE in HEAD/TAIL, each canary line only names its niche. doc-leak is
// additionally gated by the `docLeak` config key (blueprint §8: default on,
// a private-only project turns it off).
//
// Docs have NO chokepoint (SKILL-REPO-PATTERN Layer 8): they are not loaded
// per-session, so coverage is the gold-standard 3-motion shape — install-scan
// the past + trigger on the present (this conductor's domain-entry offers) +
// template-bind the future. A Stop-hook auto-quick SCAN on touched doc files is
// still a later phase — note the shipped Stop hook (coalledger-drift-stop.js) is
// NOT it: that one is the quiet non-canary memory-drift advisory, and the scan
// tier must never be welded onto its channel (blueprint §5).
//
// The engine lives in ../scripts/lib/*.mjs (ESM) — dynamically imported so
// this CJS hook and the agent-invoked scripts share ONE config implementation
// (a hook that reimplements config-load silently diverged once in a sibling;
// never again).
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const DAY_MS = 86400000;

// The 6+1 canary map (blueprint §1 + §8). doc-leak also rides the docLeak
// config gate (checked in main).
const CANARIES = [
  { name: 'doc-structure', line: '- doc-structure (mechanical, ~free): broken links/anchors · heading hierarchy · duplicate sibling headings · table shape · orphan/undefined refs · bare URLs · image alt text (SUSPECTED-only, no toggle) — run the AST engine the way its skill contract states (the skill ships it beside itself), never re-derive by eye.' },
  { name: 'doc-grounding', line: '- doc-grounding (semantic + mechanical recompute): doc claims vs their source of truth (code · data · original text · reality); offline degrades to "⚠️ unverified", never a guess.' },
  { name: 'doc-standard', line: '- doc-standard (semantic + mechanical): missing/incomplete vs the doc kind\'s standard (required sections, undocumented public surface).' },
  { name: 'doc-rot', line: '- doc-rot (mechanical age-markers + semantic): stale versions/dates/badges, dead TODOs, superseded instructions.' },
  { name: 'doc-consistency', line: '- doc-consistency (semantic): docs contradicting each other, terminology drift, cross-language drift.' },
  { name: 'doc-quality', line: '- doc-quality (semantic + mechanical): bloat, unclear prose, language mechanics (typo/grammar/spelling/orthography).' },
  { name: 'doc-leak', gated: 'docLeak', line: '- doc-leak (semantic, SUSPECTED-only — the human judges): prose-level sensitive content in a public-facing doc (internal URLs, personal data, unpublished plans). Token-shaped secrets stay gitleaks\' job.' },
];

const HEAD = '[CoalLedger] docs-health canary suite installed (6+1 doc canaries). Conduct it (answer in the USER\'S language; offer via your question tool; never auto-run costly work without a chosen option):\n- Domain entry: when the user edits or discusses a README, doc, spec, or translation file, OFFER the most relevant canary ONCE per session (Run now / Queue for later / Skip). Mechanical layers are ~free and report-only; semantic (Full) layers are paid — always a separate consent. Severity is judged by CONTEXT, never mechanically. The set:';
const TAIL = [
  '- Honor every .coalledger.json override if present (the installed commented file documents all keys).',
  '- Self error-report: if a CoalLedger component misbehaves, OFFER to file it at https://github.com/TheColliery/CoalLedger/issues with a user-reviewed summary — never auto-submit.',
];

function lib(name) {
  return pathToFileURL(path.join(__dirname, '..', 'scripts', 'lib', name)).href;
}

// Self-update scheduling (series-standard kind-1, the CoalMine/CoalWash GOLD
// shape): the HOOK only SCHEDULES via a throttled crash-safe stamp — written
// BEFORE the directive prints so a crash never re-nags; no network ever. The
// AGENT verifies + offers, consent-gated.
function updateDue(cfg, clampedRead) {
  try {
    if (clampedRead(cfg, 'updateMode') === 'off') return false;
    const days = clampedRead(cfg, 'updateCheckDays');
    const stamp = path.join(os.homedir(), '.claude', '.coalledger-update-check');
    let last = 0;
    try { last = Number(String(fs.readFileSync(stamp, 'utf8')).trim()) || 0; } catch {}
    const now = Date.now();
    if (last && now - last < days * DAY_MS) return false;
    try { fs.mkdirSync(path.dirname(stamp), { recursive: true }); fs.writeFileSync(stamp, String(now)); } catch {}
    return true;
  } catch { return false; }
}

// Shared offer assembly — ONE text source for the CC SessionStart path below
// AND the Antigravity adapter (hooks/ag-conductor.js, which require()s this;
// the CoalFace/CoalHearth shared-core one-flock pattern — a re-typed offer list
// silently diverged once in a sibling; never again). Returns null when the
// conductor is gated fully off (mode off / disabledCanaries conductor|all),
// else the offer lines ([] in manual mode — offers silent; callers append
// their own platform-specific lines, e.g. the CC self-update nudge).
function buildOffers(cfg, clampedRead) {
  const mode = clampedRead(cfg, 'coalledgerMode');
  if (mode === 'off') return null; // fully silent
  const disabled = clampedRead(cfg, 'disabledCanaries');
  if (disabled.includes('conductor') || disabled.includes('all')) return null;
  const out = [];
  // Canary offers only in auto; manual keeps them silent but callers may still
  // emit their own lines (the CC path's self-update scheduler — standard
  // system #3 is orthogonal to the conductor offers).
  if (mode === 'auto') {
    const offers = CANARIES
      .filter((c) => !disabled.includes(c.name) && (!c.gated || clampedRead(cfg, c.gated) === true))
      .map((c) => c.line);
    if (offers.length) out.push(HEAD, ...offers, ...TAIL);
  }
  return out;
}

// The language-lock trailer (null when language is 'auto') — shared with the AG
// adapter so the user-visible wording can never fork between platforms.
function languageLine(language) {
  if (language === 'auto') return null;
  return `[CoalLedger] (language=${language} — deliver user-facing prose in that language; keep technical terms, commands, and paths verbatim)`;
}

async function main() {
  const [{ loadMergedConfig }, { clampedRead }] = await Promise.all([
    import(lib('config-load.mjs')),
    import(lib('config-schema.mjs')),
  ]);

  const cfg = loadMergedConfig();
  const out = buildOffers(cfg, clampedRead);
  if (!out) return; // off / disabled — silent, no update scheduling either

  if (updateDue(cfg, clampedRead)) {
    out.push('[CoalLedger] [self-update due] Offer the update check: web-check the latest CoalLedger tag vs the installed plugin.json version; if newer, OFFER `claude plugin update coalledger@coalledger`; if current, say "up to date"; if git/network is unavailable, say so and suggest updating manually later (never assume). Consent-gated; the hook only scheduled it.');
  }

  if (out.length) {
    const lang = languageLine(clampedRead(cfg, 'language'));
    if (lang) out.push(lang);
    console.log(out.join('\n')); // sanctioned SessionStart context-injection channel (Phoenix #13)
  }
}

// Shared pieces for the AG adapter (require.main gate below keeps requiring
// this module side-effect-free — the CC path runs only when invoked directly).
module.exports = { buildOffers, languageLine, lib };

if (require.main === module) {
  main().catch(() => {
    // Phoenix #4: fail-silent, never throw, never crash the parent agent.
  });
}
// No process.exit() — Phoenix #4 (would truncate the sanctioned stdout write above).
