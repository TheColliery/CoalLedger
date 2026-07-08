---
name: doc-grounding
description: >-
  Docs-health grounding scan — doc claims verified against their SOURCE OF TRUTH: the code (README-vs-code, docstring params, examples that must run), the data (figures, tables, cited records), an original text (a rendering such as a translation, summary, or quote vs what it renders), or reality (versions, dates, external facts — verified REAL-TIME against MULTIPLE authoritative sources). Catches WRONG docs: fabricated claims, stale assertions, numbers that do not recompute. Triggers on: "/doc-grounding", "doc-grounding", "does the doc match the code", "verify doc claims", "fact-check this doc". Semantic (consent-gated Full) plus a cheap mechanical recompute layer (stated arithmetic, unit sanity). Offline or unverifiable degrades safe to "⚠️ unverified" — never a guess. Severity judged by context, never mechanical; claims needing formal verification escalate to CoalBoard.
---

# Doc-Grounding

Answer in the USER'S language; keep technical terms, commands, paths, and check ids verbatim.

Verify that a doc's claims match their source of truth. Report CONFIRMED mismatches only; never assert what you could not verify.

## Parameters
- **SCOPE:** named files (default when given) | touched doc files this session | whole repo docs (confirm first if > 20 files).
- **TIER:** Quick = mechanical recompute only (~free, deterministic) · Full = semantic claim-by-claim verification (paid). Default from `.coalledger.json` `quickVsFull`; Full is always a separate consent.

## Source of truth (general — pick per claim, never assume one kind)
| claim about | source of truth |
|---|---|
| behavior / API / config | the code (read it; run an example only when cheap, safe, and consented) |
| figures / tables / results | the data or record it cites (compare verbatim) |
| a rendering of another text (translation, summary, quote) | the original text |
| external facts (versions, dates, prices, identifiers) | live authoritative sources — REAL-TIME and MULTI-source (cross-check several, never trust one), language-aware (fetch a source in the claim's language, or translate the claim to check it) |

## Method
1. **Extract** checkable claims (assertions a source can confirm or refute — skip opinions and intent).
2. **Verify** each against its source per the table. Mechanical layer first: RECOMPUTE stated arithmetic and unit/dimension sanity — deterministic, catches "2+2=5" for free.
3. **Degrade safe:** offline, source unreachable, or low-confidence language → mark `⚠️ unverified: check [source]`. NEVER report an unverified claim as CONFIRMED; never fill the gap from memory.
4. **Severity by CONTEXT** (never a fixed map), then honor `severityFloor`: a wrong security or install instruction = CRITICAL; doc ≠ source on a surface readers actively rely on = HIGH; a stale minor claim = MEDIUM; cosmetic = LOW. `publicMode: true` raises the stakes of public-facing docs.

## Escalation boundary (health ≠ correctness)
This canary verifies only what it can FETCH or RECOMPUTE. A claim needing formal verification — a proof, high-precision math, any error-not-allowed decision — is flagged and ESCALATED to CoalBoard (`/coalboard`), never adjudicated here.

## Output
| # | path:line | claim | source checked | verdict | severity | fix |

CONFIRMED table only; `⚠️ unverified` and SUSPECTED go to separate lists, never the main table.

## Fix mode (choice-gated)
After any report in an interactive session you **MUST** present this menu via your question tool (skip only when findings are zero or no user is present). NEVER auto-fix a live doc.

- **Apply safe fixes:** only corrections the source states unambiguously (a version string, a figure copied wrong). Each fix: checkpoint (git stash/commit in a git repo; else copy the file aside — never assume git exists) -> apply -> re-read the changed lines -> revert on doubt.
- **Let me pick:** list findings; the user selects.
- **Report only:** exit unchanged.

NEVER auto-fix: any case where the DOC could be right and the source stale, any rewording of meaning, anything the source states ambiguously — offer options instead.

## Multilingual
The recompute layer is language-agnostic. Semantic verification works in the doc's own language; a language handled poorly degrades to low-confidence `⚠️ unverified` flags, never false alarms. A claim in one language with its source in another is verified cross-language (translate the claim, or fetch a language-matched source).

## Problem report
If this canary misbehaves, OFFER to file it at <https://github.com/TheColliery/CoalLedger/issues> with a user-reviewed summary — never auto-submit.
