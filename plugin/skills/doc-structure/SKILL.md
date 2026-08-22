---
name: doc-structure
description: >-
  Docs-health structure scan — broken internal links/anchors (GitHub-slug resolution, Thai/CJK safe), dead relative file links, heading hierarchy (skipped levels, multiple H1), duplicate sibling headings (same parent, same text), GFM table shape (silently-dropped cells), orphan/undefined reference definitions, bare URLs in prose, images missing alt text (WCAG-aware, SUSPECTED-only — decorative-vs-content intent is a human call). Triggers on: "/doc-structure", "doc-structure", "broken links", "check docs structure", "doc health". Mechanical + deterministic: detection runs through the shipped CommonMark+GFM AST engine (never regex over raw markdown), so things that render fine are not flagged. Reports; fixes on request via choice-gated menu. Severity is judged by context, never mechanical.
---

# Doc-Structure

Answer in the USER'S language; keep technical terms, commands, paths, and check ids verbatim.

Scan markdown docs for structural breakage. Report CONFIRMED findings. Fix on request.

## Parameters
- **SCOPE:** named files (default when given) | touched doc files this session | whole repo, Markdown-family only (`.md`/`.mdx`/`.markdown` — the engine is a CommonMark+GFM parser, not a dialect it doesn't speak; confirm first if > 50 files).

## Method (the code detects, you judge)
1. **Run the engine** — it ships INSIDE this skill folder at `./lib/`, so the skill works even when it travels alone. Your context carries this skill's **base directory** — substitute it for `<skill base dir>` and run exactly:
   `cd "<skill base dir>" && node ./lib/md-checks.mjs --json <absolute-file.md> [more absolute paths ...]`
   The `cd` is REQUIRED — `./lib/` resolves against the skill folder, never your project cwd (without it: `Cannot find module`). Target docs must be ABSOLUTE paths, since cwd is now the skill folder. Findings do not depend on cwd: each doc's relative links resolve against that DOC's own directory.
   Never re-derive these checks by reading markdown yourself — the AST engine exists so detection matches CommonMark+GFM rendering (regex cry-wolfs on things that render fine). Honest ceiling: CommonMark+GFM fidelity, NOT 100% GitHub-pixel fidelity.
2. **Contextualize severity** — detection is deterministic; severity is NEVER mechanical. Judge each finding by context, then honor `.coalledger.json` `severityFloor`:
   - CRITICAL: the breakage misleads harmfully (a dead link in a security/install step a user must follow).
   - HIGH: a real breakage on a doc readers actively use (broken anchor in a live README, dropped table cells with content).
   - MEDIUM: structural debt (skipped heading level, multiple H1, undefined ref in secondary docs).
   - LOW: style/hygiene (bare URL, orphan definition, anything in an archived/internal doc).
3. **Report** — CONFIRMED table only; anything the engine could not verify (e.g. site-root-relative `/links`, a known engine limit) OR whose correctness the engine cannot itself judge (`image-alt-missing` — decorative-vs-content intent) goes to a separate SUSPECTED list, never the main table. `image-alt-missing` carries `finding.suspected = true` and is SUSPECTED-only ALWAYS — there is no config toggle for it (skip-what-doesn't-matter, fill-what-does, never on/off).

## Checks (engine ids)
| id | catches |
|---|---|
| heading-skip | level jumps (h1 -> h3) |
| heading-multiple-h1 | more than one top-level title |
| heading-duplicate | same-parent sibling headings with identical text; keep-a-changelog per-release `### Added` repeats under different `## version` parents are deliberately not flagged |
| anchor-missing | #fragment resolves to no heading slug / HTML id (same-file + cross-file, case-mismatch hinted) |
| file-missing | dead relative link/image/definition target |
| table-ragged | row with MORE cells than the header |
| ref-undefined | \[text]\[label] with no definition |
| def-orphan | definition never referenced |
| bare-url | raw URL in prose (MD034 class) |
| image-alt-missing | image/image-reference with empty or whitespace-only alt (all reference forms). SUSPECTED-only always — empty alt is WCAG-1.1.1-correct for a purely decorative image, so intent is a human call, never CONFIRMED |
| doc-too-large | input over the size cap — refused before parsing, never a false clean bill on a doc too big to scan safely |
| doc-unreadable | binary/corrupted input (NUL byte sniffed) — refused before parsing, never a false "0 findings" clean bill |

## Grants & denials (CLASSIFY-BLOCK)
| class | step it powers | grant | on denial |
|---|---|---|---|
| read | scan target docs via the AST engine | `Bash` (the engine runs via `node ./lib/md-checks.mjs`, per Method step 1 — `Read`/`Grep`/`Glob` cannot execute it, and step 1 forbids re-deriving checks by reading markdown yourself) | refuse that file, report it unscanned — never a false clean bill (same posture as `doc-too-large`/`doc-unreadable` above) |
| write | Apply safe fixes (anchor/path/orphan corrections) | `Write`·`Edit` (·`Bash` — checkpoint via git stash/commit, and the re-run-the-engine revert check) | report + courier the intended change to the dispatcher; never claim applied |

A denial reaches the WORKER as a visible message and propagates NO further — not to the dispatcher, not as a catchable condition. Every row above states a branch or an explicit death; a step that dies says so in the output. Never report a denied step as done, skipped, or clean.

## Output
| # | path:line | check | severity | finding | fix |

Then: SUSPECTED list · counts + top 3 to fix.

**Reporting:** call `ReportFindings` when callable — `file`/`line` is already the defect site by construction (the AST engine is line-accurate); an unresolvable line reports your best guess, named imprecise in the wrap-up, never dropped. Severity prefixed in `summary` (e.g. `[HIGH] …`) per the table above, ranked most-severe first, SUSPECTED as `verdict: PLAUSIBLE`; chat then carries only the wrap-up line (counts · SUSPECTED list · overflow past 32) + the fix menu, never a restatement. Not callable → the table above, unchanged. An Apply-fixes click = consent to the Apply-safe-fixes class below (mechanical, fully reversible), composing with — never bypassing — Fix mode. After any fix round, re-report the same findings with `outcome: fixed`/`skipped`/`no_change_needed`.

## Fix mode (choice-gated)
After any report in an interactive session you **MUST** present this menu via your question tool (skip only when findings are zero or no user is present). NEVER auto-fix a live doc.

- **Apply safe fixes:** mechanical, fully reversible edits only (correct an anchor slug to the real heading, fix a relative path to the file's actual location, remove an orphan definition). Each fix: checkpoint (git stash/commit in a git repo; else copy the file aside — never assume git exists) -> apply -> re-run the engine on the file -> revert if new findings appeared.
- **Let me pick:** list findings; the user selects.
- **Report only:** exit unchanged.

NEVER auto-fix: anything needing a content decision (which heading an anchor SHOULD point to when several are close, whether a dead link's target should be created or the link removed, table cell content) — offer options instead.

## Problem report
If this canary misbehaves, OFFER to file it at <https://github.com/TheColliery/CoalLedger/issues> with a user-reviewed summary — never auto-submit.
