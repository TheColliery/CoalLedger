<div align="center">

# 📒 CoalLedger

> *A working mine keeps two things: the coal and the ledger. The ledger is the written record — and a mine with a wrong ledger is lying to everyone who reads it.* This one keeps your DOCS healthy: **CoalMine for documentation.**

**A docs-health canary suite** — 6+1 canaries that catch the six ways a doc goes bad (wrong · incomplete · stale · contradictory · broken · unreadable, plus config-gated leaked), detection through a vendored CommonMark+GFM AST engine so things that render fine are never flagged, severity judged by context, and fixes always behind a choice-gated menu — never auto-applied.

![version](https://img.shields.io/github/v/tag/TheColliery/CoalLedger?label=version&color=blue)
![license](https://img.shields.io/badge/license-Apache_2.0-blue)
![status](https://img.shields.io/badge/status-beta-orange)

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
| 5 | `doc-structure` | **BROKEN** — links/anchors/headings/tables/refs, via the AST engine | mechanical |
| 6 | `doc-quality` | **UNREADABLE / MALFORMED** — bloat, unclear prose, language mechanics (typo · grammar · spelling · orthography) | semantic + mechanical |
| 7 | `doc-leak` (config-gated) | **LEAKED** — prose-level sensitive content in a public-facing doc; token-shaped secrets stay gitleaks' job | semantic, SUSPECTED-only |

Two tiers, one discipline:

- **Quick** = the mechanical layers — deterministic, ~free, report-only.
- **Full** = the semantic layers — model judgment, paid, always a separate consent.
- **Detection is mechanical; severity never is.** A broken link in an archive is LOW; the same link in an install step is CRITICAL — every finding is judged in context, and CONFIRMED findings are reported separately from SUSPECTED ones (anti-cry-wolf).
- **Fixes are choice-gated.** Every report ends in a menu (apply safe fixes / let me pick / report only); a live doc is never auto-edited.

> [!IMPORTANT]
> CoalLedger checks docs-**HEALTH**, not content correctness. It verifies only what it can fetch or recompute; a claim needing formal verification — a proof, high-precision math, an error-not-allowed decision — escalates to [CoalBoard](https://github.com/TheColliery/CoalBoard). And the AST engine's honest ceiling is **CommonMark+GFM fidelity, not "100% GitHub-pixel fidelity"** — known host-specific quirks are flagged as limits, not silently guessed.

Multilingual by construction: the mechanical layers are language-agnostic (an AST does not care what language the prose is; sections are detected by structure, never an English keyword), and the semantic layers work in the doc's own language, degrading to low-confidence flags — never false alarms — on a poorly-handled one. Cross-language drift between a doc and its translation is a first-class check.

## 🧭 Compatibility

Cross-agent by design — the canaries are plain SKILL.md contracts and the engine is zero-dependency Node scripts any agent can run. The activation ladder is capability-keyed, never a platform table: **has lifecycle hooks** → wire the shipped session-start conductor (Claude Code today) and the canaries offer themselves at the right moment; **no hooks** → best-effort agent-driven (an always-loaded instruction can offer the right canary — probabilistic, not hook parity); **always** → manual (invoke `doc-structure`, `doc-grounding`, … or ask for a docs scan).

## 🚀 Install

**Claude Code** — one command pair (also wires the session-start conductor):

```bash
claude plugin marketplace add TheColliery/CoalLedger
claude plugin install coalledger@coalledger
```

**Other agents** — file-copy: copy `skills/` (the seven canary contracts) and `scripts/lib/` (the AST engine) into your platform's skill directory, keeping the relative layout (each SKILL.md resolves the engine at `../../scripts/lib`). The conductor hook is Claude-Code-only; elsewhere invoke the canaries manually. No API keys, no network, no `npm install`.

## 🔧 Configure

Every tool in the series supports two config levels — a global `~/.claude/.coalledger.json` and a per-project `.coalledger.json` override (project wins) — so a globally-installed skill can be tuned or **shut off per project** (`coalledgerMode: "off"` is the off-switch; a project can also disable single canaries or raise the severity floor instead). The keys:

| Key | Default | What it does |
|---|---|---|
| `coalledgerMode` | `auto` | Master switch: `auto` = session-start conductor offers the canaries · `manual` = conductor silent, invoke canaries yourself · `off` = fully silent |
| `language` | `auto` | Language for prompts and reports (`auto` \| `th` \| `en` \| `ja` \| `zh` \| `es`); technical terms stay verbatim |
| `disabledCanaries` | `[]` | Canary names to disable (e.g. `["doc-quality"]`); `"conductor"` or `"all"` silences the conductor entirely |
| `severityFloor` | `low` | Report findings at or above this severity (judged by context, never mechanically) |
| `quickVsFull` | `quick` | Default scan tier for mixed canaries: `quick` = mechanical only (~free) · `full` = adds the semantic layer (paid; always a separate consent) |
| `docLeak` | `true` | The #7 doc-leak canary's gate — a private-only project (docs never published) turns it off |
| `publicMode` | `false` | Treat this project's docs as public-facing (raises leak/grounding stakes in severity context) |
| `updateMode` | `ask` | Self-update behavior at session start (`ask` \| `auto` \| `remind` \| `off`) |
| `updateCheckDays` | `14` | Days between self-update checks/reminders |

Full key reference: every key + default lives in [`scripts/lib/config-schema.mjs`](scripts/lib/config-schema.mjs) and the commented template [`platform-configs/.coalledger.json`](platform-configs/.coalledger.json).

## 📊 Benchmark

Not yet measured — CoalLedger launches unbenchmarked rather than with an invented number. The engine's mechanical layer is fixture-gated in-repo (planted defects found, clean decoys silent — `scripts/verify.mjs` runs it); the first published benchmark (recall on seeded doc-defect fixtures, canary-by-canary, dated + versioned) will live at [`TheColliery/.github/benchmarks`](https://github.com/TheColliery/.github/tree/main/benchmarks) like every sibling's.

## 🧭 Part of TheColliery

CoalLedger is the **docs-health** member of the mining series, alongside [CoalMine](https://github.com/HetCreep/CoalMine) (quality canaries), [CoalTipple](https://github.com/TheColliery/CoalTipple) (model/effort routing), [CoalBoard](https://github.com/TheColliery/CoalBoard) (consensus & debate), [CoalHearth](https://github.com/TheColliery/CoalHearth) (session warm-resume), [CoalFace](https://github.com/TheColliery/CoalFace) (fan-out discipline), and [CoalWash](https://github.com/TheColliery/CoalWash) (memory defrag). CoalMine + CoalLedger form the broad, cheap health layer (code + docs); CoalBoard is the deep verify they escalate the error-not-allowed slice to. Install one and it stands alone; install all and they compose without conflict. Shared doctrine: Phoenix-13 hooks (zero-dependency, no network, fail-silent), single-source-of-truth config schemas, consent-gated spend, and a strict no-overkill discipline. Series doctrine: [`TheColliery/.github`](https://github.com/TheColliery).

Zero-dependency, offline by default, no API keys.

---

## 📄 License

Apache License 2.0. See [LICENSE](LICENSE).
