---
name: doc-rot
description: >-
  Docs-health staleness scan — content that time has made false: version strings older than the shipped version, dates and "last updated" stamps long past, stale badges, dead TODO/FIXME/"coming soon" markers, superseded instructions (steps for a surface that has since changed or gone), revalidate-by dates that have passed. Catches STALE docs — was true once, is not now. Triggers on: "/doc-rot", "doc-rot", "stale docs", "outdated docs", "is this doc still current". Mechanical layer = deterministic age-markers (versions, dates, TODO markers, badges — ~free, report-only); semantic layer = judging whether a flagged marker is actually rotten and spotting undated superseded content (paid, consent-gated). Severity judged by context, never mechanical; CONFIRMED and SUSPECTED reported separately.
---

# Doc-Rot

Answer in the USER'S language; keep technical terms, commands, paths, and check ids verbatim.

Find doc content that time has invalidated. Report CONFIRMED rot; park the merely-old in SUSPECTED.

## Parameters
- **SCOPE:** named files (default when given) | touched doc files this session | whole repo docs (confirm first if > 20 files).
- **TIER:** Quick = mechanical age-markers only (~free) · Full = semantic staleness judgment (paid). Default from `.coalledger.json` `quickVsFull`; Full is always a separate consent.

## Age-markers (mechanical layer — deterministic detection)
| marker | signal |
|---|---|
| version string | doc names a version older than the project's current one (compare against the version's source of truth, e.g. the manifest) |
| date stamp | a "last updated" / revalidate-by / verified-on date far in the past or already passed |
| dead task marker | TODO / FIXME / "coming soon" / "not yet" with no sign of life |
| stale badge | a hardcoded status/version badge the repo state contradicts |

Detection is deterministic; whether a marker means ROT is not — an old date on an archive is fine, on an install guide it is not.

## Method
1. **Quick:** collect age-markers per the table. Old ≠ rotten: a marker alone lands in SUSPECTED.
2. **Full:** judge each marker in context, and hunt UNDATED rot — instructions for a surface that has changed, claims a later doc superseded (pure contradiction between live docs belongs to doc-consistency; rot is the time axis).
3. **Confirm before CONFIRMED:** a finding is CONFIRMED only when the current state contradicts the doc (the version source names a newer version; the referenced surface is gone). Anything inferred stays SUSPECTED.
4. **Severity by CONTEXT** (never a fixed map), then honor `severityFloor`: rotten install/security steps readers follow = HIGH-CRITICAL; a stale badge or version mention = MEDIUM; an old date in an archived doc = LOW.

## Escalation boundary
Whether a claim was EVER true is doc-grounding's job; formal verification of a high-stakes claim escalates to CoalBoard (`/coalboard`). This canary only answers "did time break it".

## Output
| # | path:line | marker | evidence (current state) | severity | fix |

CONFIRMED table only; SUSPECTED (old-but-unproven) as a separate list, never the main table.

## Fix mode (choice-gated)
After any report in an interactive session you **MUST** present this menu via your question tool (skip only when findings are zero or no user is present). NEVER auto-fix a live doc.

- **Apply safe fixes:** only updates whose current value is unambiguous (bump a version string to the manifest's, refresh a date the user confirms, delete a TODO the user confirms dead). Each fix: checkpoint (git stash/commit in a git repo; else copy the file aside — never assume git exists) -> apply -> re-read the changed lines.
- **Let me pick:** list findings; the user selects.
- **Report only:** exit unchanged.

NEVER auto-fix: rewriting superseded instructions (a content decision), deleting sections, anything whose current truth you did not verify.

## Multilingual
Age-markers are language-agnostic (versions, dates, and badges look the same in any prose language; date FORMATS vary — parse by structure, not an English month name). Semantic judgment degrades to low-confidence flags on a poorly-handled language, never false alarms.

## Problem report
If this canary misbehaves, OFFER to file it at <https://github.com/TheColliery/CoalLedger/issues> with a user-reviewed summary — never auto-submit.
