---
description: CoalLedger stats—scans run and findings this session by canary and severity, plus the suite's config state for this project
---

Produce the CoalLedger stats report for this project, in the user's language. Tables only, minimal prose. Read-only—do not modify any file, stamp, or state.

CoalLedger keeps no persistent findings store—this report is assembled from THIS session's memory plus the config on disk:

- **Scans this session:** one row per canary run (canary · scope · tier Quick/Full · findings CONFIRMED/SUSPECTED · fixes applied via the choice-gated menu). No scans run → skip the table.
- **Findings by severity:** totals across this session's scans (CRITICAL/HIGH/MEDIUM/LOW · CONFIRMED vs SUSPECTED). Severity was judged by context at report time—these are counts, not a re-grade.
- **Suite state (from `.coalledger.json`, global + project merge):** `coalledgerMode` · `disabledCanaries` · `docLeak` gate · `severityFloor` · `quickVsFull` · `publicMode`—so the user sees which canaries can fire here and at what floor.
- **Config in force:** the file the project config was read from, by the resolution order in the README's Configure section (canonical `.claude/coal/coalledger.json` first, then `.agents/coal/…` and `.gemini/coal/…`, then the two DEPRECATED legacy paths `.claude/.coalledger.json` and a root `.coalledger.json`). A legacy hit is marked LEGACY with the path to move it to, `.claude/coal/coalledger.json`. Then name any IGNORED file: a FILE that exists in the project root at a path nothing reads—the leading dot dropped, `coal/` dropped, the legacy dotfile under `.agents`/`.gemini`, or the dot kept inside `coal/`—as `[CoalLedger] IGNORED: <path> is not a config path; canonical = .claude/coal/coalledger.json`, since its settings have no effect. Check for a FILE only, never crawl—a DIRECTORY at one of those paths is not a config and earns no line. Neither → one line saying so. You assemble this by checking those paths yourself; the session-start hook computes the same lines in code, so the two can differ.
- **Why this line exists:** it is also the channel for a user whose conductor is off or disabled (`coalledgerMode: "off"`, `disabledCanaries` `conductor`/`all`), for whom the session-start hook is silent by design.
- **Self-update:** last check stamp `~/.claude/coal/coalledger/update-check` (date, or "never") and the effective `updateMode`.

Honest empty state: nothing scanned this session and no stamp → say exactly that in one line.

This is the measurement standard-system command. Every number here is a session-local count—CoalLedger does not persist or transmit findings.
