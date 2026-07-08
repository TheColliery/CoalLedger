---
name: doc-standard
description: >-
  Docs-health completeness scan — a doc measured against its KIND's standard: required sections present, public surface documented (every command/config key/exported API the code ships appears in the doc), the shape the genre expects (a README's install path, a security policy's reporting channel, a formal letter's parts). Catches INCOMPLETE docs. The standard is the project's OWN declared one first (a style guide, template, or pattern doc in the repo), else the kind's widely-accepted standard verified REAL-TIME against MULTIPLE authoritative sources. Triggers on: "/doc-standard", "doc-standard", "is this doc complete", "missing sections", "audit doc completeness". Mechanical layer (sections/hierarchy present via the AST — language-neutral) + semantic layer (completeness judgment, consent-gated). Offline degrades safe to "⚠️ unverified". Severity judged by context, never mechanical.
---

# Doc-Standard

Answer in the USER'S language; keep technical terms, commands, paths, and check ids verbatim.

Find what a doc is MISSING versus the standard for its kind. Report CONFIRMED gaps only.

## Parameters
- **SCOPE:** named files (default when given) | touched doc files this session | whole repo docs (confirm first if > 20 files).
- **TIER:** Quick = mechanical presence checks (~free) · Full = semantic completeness judgment (paid). Default from `.coalledger.json` `quickVsFull`; Full is always a separate consent.

## The standard (resolve in this order — never invent one)
1. **The project's own** — a style guide, template, pattern doc, or stated convention in the repo binds first.
2. **The kind's accepted standard** — verified REAL-TIME, MULTI-source (cross-check several authoritative sources, never one), language-aware. Offline → `⚠️ unverified: check [source]`, never asserted from memory.
3. **No resolvable standard** → say so; report only self-evident gaps (an empty required field, a heading with no body).

## Method
1. **Identify the doc's kind** (README, policy, reference, report, letter, ...) and resolve its standard (above).
2. **Mechanical layer:** required parts PRESENT — detect sections by AST structure, position, and meaning, NEVER by an English keyword (a section may carry its heading in any language).
3. **Semantic layer (Full):** completeness of substance — is the public surface the source ships actually covered (commands, config keys, exported APIs, the steps a reader needs); are stated sections empty shells.
4. **Severity by CONTEXT** (never a fixed map), then honor `severityFloor`: a missing security-reporting channel or install step = HIGH-CRITICAL; an undocumented public key = MEDIUM-HIGH; a nice-to-have section = LOW.

## Escalation boundary
Whether content is CORRECT is doc-grounding's job; whether a judgment call needs formal verification is CoalBoard's (`/coalboard`). This canary only answers "is it all THERE".

## Output
| # | path | gap | standard source | severity | fix |

CONFIRMED table only; `⚠️ unverified` standards and SUSPECTED gaps in separate lists.

## Fix mode (choice-gated)
After any report in an interactive session you **MUST** present this menu via your question tool (skip only when findings are zero or no user is present). NEVER auto-fix a live doc.

- **Draft the missing parts:** propose section drafts for the user to review — content is ALWAYS the user's call; drafts are applied only after approval, with a checkpoint first (git stash/commit in a git repo; else copy the file aside — never assume git exists).
- **Let me pick:** list gaps; the user selects which to draft.
- **Report only:** exit unchanged.

## Multilingual
The mechanical layer is language-agnostic (AST/position/semantics, no keyword matching). Semantic judgment works in the doc's language and degrades to low-confidence flags on a poorly-handled language, never false alarms.

## Problem report
If this canary misbehaves, OFFER to file it at <https://github.com/TheColliery/CoalLedger/issues> with a user-reviewed summary — never auto-submit.
