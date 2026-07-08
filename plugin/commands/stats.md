---
description: CoalLedger stats — scans run and findings this session by canary and severity, plus the suite's config state for this project
---

Produce the CoalLedger stats report for this project, in the user's language. Tables only, minimal prose. Read-only — do not modify any file, stamp, or state.

CoalLedger keeps no persistent findings store — this report is assembled from THIS session's memory plus the config on disk:

- **Scans this session:** one row per canary run (canary · scope · tier Quick/Full · findings CONFIRMED/SUSPECTED · fixes applied via the choice-gated menu). No scans run → skip the table.
- **Findings by severity:** totals across this session's scans (CRITICAL/HIGH/MEDIUM/LOW · CONFIRMED vs SUSPECTED). Severity was judged by context at report time — these are counts, not a re-grade.
- **Suite state (from `.coalledger.json`, global + project merge):** `coalledgerMode` · `disabledCanaries` · `docLeak` gate · `severityFloor` · `quickVsFull` · `publicMode` — so the user sees which canaries can fire here and at what floor.
- **Self-update:** last check stamp `~/.claude/.coalledger-update-check` (date, or "never") and the effective `updateMode`.

Honest empty state: nothing scanned this session and no stamp → say exactly that in one line.

This is the measurement standard-system command. Every number here is a session-local count — CoalLedger does not persist or transmit findings.
