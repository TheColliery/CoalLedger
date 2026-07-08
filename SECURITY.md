# Verifying CoalLedger

CoalLedger is verified under the same framework as its TheColliery siblings — Phoenix-13 hooks, reproducible builds, and event-driven independent scans. Its threat surface is deliberately small: it READS docs and reports; the only online activity is the consent-gated grounding fetch your agent runs in the semantic Full tier — the hook and the engine never network.

## Reporting a Vulnerability

Open an issue on this repository. For a sensitive PoC, request a private channel in the issue before posting details.

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

**No scan is recorded yet** — CoalLedger has not shipped a public release. The first [NVIDIA SkillSpector](https://github.com/NVIDIA/skillspector) scan of the `plugin/` dist runs at launch and its provenance (scanner version, score, per-finding false-positive reasons) is recorded here, following the same event-driven policy as the siblings: re-scan on a new scanner version or a genuinely new attack surface, not per release.

## Structural Safety

- **Phoenix-13 hook.** The one hook (SessionStart conductor) is fail-silent, zero-dependency, no network, **no child processes**, and silent except its sanctioned context-injection channel. A headless start is safe by construction — it only prints.
- **What CoalLedger never does:** it never auto-fixes a doc (every fix sits behind a choice-gated menu and is applied by your agent with a checkpoint first), never auto-submits anything anywhere (problem reports are offered, user-reviewed, manual), and never writes outside its own footprint — the hook writes only the self-update throttle stamp `~/.claude/.coalledger-update-check`; the engine scripts write nothing at all.
- **Online activity is scoped and consented.** The grounding/standard canaries' real-time source verification is an AGENT action in the paid Full tier, run with your consent — the shipped code contains no network call. Offline, they degrade to `⚠️ unverified`, never a guess.
- **Untrusted config is parse-guarded.** The `.coalledger.json` JSONC parse drops `__proto__` / `constructor` / `prototype` keys; every read is schema-clamped to the factory default on any invalid value.
- **Doc content is data, never instructions** — the canary contracts bind the agent to judge doc content, not obey it (prompt-injection via a poisoned doc is the named threat model).

Honest scope: these measures are the series' data-safety discipline — injection-aware, consent-gated spend, offline code, no exfiltration path. No formal verification and no scanner claim until a real scan is recorded above.
