# Verifying CoalLedger

CoalLedger is verified under the same framework as its TheColliery siblings — Phoenix-13 hooks, reproducible builds, and event-driven independent scans. Its threat surface is deliberately small: it READS docs and reports; the only online activity is the consent-gated grounding fetch your agent runs in the semantic Full tier — the hook and the engine never network.

## Reporting a Vulnerability

Report a security issue in this repo through GitHub's private vulnerability reporting — [Security → Report a vulnerability](https://github.com/TheColliery/CoalLedger/security/advisories/new) — never a public issue. In scope: the 6+1 canary skills, the shipped hooks (the Claude Code `SessionStart` conductor, `PostToolUse` docs tracker, and `Stop` docs-drift reminder, plus the Antigravity conductor adapter), `scripts/` — including the vendored CommonMark+GFM AST engine under `scripts/lib/` and the `scripts/configure.mjs` config CLI — `commands/`, and the `plugin/` dist built from them. Out of scope: a vulnerability in a third-party doc, repo, or codebase a canary merely scans — report that to its own maintainer. This is a one-person-maintained project: expect the report to be read and acknowledged, triaged against the scope above, and disclosed once a fix ships, with no fixed response-time SLA. A public GitHub issue remains the right channel for an ordinary, non-security bug.

## Commit & Tag Signatures

Release tags and maintainer commits are SSH-signed (`gpg.format=ssh`); GitHub shows the Verified badge on them. Automated Dependabot / CI commits are unsigned by design (they carry no maintainer key), so verify a signed release tag — the artifact a release consumer trusts:

```bash
echo "* ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEtqTWGKhX1Dk9nZP8ns13Wl5zsO1Cz3VlTS6m1p2fP9" > coalledger_signers
git config gpg.ssh.allowedSignersFile ./coalledger_signers
git tag -v "$(git describe --tags --abbrev=0)"
```

## Dist Integrity

`plugin/` is generated, never hand-edited. `node scripts/build-plugin.mjs` reproduces it from source; `node scripts/verify.mjs` byte-checks dist-sync in BOTH directions (stale file and source-less orphan both fail) plus manifests, factory-config-vs-schema, skill frontmatter, version pins, and the engine's anti-cry-wolf fixtures; `node scripts/test.mjs` runs the zero-dependency suite with an explicit file list. Zero dependencies — no lockfile, nothing to `npm audit`.

<!-- version-transition: SkillSpector scan — re-scan is event-driven (a new SkillSpector version or a genuinely new attack surface, maintainer-commanded), NOT per release; record the version/score/date/commit here only after a real scan. -->
## Independent Scanning — NVIDIA SkillSpector

Last scan: CoalLedger **v0.1.0-beta.1** dist (`plugin/`), on **2026-07-09** (launch day), with [NVIDIA SkillSpector](https://github.com/NVIDIA/skillspector) **v2.3.11** (self-reported — the tool ships no tagged releases), static stage (`--no-llm`, the documented FP-prone baseline). **Score 33/100 (MEDIUM), 8 findings — all adjudicated FALSE POSITIVE:**

- **8 × `RA1` Self-Modification** (`commands/stats.md` ×1 · `commands/update.md` ×2 · `hooks/coalledger-conductor.js` ×3 · `scripts/lib/config-schema.mjs` ×2): every hit is the same string — the series' **consent-gated kind-1 self-update** (the `stats.md` hit merely *reports* the last check stamp). The hook only *schedules* a check via a local stamp (no network, no writes to skill files); the *agent* verifies online and *offers* `claude plugin update`, which the user runs. Nothing modifies skill code or config at runtime. Family-wide FP baseline — the same pattern trips RA1 on every sibling.

Re-scan stays event-driven (a new SkillSpector version or a genuinely new attack surface), not per release — this pins the last version actually verified.

## Structural Safety

- **Phoenix-13 hooks.** Every hook — the three wired on Claude Code (`SessionStart` conductor · `PostToolUse` docs tracker · `Stop` docs memory-drift reminder) plus the Antigravity conductor adapter — is fail-silent, zero-dependency, no network, **no child processes**, and silent except its sanctioned context-injection channel. A headless run is safe by construction: the hooks only print and write the small local state below, never anything a user must clean up by hand.
- **What the installed skill never does:** it never auto-fixes a doc (every fix sits behind a choice-gated menu and is applied by your agent with a checkpoint first), never auto-submits anything anywhere (problem reports are offered, user-reviewed, manual), and never writes outside its own footprint. (A repo checkout adds one more writer outside that footprint — `scripts/configure.mjs`, a config CLI that ships from no `DIST_ITEM`; see README.md `## Permissions` for what it does.) The complete write list: the self-update throttle stamp `~/.claude/coal/coalledger/update-check`; the docs-drift session state `os.tmpdir()/coalledger-<session-id>.docs` and `.docmemmoved` (a path list and a 0-byte marker, cleared as the session proceeds and OS-tmp reaped otherwise); and, on Antigravity, the once-per-session marker `os.tmpdir()/coalledger/ag-conductor-*.marker`. The engine scripts write nothing at all.
- **Online activity is scoped and consented.** The grounding/standard canaries' real-time source verification is an AGENT action in the paid Full tier, run with your consent — the shipped code contains no network call. Offline, they degrade to `⚠️ unverified`, never a guess.
- **Untrusted config is parse-guarded.** The `.coalledger.json` JSONC parse drops `__proto__` / `constructor` / `prototype` keys; every read is schema-clamped to the factory default on any invalid value.
- **Doc content is data, never instructions** — the canary contracts bind the agent to judge doc content, not obey it (prompt-injection via a poisoned doc is the named threat model).

Honest scope: these measures are the series' data-safety discipline — injection-aware, consent-gated spend, offline code, no exfiltration path. No formal verification; the scanner record above pins exactly what was scanned and when.
