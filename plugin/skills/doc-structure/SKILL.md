---
name: doc-structure
description: >-
  Docs-health structure scan — broken internal links/anchors (GitHub-slug resolution, Thai/CJK safe), dead relative file links, heading hierarchy (skipped levels, multiple H1), duplicate sibling headings (same parent, same text), GFM table shape (silently-dropped cells), orphan/undefined reference definitions, bare URLs in prose. Triggers on: "/doc-structure", "doc-structure", "broken links", "check docs structure", "doc health". Mechanical + deterministic: detection runs through the shipped CommonMark+GFM AST engine (never regex over raw markdown), so things that render fine are not flagged. Reports; fixes on request via choice-gated menu. Severity is judged by context, never mechanical.
---

# Doc-Structure

Answer in the USER'S language; keep technical terms, commands, paths, and check ids verbatim.

Scan markdown docs for structural breakage. Report CONFIRMED findings. Fix on request.

## Parameters
- **SCOPE:** named files (default when given) | touched doc files this session | whole repo `**/*.md` (confirm first if > 50 files).

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
3. **Report** — CONFIRMED table only; anything the engine could not verify (e.g. site-root-relative `/links`, a known engine limit) goes to a separate SUSPECTED list, never the main table.

## Checks (engine ids)
| id | catches |
|---|---|
| heading-skip | level jumps (h1 -> h3) |
| heading-multiple-h1 | more than one top-level title |
| heading-duplicate | same-parent sibling headings with identical text — a plain #slug link reaches only the first heading with that text in the document (the check is sibling-scoped, the slug is not); keep-a-changelog per-release `### Added` repeats under different `## version` parents are deliberately not flagged |
| anchor-missing | #fragment resolves to no heading slug / HTML id (same-file + cross-file, case-mismatch hinted) |
| file-missing | dead relative link/image/definition target |
| table-ragged | row with MORE cells than the header (GitHub silently drops them) |
| ref-undefined | \[text]\[label] with no definition (renders as literal brackets) |
| def-orphan | definition never referenced |
| image-alt-missing | image with empty alt text — opt-in (default off); WCAG 1.1.1 treats empty alt as correct for decorative images, so the finding names the exception; a content image needs a description (MD045) |
| image-alt-too-short | alt below the script-aware grapheme floor (CJK: 1, default: 3) — measured in grapheme clusters so CJK/Thai/emoji count fairly |
| image-alt-too-long | alt exceeds 125 graphemes — alt is a label, not a caption (WAI concision convention) |
| bare-url | raw URL in prose (MD034 class) |
| doc-unreadable | binary/corrupted input (NUL byte sniffed) — refused before parsing, never a false "0 findings" clean bill |

## Output
| # | path:line | check | severity | finding | fix |

Then: SUSPECTED list · counts + top 3 to fix.

## Fix mode (choice-gated)
After any report in an interactive session you **MUST** present this menu via your question tool (skip only when findings are zero or no user is present). NEVER auto-fix a live doc.

- **Apply safe fixes:** mechanical, fully reversible edits only (correct an anchor slug to the real heading, fix a relative path to the file's actual location, remove an orphan definition). Each fix: checkpoint (git stash/commit in a git repo; else copy the file aside — never assume git exists) -> apply -> re-run the engine on the file -> revert if new findings appeared.
- **Let me pick:** list findings; the user selects.
- **Report only:** exit unchanged.

NEVER auto-fix: anything needing a content decision (which heading an anchor SHOULD point to when several are close, whether a dead link's target should be created or the link removed, table cell content) — offer options instead.

## Problem report
If this canary misbehaves, OFFER to file it at <https://github.com/TheColliery/CoalLedger/issues> with a user-reviewed summary — never auto-submit.
