---
name: doc-standard
description: >-
  Docs-health completeness scan—a doc measured against its KIND's standard: required sections present, public surface documented (every command/config key/exported API the code ships appears in the doc), the shape the genre expects (a README's install path, a security policy's reporting channel, a formal letter's parts). Catches INCOMPLETE docs. The standard is the project's OWN declared one first (a style guide, template, or pattern doc in the repo), else the kind's widely-accepted standard verified REAL-TIME against MULTIPLE authoritative sources. Triggers on: "/doc-standard", "doc-standard", "is this doc complete", "missing sections", "audit doc completeness". Mechanical layer (sections/hierarchy present, detected by structure/position/meaning—an agent read, never an English keyword) + semantic layer (completeness judgment, consent-gated); the repository-scope pass runs a checked engine. Offline degrades safe to "⚠️ unverified". Severity judged by context, never mechanical.
metadata:
  author: HetCreep <info@thecolliery.org>
---

# Doc-Standard

Answer in the USER'S language; keep technical terms, commands, paths, and check ids verbatim.

Find what a doc is MISSING versus the standard for its kind. Report CONFIRMED gaps only.

## Parameters
- **SCOPE:** named files (default when given) | touched doc files this session | whole repo docs—`.md`/`.mdx`/`.markdown`/`.rst`/`.txt`/`.adoc`/`.asciidoc`/`.org` (confirm first if > 20 files).
- **TIER:** Quick = mechanical presence checks (~free) · Full = semantic completeness judgment (paid). Default from `quickVsFull` (`.coalledger.json`, global + project merge); Full is always a separate consent.

## The standard (resolve in this order—never invent one)
1. **The project's own**—a style guide, template, pattern doc, or stated convention in the repo binds first.
2. **The kind's accepted standard**—verified REAL-TIME, MULTI-source (cross-check several authoritative sources, never one), language-aware. Offline → `⚠️ unverified: check [source]`, never asserted from memory.
3. **No resolvable standard** → say so; report only self-evident gaps (an empty required field, a heading with no body).

## Method
1. **Identify the doc's kind** (README, policy, reference, report, letter, ...) and resolve its standard (above).
2. **Mechanical layer:** required parts PRESENT—an agent read detects sections by structure, position, and meaning, NEVER by an English keyword (a section may carry its heading in any language). Per doc this stays an agent read (doc-structure's AST is that skill's own, not shared); the repository scope has an engine, step 2b.
   - **2b. Repository scope (mechanical, `repo-standard.mjs`, ~free, CONFIRMED except as marked).** Run when SCOPE is the whole repository or the user asks whether the repository is complete; otherwise skip. Run exactly, after running `cd "<skill base dir>" && node ./lib/repo-standard.mjs --list-path` and writing the run list with your file tool to the exact path it prints (`{"root": "<absolute project folder>", "docs": []}`): `cd "<skill base dir>" && node ./lib/repo-standard.mjs --json --list` (optional `--now=<ISO date>` fixes the clock for the security.txt expiry; default now). The `cd` is REQUIRED; the run list's `root` is the absolute project folder. No path goes on the command line; the engine reads the root from the run list as data.
     - `license-missing` (`license_location`, CONFIRMED): no LICENSE, LICENCE or COPYING at the root (`.md`, `.txt`, `.rst` or bare), no `LICENSE-*` or `LICENCE-*` file there, and no plain file in a REUSE `LICENSES/` folder.
     - `contributing-missing` (`contribution`, CONFIRMED): no CONTRIBUTING at the root, in `docs/` or in `.github/`.
     - `vuln-report-missing` (`vulnerability_report_process`, CONFIRMED): no SECURITY file in those three places and no valid `.well-known/security.txt`.
     - `securitytxt-expired` (`vulnerability_report_process`, CONFIRMED): a `.well-known/security.txt` whose `Expires` is missing, repeated (RFC 9116 §2.5.5 allows one), not a date, or not after the check time. Reported even beside a SECURITY file.
     - `release-notes-raw-log` (`release_notes`, SUSPECTED): a CHANGELOG, HISTORY, NEWS or RELEASES file (`.md`/`.rst`/`.txt`, in those three places) whose text reads as raw `git log` output.
     - `release-notes-unreadable` (`release_notes`, SUSPECTED): such a file over the read bound, or unreadable; its shape is not judged.
     - This pass does not check whether a release-notes file exists; it judges only the shape of one that does. The criterion's own N/A is not decided here.
     - `contributing-missing` and `vuln-report-missing` are file facts. Before calling either a gap, read the README: a README section can meet the criterion.
     - Names match case-insensitively; a link that leaves the project never satisfies a check. `--json` prints `{ "findings": [...] }`; exit 2 on a usage error. Severity still by context (step 4).
3. **Semantic layer (Full):** completeness of substance—is the public surface the source ships actually covered (commands, config keys, exported APIs, the steps a reader needs); are stated sections empty shells.
4. **Severity by CONTEXT** (never a fixed map), then honor `severityFloor`: a missing security-reporting channel or install step = HIGH-CRITICAL; an undocumented public key = MEDIUM-HIGH; a nice-to-have section = LOW. `scanEverything: true` bypasses the floor this run—report everything down to `low`—and say so: state that `severityFloor` was bypassed, never that every scope cut was bypassed (this canary has none to bypass).

## Escalation boundary
Whether content is CORRECT is doc-grounding's job; whether a judgment call needs formal verification is CoalBoard's (`/coalboard`, if that skill is installed). This canary only answers "is it all THERE".

## Grants & denials (CLASSIFY-BLOCK)
| class | step it powers | grant | on denial |
|---|---|---|---|
| read | detect required parts by reading the doc | `Read`·`Grep`·`Glob` (·`Bash`·`Write` for the run list—the repository pass runs via `node ./lib/repo-standard.mjs`, Method 2b; `Read`/`Grep`/`Glob` cannot execute it) | refuse that file, report it unscanned—never a false clean bill |
| write | Draft the missing parts (after approval) | `Write`·`Edit` (·`Bash`—checkpoint via git stash/commit) | report + courier the intended change to the dispatcher; never claim applied |
| network | resolving the kind's accepted standard | `WebSearch`·`WebFetch` | already covered—resolving the standard already degrades to `⚠️ unverified: check [source]` when offline (see "The standard" above) |

A denial reaches the WORKER as a visible message and propagates NO further—not to the dispatcher, not as a catchable condition. Every row above states a branch or an explicit death; a step that dies says so in the output. Never report a denied step as done, skipped, or clean.

## Output
| # | path | gap | standard source | severity | fix |

CONFIRMED table only; `⚠️ unverified` standards and SUSPECTED gaps in separate lists.

**Reporting:** call `ReportFindings` when callable—`file`/`line` MUST be the defect site, never a paraphrase; an unresolvable line reports your best guess, named imprecise in the wrap-up, never dropped. Severity prefixed in `summary` (e.g. `[HIGH] …`) per the severity-by-context rule above, ranked most-severe first, `⚠️ unverified` standards AND SUSPECTED gaps both report as `verdict: PLAUSIBLE` (Output's own two non-CONFIRMED lists, same non-CONFIRMED shape); chat then carries only the wrap-up line (counts · unverified + SUSPECTED lists · overflow past 32) + the fix menu, never a restatement. Not callable → the table above, unchanged. **No mechanical safe-fix class exists here**—every fix is a drafted section awaiting approval, so an Apply-fixes click degrades to the Draft/Let-me-pick path below, never an auto-apply. After any fix round, re-report the same findings with `outcome: fixed`/`skipped`/`no_change_needed`.

## Fix mode (choice-gated)
After any report in an interactive session you **MUST** present this menu via your question tool (skip only when findings are zero or no user is present). NEVER auto-fix a live doc.

- **Draft the missing parts:** propose section drafts for the user to review—content is ALWAYS the user's call; drafts are applied only after approval, with a checkpoint first (git stash/commit in a git repo; else copy the file aside—never assume git exists).
- **Let me pick:** list gaps; the user selects which to draft.
- **Report only:** exit unchanged.

## Multilingual
The mechanical layer is language-agnostic (structure/position/semantics, an agent read, no keyword matching). Semantic judgment works in the doc's language and degrades to low-confidence flags on a poorly-handled language, never false alarms.

## Problem report
If this canary misbehaves, OFFER to file it at <https://github.com/TheColliery/CoalLedger/issues> with a user-reviewed summary—never auto-submit.
