<div align="center">

# 📒 CoalLedger

> *A working mine keeps two things: the coal and the ledger. The ledger is the written record — and a mine with a wrong ledger is lying to everyone who reads it.* This one keeps your DOCS healthy: **CoalMine for documentation.**

**A docs-health canary suite** — 6+1 canaries that catch the six ways a doc goes bad (wrong · incomplete · stale · contradictory · broken · unreadable, plus config-gated leaked), structure detection through a vendored CommonMark+GFM AST engine so things that render fine are never flagged, severity judged by context, and fixes always behind a choice-gated menu — never auto-applied.

![version](https://img.shields.io/github/v/tag/TheColliery/CoalLedger?label=version&color=blue)
![license](https://img.shields.io/badge/license-Apache_2.0-blue)
![status](https://img.shields.io/badge/status-beta-orange)

![Claude Code: validated](https://img.shields.io/badge/Claude_Code-validated-brightgreen)
![Antigravity: works with](https://img.shields.io/badge/Antigravity-works_with-blue)
![Cursor: works with](https://img.shields.io/badge/Cursor-works_with-blue)
![Codex: works with](https://img.shields.io/badge/Codex-works_with-blue)
![Gemini CLI: works with](https://img.shields.io/badge/Gemini_CLI-works_with-blue)
![Cline: works with](https://img.shields.io/badge/Cline-works_with-blue)
![Copilot: works with](https://img.shields.io/badge/Copilot-works_with-blue)
![claude.ai: works with](https://img.shields.io/badge/claude.ai-works_with-blue)

[Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md) · [Releases](https://github.com/TheColliery/CoalLedger/releases)

**Part of [TheColliery](https://github.com/TheColliery)** — siblings: **[CoalMine](https://github.com/HetCreep/CoalMine)** (quality canaries) · **[CoalTipple](https://github.com/TheColliery/CoalTipple)** (model/effort routing) · **[CoalBoard](https://github.com/TheColliery/CoalBoard)** (consensus board) · **[CoalHearth](https://github.com/TheColliery/CoalHearth)** (warm-resume) · **[CoalFace](https://github.com/TheColliery/CoalFace)** (fan-out discipline) · **[CoalWash](https://github.com/TheColliery/CoalWash)** (memory defrag).

</div>

---

## 📒 What it is

Code has linters, tests, and CI; docs mostly have hope. A README that drifted from the code, a translated doc that stopped matching its counterpart, a dead install link, a stale version badge — each is silent breakage a reader trusts. CoalLedger is the docs-side mirror of [CoalMine](https://github.com/HetCreep/CoalMine)'s code canaries: a cheap, always-available health scan for ANY document — a README, a spec, a report, a translation — not just developer docs. The source of truth a doc is checked against is whatever it renders: the code, the data, an original text, or reality.

## ⚙️ How it works

Seven canaries, one distinct failure mode each:

| # | Canary | Catches | Layer |
|---|---|---|---|
| 1 | `doc-grounding` | **WRONG** — claims ≠ their source of truth (code · data · original text · reality); verified real-time, multi-source; offline degrades to `⚠️ unverified` | semantic + mechanical recompute |
| 2 | `doc-standard` | **INCOMPLETE** — missing vs the doc kind's standard (required sections, undocumented public surface) | semantic + mechanical |
| 3 | `doc-rot` | **STALE** — old versions/dates/badges, dead TODOs, superseded instructions | mechanical age-markers + semantic |
| 4 | `doc-consistency` | **CONTRADICTORY** — docs disagreeing, terminology drift, cross-language drift | semantic |
| 5 | `doc-structure` | **BROKEN** — links/anchors/headings/tables/refs/image-alt, via the AST engine | mechanical |
| 6 | `doc-quality` | **UNREADABLE / MALFORMED** — bloat, unclear prose, language mechanics (typo · grammar · spelling · orthography) | semantic + mechanical |
| 7 | `doc-leak` (config-gated) | **LEAKED** — prose-level sensitive content in a public-facing doc; token-shaped secrets stay gitleaks' job | semantic, SUSPECTED-only |

Two tiers, one discipline:

- **Quick** = the mechanical layers — deterministic, ~free, report-only.
- **Full** = the semantic layers — model judgment, paid, always a separate consent.
- **Where a mechanical layer exists, detection is deterministic; severity never is** (two canaries — `doc-consistency`, `doc-leak` — are semantic-only, no mechanical layer at all). A broken link in an archive is LOW; the same link in an install step is CRITICAL — every finding is judged in context, and CONFIRMED findings are reported separately from SUSPECTED ones (anti-cry-wolf).
- **Fixes are choice-gated.** Every report ends in a menu (apply safe fixes / let me pick / report only); a live doc is never auto-edited.

> [!IMPORTANT]
> CoalLedger checks docs-**HEALTH**, not content correctness. It verifies only what it can fetch or recompute; a claim needing formal verification — a proof, high-precision math, an error-not-allowed decision — escalates to [CoalBoard](https://github.com/TheColliery/CoalBoard). And the AST engine's honest ceiling is **CommonMark+GFM fidelity, not "100% GitHub-pixel fidelity"** — known host-specific quirks are flagged as limits, not silently guessed.

Multilingual by construction: the mechanical layers are language-agnostic — never an English keyword — by structure, position, and meaning; `doc-structure` reads that structure off its AST, the other mechanical layers off an agent's own read of the doc. The semantic layers work in the doc's own language, degrading to low-confidence flags — never false alarms — on a poorly-handled one. Cross-language drift between a doc and its translation is a first-class check.

### Docs memory-drift reminder

Separate from the canaries — it scans nothing and reports nothing. If documentation files (`.md` `.mdx` `.markdown` `.rst` `.txt` `.adoc` `.asciidoc` `.org`) were edited but `MEMORY.md` has not been updated this session, CoalLedger emits **one quiet reminder** (`systemMessage` — reaches the session transcript and an interactive user) when the agent finishes responding: no findings, no fix menu, and it never blocks. Update `MEMORY.md` once and it stays quiet for the rest of the session. It fires only where the project uses the `MEMORY.md` convention (a `MEMORY.md` at the project root), and `docsDriftNudge: false` silences it. Capability-keyed like everything else here — it needs a Stop hook with a surfaced-message output, which today means Claude Code (Antigravity's engine documents no such channel).

This is the DOCS half of a pair: [CoalMine](https://github.com/HetCreep/CoalMine)'s `memoryDriftNudge` covers CODE edits, CoalLedger's covers DOC edits. The two watch disjoint file extensions, and a single `MEMORY.md` update satisfies both.

## 🧭 Compatibility

Cross-agent by design — the canaries are plain SKILL.md contracts and the engine is zero-dependency Node scripts any agent can run. The activation ladder is capability-keyed, never a platform table: **has lifecycle hooks** → wire the shipped session-start conductor (Claude Code — validated; Antigravity — works with, via a ported adapter that is built and hermetically tested but has not yet run end-to-end live) and the canaries offer themselves at the right moment; **no hooks** → best-effort agent-driven (an always-loaded instruction can offer the right canary — probabilistic, not hook parity); **always** → manual (invoke `doc-structure`, `doc-grounding`, … or ask for a docs scan).

Support tiers, honestly labeled — **`validated`** (a real end-to-end run has happened) or **`works with`** (built for it, not yet proven there): **Claude Code — validated** (live plugin, launched + dogfooded 2026-07-09) · **every other platform — works with** (Antigravity's conductor offers ride AG 2.0's `PreInvocation` hook through a ported adapter, built and hermetically tested against the current AG contract — see Install for the wiring caveat — but no live AG session has run it end-to-end yet; every other skill-reading platform needs only the file-copy install below, since read/analyze canaries need a platform that reads SKILL.md — none has been run end-to-end there either, so no higher claim exists anywhere but Claude Code). Gemini CLI is business-tier only (Standard/Enterprise — individual tiers ended 2026-06-18).

## 🚀 Install

**Claude Code** — one command pair (also wires the session-start conductor and the quiet docs memory-drift reminder):

```bash
claude plugin marketplace add TheColliery/CoalLedger
claude plugin install coalledger@coalledger
```

**Antigravity** — file-copy: copy the built skill folders from [`plugin/skills/`](plugin/skills) into `~/.gemini/config/skills/` (global) or `<workspace>/.agents/skills/` (project). Each folder is self-contained — `doc-structure` carries the AST engine beside itself in its own `lib/`, so nothing else has to travel with it. (Copy from `plugin/skills/`, not the repo's `skills/`: the latter holds the contracts only, without the engine.)

**Auto conductor on AG (works with — live AG validation pending):** AG 2.0 shipped a real hook engine, so the canary offers can ride Antigravity's `PreInvocation` too, through [`hooks/ag-conductor.js`](hooks/ag-conductor.js) (requires its sibling [`hooks/coalledger-conductor.js`](hooks/coalledger-conductor.js) — one offer text for both platforms). The conductor is the one piece that needs more than a skill folder: copy `hooks/` **and** `scripts/lib/` side by side (the hooks resolve the shared config library at `../scripts/lib`), then copy [`platform-configs/hooks.json`](platform-configs/hooks.json) into place and replace `__COALLEDGER_DIR__` with the directory holding them. **Known caveat:** the wire location itself regressed on an AG update (2026-07-12 → 07-16) — the two previously-documented locations (global `~/.gemini/config/hooks.json`, project `<workspace>/.agents/hooks.json`) stopped executing, and the AG state dir moved — so re-derive the current hooks.json location from AG's own docs before wiring (the template carries the same note). Wiring at a dead path is inert-harmless: the adapter simply never runs, and manual canary invocation is unaffected either way. Once wired, the directive fires at most once per session; delivery into the agent is not yet live-validated. The self-update nudge is deliberately not ported (its payload is Claude-Code plugin machinery); on AG, update by re-copying.

**Other agents** — the same file-copy from `plugin/skills/` into your platform's skill directory. No `install.mjs` step — the canaries are plain SKILL.md contracts over the zero-dep engine.

**claude.ai** — read/analyze skills (like CoalLedger's canaries) upload as a custom skill. **Don't hand-zip `plugin/skills/` yourself** — our own frontmatter `description` runs up to 895 chars, well past claude.ai's 200-char skill-listing cap, so a hand-zipped folder is not guaranteed to work there. Download the right ZIP instead from the [Releases page](https://github.com/TheColliery/CoalLedger/releases) (one asset per canary, built by CI on every version tag, with its description deterministically trimmed to fit — source `skills/*/SKILL.md` is never edited) and add it in claude.ai's skill settings (paid plan with code execution on). Each Release also carries a `SHA256SUMS.txt` covering every ZIP — verify with `sha256sum --ignore-missing -c SHA256SUMS.txt` (you'll typically have just one of the seven canaries' ZIPs, and plain `-c` reports the other six as FAILED). Per-surface — an upload doesn't sync across surfaces.

The conductor hook wires automatically on Claude Code (validated) and, once you complete the AG wiring above, on Antigravity (works with, pending live validation); every other surface runs the canaries **manually** (invoke `doc-structure`, `doc-grounding`, … or ask for a docs scan). No API keys, no network, no `npm install`.

## Commands

| Command | What it does |
|---|---|
| `/coalledger:doc-structure` | Runs one doc canary on the files you name. The other six take the same form — `/coalledger:doc-grounding`, `/coalledger:doc-standard`, `/coalledger:doc-rot`, `/coalledger:doc-consistency`, `/coalledger:doc-quality`, `/coalledger:doc-leak` — and what each one catches is the table in [How it works](#️-how-it-works). |
| `/coalledger:stats` | Reports the scans run and findings this session by canary and severity, plus which canaries are enabled here and at what severity floor. Read-only, session-local. |
| `/coalledger:update` | Checks for a newer CoalLedger version and offers to apply it, or sets how updates are handled. |

Slash commands are the Claude Code form. Everywhere else the canaries are invoked the way your agent invokes a skill — by name (`doc-structure`, `doc-grounding`, …) or by just asking for a docs scan.

## 🔧 Configure

Every tool in the series supports two config levels — a global `~/.claude/.coalledger.json` and a per-project config, resolved in this order (first found wins): `.claude/coal/coalledger.json` (the running agent's own dir — the config loader takes no agent-identity signal, so this always collapses onto `.claude` regardless of whether Claude Code or the ported Antigravity adapter is running) → other known agent dirs, `.agents/coal/coalledger.json` → `.gemini/coal/coalledger.json` → LEGACY: a root `.coalledger.json` (the pre-2026-08-08 shape, still read, no breakage) — so a globally-installed skill can be tuned or **shut off per project** (`coalledgerMode: "off"` is the off-switch; a project can also disable single canaries or raise the severity floor instead) — a skill you don't need in a given project stops loading (and burning tokens) there. Write with `node scripts/configure.mjs <flags>` (the project config) or `--global <flags>` (the global layer); a write lands back wherever the config was found, except a config sitting at the LEGACY root path migrates to the project's own agent-dir home on that write (the old file removed). A project with no config anywhere yet gets the first agent dir it **already has** on disk (`.claude` → `.agents` → `.gemini`) — never a bare `.claude` planted ahead of an `.agents`/`.gemini` dir that already exists; a project with NONE of the three still gets `.claude`, the same default it got before this fix. Nothing is ever auto-moved on a mere read. The keys:

| Key | Default | What it does |
|---|---|---|
| `coalledgerMode` | `auto` | Conductor switch: `auto` = session-start conductor offers the canaries · `manual` = the conductor stays silent, invoke canaries yourself · `off` = the conductor never runs. (Orthogonal: the self-update nudge has its own switch — `updateMode: "off"` — so `manual` silences the *canary offers*, not the periodic update check.) |
| `language` | `auto` | Language for prompts and reports (`auto` \| `th` \| `en` \| `ja` \| `zh` \| `es`); technical terms stay verbatim |
| `disabledCanaries` | `[]` | Canary names to disable (e.g. `["doc-quality"]`); `"conductor"` or `"all"` silences the conductor entirely |
| `severityFloor` | `low` | Report findings at or above this severity (judged by context, never mechanically) |
| `scanEverything` | `false` | Bypass `severityFloor` for this run — report everything down to `low` (does not re-enable a disabled canary, and does not force `quickVsFull` to `full`). An agent-followed instruction, not a code-enforced gate — CoalLedger has no automatic scan-scope cut to bypass in the first place |
| `quickVsFull` | `quick` | Default scan tier for mixed canaries: `quick` = mechanical only (~free) · `full` = adds the semantic layer (paid; always a separate consent) |
| `docLeak` | `true` | The #7 doc-leak canary's gate — a private-only project (docs never published) turns it off |
| `publicMode` | `false` | Treat this project's docs as public-facing (raises leak/grounding stakes in severity context) |
| `docsDriftNudge` | `true` | The off-switch for the quiet [docs memory-drift reminder](#docs-memory-drift-reminder); set `false` to silence it |
| `updateMode` | `ask` | Self-update behavior at session start (`ask` \| `auto` \| `remind` \| `off`) |
| `updateCheckDays` | `14` | Days between self-update checks/reminders |

Full key reference: every key + default lives in [`scripts/lib/config-schema.mjs`](scripts/lib/config-schema.mjs) and the commented template [`platform-configs/.coalledger.json`](platform-configs/.coalledger.json) — or run `node scripts/configure.mjs --help` (every flag, value and default derive from that same schema table, so a key added there is settable and documented from one source).

## Permissions

**Reads** the docs you name (plus the files their links point at, to verify those links) and your `.coalledger.json`. **The installed skill writes only its own scratch:** two session files in your temp dir, a self-update date stamp under `~/.claude/`, and on Antigravity a once-per-session marker — this is everything the canaries themselves ever touch, and none of it is a doc or a config file. **Runs up to three things locally:** the bundled zero-dependency AST engine (`node ./lib/md-checks.mjs`, read-only), a `git stash`/commit checkpoint before any fix (a file copy where git is absent), and — only if you consent — a documented example a doc claims works.

**A repo checkout adds one more writer, outside the installed skill: `scripts/configure.mjs`** (the config CLI above) is not part of the plugin you install — it ships from no `DIST_ITEM`, so an installed-only user never receives it. Run from a checkout, it writes the project (or, with `--global`, the global) `.coalledger.json` to the value you pass, and — only when migrating a legacy-location config to its new home — deletes the old file after the new one is written. It never touches a doc.

**Never edits a doc on its own.** Every fix is a choice-gated menu item you pick, and CoalLedger spawns no subagents, so nothing runs with more power than the session you started. **Network is opt-in only:** the paid Full tier's real-time source verification (doc-grounding, doc-standard) and the self-update check, each consented separately — offline they degrade to `⚠️ unverified`, never a guess.

Full series matrix + the must-fail set: [Permission Matrix](https://github.com/TheColliery/.github/blob/main/PERMISSION-MATRIX.md)

## 📊 Benchmark

Not yet measured — CoalLedger launches unbenchmarked rather than with an invented number. The engine's mechanical layer is fixture-gated in-repo (planted defects found, clean decoys silent — `scripts/verify.mjs` runs it); the digest at [`benchmarks/CoalLedger/RESULTS.md`](https://github.com/TheColliery/.github/blob/main/benchmarks/CoalLedger/RESULTS.md) will fill in from the first dated, versioned run (recall on seeded doc-defect fixtures, canary-by-canary), like every sibling's.

## 🧭 Part of TheColliery

CoalLedger is the **docs-health** member of the mining series:

- [CoalMine](https://github.com/HetCreep/CoalMine) — quality canaries
- [CoalTipple](https://github.com/TheColliery/CoalTipple) — model/effort routing
- [CoalBoard](https://github.com/TheColliery/CoalBoard) — consensus & debate
- [CoalHearth](https://github.com/TheColliery/CoalHearth) — session warm-resume
- [CoalFace](https://github.com/TheColliery/CoalFace) — fan-out discipline
- [CoalWash](https://github.com/TheColliery/CoalWash) — memory defrag

Install one, it stands alone; install all, they compose without conflict. CoalMine + CoalLedger form the broad, cheap health layer (code + docs); CoalBoard is the deep verify they escalate the error-not-allowed slice to.

Shared doctrine: Phoenix-13 hooks (zero-dependency, no network, fail-silent), single-source-of-truth config schemas, consent-gated spend, and a strict no-overkill discipline. Series doctrine: [`TheColliery/.github`](https://github.com/TheColliery/.github).

Zero-dependency, offline by default, no API keys — "by default" because the consent-gated Full tier's source verification (doc-grounding, doc-standard) and the self-update check go online; the hooks and the engine never do.

---

## 📄 License

Apache License 2.0. See [LICENSE](LICENSE).
