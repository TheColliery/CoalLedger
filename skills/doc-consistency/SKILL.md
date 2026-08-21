---
name: doc-consistency
description: >-
  Docs-health contradiction scan — docs that disagree with EACH OTHER: the same fact stated two ways in two places, terminology drift (one thing under several names, or one name for several things), copy-paste blocks that were updated in one home and not the other, and cross-LANGUAGE drift (a doc and its counterpart in another language no longer say the same thing). Catches CONTRADICTORY doc sets. Triggers on: "/doc-consistency", "doc-consistency", "docs contradict", "terminology drift", "are the translations in sync". Semantic (paid, consent-gated — comparing meaning across files is judgment, not pattern-matching). Severity judged by context, never mechanical; CONFIRMED contradictions and SUSPECTED tensions reported separately.
---

# Doc-Consistency

Answer in the USER'S language; keep technical terms, commands, paths, and check ids verbatim.

Find places where the doc set disagrees with itself. Report CONFIRMED contradictions; park tensions in SUSPECTED.

## Parameters
- **SCOPE:** a named doc set (default when given) | all docs touching a named topic | whole repo docs — `.md`/`.mdx`/`.markdown`/`.rst`/`.txt`/`.adoc`/`.asciidoc`/`.org` (confirm first if > 20 files).
- **TIER:** semantic only — this canary is Full-tier (paid, always consent-gated). There is no meaningful mechanical layer: two sentences can contradict with zero textual overlap.

## What counts (three drift classes)
| class | looks like |
|---|---|
| fact drift | the same fact stated differently in two docs (a count, a default, a step order, a supported-platform claim) |
| terminology drift | one concept under several names, or one name reused for different concepts — including a doc set's own defined terms used off-definition |
| cross-language drift | a doc and its other-language counterpart diverging in meaning (a fact updated in one language only, a section present in one and absent in the other) |

## Method
1. **Inventory:** extract the facts and defined terms each in-scope doc asserts (skip opinions; technical terms stay verbatim — a term is only "drifted" when the CONCEPT diverges, not when prose around it varies).
2. **Cross-compare** the inventory; pair up disagreements. For cross-language pairs, compare MEANING (a free translation is fine; a contradicting one is drift).
3. **Which side is right is NOT this canary's call** — report the pair and, where a source of truth is obvious, note it; resolving truth is doc-grounding's job (offer to run it on the pair).
4. **Severity by CONTEXT** (never a fixed map), then honor `severityFloor`: contradictory instructions readers may follow = HIGH-CRITICAL; contradictory descriptions = MEDIUM; naming inconsistency = LOW.

## Escalation boundary
Adjudicating WHICH of two contradicting claims is true = doc-grounding (fetch/recompute) or, for the error-not-allowed slice, CoalBoard (`/coalboard`) if that skill is installed. This canary only surfaces the disagreement.

## Grants & denials (CLASSIFY-BLOCK)
| class | step it powers | grant | on denial |
|---|---|---|---|
| read | inventory facts/terms across the doc set, incl. cross-language pairs | `Read`·`Grep`·`Glob` | refuse that file, report it unscanned — never a false clean bill |
| write | Align to a chosen side (after the user picks) | `Write`·`Edit` (·`Bash` — checkpoint via git stash/commit) | report + courier the intended change to the dispatcher; never claim applied |

A denial reaches the WORKER as a visible message and propagates NO further — not to the dispatcher, not as a catchable condition. Every row above states a branch or an explicit death; a step that dies says so in the output. Never report a denied step as done, skipped, or clean.

## Output
| # | doc A (path:line) | doc B (path:line) | class | disagreement | severity |

CONFIRMED table only; SUSPECTED (a tension that may be intended, e.g. an archive vs a live doc) as a separate list.

**Reporting:** call `ReportFindings` when callable — the schema carries ONE `file`/`line` pair per finding, so `file`/`line` MUST be doc A's defect site; doc B's location is cited as `path:line` inside `summary`/`failure_scenario`, never a paraphrase — one contradiction is one finding, never split across two. An unresolvable line reports your best guess, named imprecise in the wrap-up, never dropped. Severity prefixed in `summary` (e.g. `[HIGH] …`) per the severity-by-context rule above, ranked most-severe first, SUSPECTED tensions as `verdict: PLAUSIBLE`; chat then carries only the wrap-up line (counts · SUSPECTED list · overflow past 32) + the fix menu, never a restatement. Not callable → the table above, unchanged. **No safe-fix class exists here** — every fix is a which-side-wins content decision, so an Apply-fixes click degrades to the Let-me-pick path below, never an auto-apply. After any fix round, re-report the same findings with `outcome: fixed`/`skipped`/`no_change_needed`.

## Fix mode (choice-gated)
After any report in an interactive session you **MUST** present this menu via your question tool (skip only when findings are zero or no user is present). NEVER auto-fix a live doc.

- **Align to a chosen side:** the user picks which doc is right per finding; the other is edited to match, with a checkpoint first (git stash/commit in a git repo; else copy the file aside — never assume git exists).
- **Let me pick:** list findings; the user selects.
- **Report only:** exit unchanged.

NEVER auto-fix: every consistency fix is a content decision (which side wins) — there are no "safe" automatic fixes in this canary.

## Multilingual
Cross-language comparison IS this canary's core case, worked in the languages the docs are written in. A poorly-handled language degrades to low-confidence SUSPECTED flags, never false alarms.

## Problem report
If this canary misbehaves, OFFER to file it at <https://github.com/TheColliery/CoalLedger/issues> with a user-reviewed summary — never auto-submit.
