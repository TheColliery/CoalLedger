# CoalLedger Privacy Policy

**CoalLedger collects nothing and phones nowhere by default — the one online step is yours to consent to.**

- **No telemetry.** No usage data, analytics, or identifiers are collected, stored, or transmitted — by the hook, the engine scripts, or the skills.
- **No network calls from the shipped code.** The hook and every engine script are offline by design (Phoenix #7): local filesystem only, no sockets, no requests. (The self-update *check* is the agent's `/coalledger:update` procedure, run only with your consent — never the hook.)
- **The grounding fetch is the consented exception.** The `doc-grounding` / `doc-standard` semantic Full tier verifies claims against live sources — an agent action behind an explicit consent. Be aware the CLAIM under verification travels in those fetch/search requests; for docs you do not want checked online, stay on the Quick tier (fully offline) or scope the scan.
- **Reports stay local.** Findings are printed to your session — nothing is persisted or transmitted; `/coalledger:stats` is a session-local read-only count.
- **Error reports are manual and scrubbed.** When something misbehaves, your agent may *offer* to open a GitHub issue; nothing is submitted automatically, you see and edit the contents first, and the report carries mechanical facts only (canary, check id, counts, error class) — **never your doc text**.
- **Local files only.** All state lives in files you can read: the self-update throttle stamp `~/.claude/.coalledger-update-check` (a timestamp, nothing more) and the config (`~/.claude/.coalledger.json` global, optional per-project `.coalledger.json`). Fix-mode checkpoints (a git stash/commit, or a copy-aside) are made by your agent in your project, on your disk.

Questions: open an issue at <https://github.com/TheColliery/CoalLedger/issues>.
