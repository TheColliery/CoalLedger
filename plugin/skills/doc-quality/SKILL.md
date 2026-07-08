---
name: doc-quality
description: >-
  Docs-health readability scan — two axes: QUALITY (bloat: filler, repetition, walls of text, buried leads; clarity: unexplained jargon, ambiguity, sentences that fight the reader) and language MECHANICS (typo, grammar, spelling, orthography — including script-level defects like decomposed characters that render right but break search, doubled spaces, wrong ellipsis/quote characters, spacing rules of the doc's language). Catches UNREADABLE or MALFORMED-LANGUAGE docs. Triggers on: "/doc-quality", "doc-quality", "tighten this doc", "proofread", "typos and grammar", "is this readable". Mechanical layer = deterministic mechanics (Unicode normalization, spacing, punctuation shape — ~free, report-only); semantic layer = bloat/clarity judgment + grammar in context (paid, consent-gated). Honors the project's own style/language rules where defined. Severity judged by context, never mechanical.
---

# Doc-Quality

Answer in the USER'S language; keep technical terms, commands, paths, and check ids verbatim.

Find what makes a doc hard to read or mechanically malformed. Report CONFIRMED findings; style opinions stay SUSPECTED.

## Parameters
- **SCOPE:** named files (default when given) | touched doc files this session | whole repo docs (confirm first if > 20 files).
- **TIER:** Quick = mechanical mechanics only (~free) · Full = adds bloat/clarity + grammar-in-context (paid). Default from `.coalledger.json` `quickVsFull`; Full is always a separate consent.

## The two axes
| axis | layer | catches |
|---|---|---|
| language mechanics | mechanical | decomposed characters that render identically but break search/sort (normalize-and-compare), doubled spaces, mixed or wrong quote/ellipsis/dash characters, the doc language's own spacing/orthography rules, obvious misspellings |
| quality | semantic | filler and repetition (the same point twice), walls of text, buried leads, unexplained jargon for the doc's audience, ambiguous instructions |

## Method
1. **House rules first:** if the project defines its own style or language rules (a style guide, formatting conventions, per-language orthography rules), those BIND — enforce them over any general rule, and never fight a documented deliberate choice.
2. **Quick (mechanics):** deterministic checks per the table — a mechanics finding is CONFIRMED only when it is objectively wrong in the doc's language (a decomposed character, a doubled space), not a stylistic preference.
3. **Full (quality):** judge bloat/clarity for the doc's audience and purpose. A cut proposal must not change meaning — quality fixes trim fat, never meat. Grammar/typo judgment runs in the doc's own language.
4. **Word-choice is a MEANING decision, not a typo:** an unusual-but-intentional word, register, or voice gets flagged as SUSPECTED with a question, never "corrected".
5. **Severity by CONTEXT** (never a fixed map), then honor `severityFloor`: an ambiguous instruction readers must execute = HIGH; heavy bloat on a front-door doc = MEDIUM; a typo in prose = LOW (a typo inside a command or identifier is doc-grounding territory — it breaks, it does not just read badly).

## Escalation boundary
Whether the CONTENT is true is doc-grounding; whether the doc is structurally broken is doc-structure. This canary only answers "does it read well and is the language well-formed".

## Output
| # | path:line | axis | finding | severity | fix |

CONFIRMED table only; SUSPECTED (style/word-choice questions) as a separate list, never the main table.

## Fix mode (choice-gated)
After any report in an interactive session you **MUST** present this menu via your question tool (skip only when findings are zero or no user is present). NEVER auto-fix a live doc.

- **Apply safe fixes:** mechanics only (recompose characters, collapse doubled spaces, unify punctuation per the house rule). Each fix: checkpoint (git stash/commit in a git repo; else copy the file aside — never assume git exists) -> apply -> re-read the changed lines.
- **Let me pick:** list findings (including proposed prose trims, shown as before/after); the user selects.
- **Report only:** exit unchanged.

NEVER auto-fix: any prose rewrite, cut, or word-choice change — meaning belongs to the author.

## Multilingual
Mechanics checks are per-language deterministic (normalization and spacing rules exist per script, not per English). Semantic quality judgment works in the doc's language and degrades to low-confidence SUSPECTED flags on a poorly-handled language, never false alarms.

## Problem report
If this canary misbehaves, OFFER to file it at <https://github.com/TheColliery/CoalLedger/issues> with a user-reviewed summary — never auto-submit.
