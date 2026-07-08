---
name: doc-leak
description: >-
  Docs-health audience-safety scan — PROSE-level sensitive content in a doc meant to be public: internal URLs/hostnames/paths, personal data (names, emails, phone numbers in examples or logs), unpublished plans or roadmaps, private figures (pricing, customers), anything whose audience boundary the doc crosses. Catches LEAKED docs. Explicitly NOT a secret scanner: token-shaped secrets (API keys, passwords, private keys) are gitleaks' job — this canary hunts the sensitive PROSE that token scanners and gitignore both miss. Triggers on: "/doc-leak", "doc-leak", "is this safe to publish", "leak check", "anything private in this doc". Semantic, conservative by design: EVERY finding is SUSPECTED — public-vs-private is the human's judgment, never the tool's. Config-gated via the .coalledger.json docLeak key (default on; a private-only project turns it off).
---

# Doc-Leak

Answer in the USER'S language; keep technical terms, commands, paths, and check ids verbatim.

Find prose that may cross the doc's audience boundary. EVERYTHING this canary reports is SUSPECTED — the human judges what is actually private.

## Gate
Runs only when `.coalledger.json` `docLeak` is `true` (the default). A project whose docs never leave the machine sets it `false` and this canary stays silent. `publicMode: true` marks the project's docs as public-facing and raises the stakes of every finding.

## Parameters
- **SCOPE:** named files (default when given) | docs about to be published/committed | whole repo public-facing docs (confirm first if > 20 files).
- **TIER:** semantic only — Full-tier (paid, always consent-gated). Judging "does this belong in front of this audience" is judgment, not pattern-matching.

## What it hunts (prose-level, past the token scanners)
| class | looks like |
|---|---|
| internal infrastructure | internal URLs, hostnames, machine paths, service names not meant for outside readers |
| personal data | real names, emails, phone numbers, account handles in examples, logs, or screenshots-as-text |
| unpublished intent | roadmaps, launch dates, decisions, or negotiations the project has not announced |
| private figures | pricing, revenue, customer names, internal metrics |

**Deferred to gitleaks:** token-shaped secrets (keys, passwords, certificates). If one is stumbled on anyway, flag it at once as the top item AND recommend a proper secret scan + rotation — but do not claim this canary is that scan.

## Method
1. **Establish the audience** per doc (public repo file, published page, internal note) — from the user or the doc's placement; unknown → treat as public and say so.
2. **Scan prose against the table.** Conservative bias: when unsure whether something is sensitive, FLAG it as SUSPECTED with the reason — a false flag costs a glance, a miss costs an incident.
3. **No CONFIRMED tier exists here:** detection can be certain ("this IS an email address") but sensitivity never is — every finding ships as SUSPECTED for human judgment. Severity is the human-judged stake IF private (personal data / a live secret = CRITICAL; internal infrastructure = HIGH; unpublished intent = MEDIUM-HIGH), then honor `severityFloor`.

## Escalation boundary
Whether the doc's CLAIMS are right is doc-grounding; this canary only asks "should this audience see it". Legal/regulatory exposure questions go to the human (and their counsel), never adjudicated here.

## Output
| # | path:line | class | excerpt (redact the sensitive part) | stake if private | suggested action |

All findings SUSPECTED. Redact within the report itself — a leak report must not re-leak.

## Fix mode (choice-gated)
After any report in an interactive session you **MUST** present this menu via your question tool (skip only when findings are zero or no user is present). NEVER auto-fix a live doc — every redaction is a content decision.

- **Propose redactions:** show each finding with a proposed replacement (placeholder, generalization, or removal); the user approves per item; apply with a checkpoint first (git stash/commit in a git repo; else copy the file aside — never assume git exists).
- **Let me pick:** list findings; the user selects.
- **Report only:** exit unchanged.

## Multilingual
Sensitivity is judged in the doc's own language (personal data and internal names look different per language and culture). A poorly-handled language degrades to low-confidence flags, never silence — conservative bias holds hardest where confidence is lowest.

## Problem report
If this canary misbehaves, OFFER to file it at <https://github.com/TheColliery/CoalLedger/issues> with a user-reviewed summary — never auto-submit. A problem report about this canary must itself carry NO doc content — mechanical facts only.
