# Changelog

All notable changes to CoalLedger are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/) (the version lives in `.claude-plugin/plugin.json`).

## [0.1.0-beta.6] - 2026-07-17

Fourth CoalBoard dogfood pass (full-mirror, nasa-L3) — a HIGH the beta.3 fix left half-open.

### Fixed
- **[HIGH, CoalBoard nasa-L3 audit] the markdown parser was STILL quadratic after beta.3 — `processEmphasis` was O(N²), and the beta.3 "near-linear … never a hang" claim was false.** beta.3 bounded only `parseInlineDest`'s non-angle branch; three quadratic paths remained in `scripts/lib/md-ast.mjs`, all reachable through the documented `checkDocument` entry on benign-looking input under the 512 KB cap:
  - **`processEmphasis`** reset the closer index to 0 after every match and array-spliced the node list each time → O(N²) on dense emphasis. A plain doc of `a*b_c*d_` repeated hung any scan — measured **200 KB ≈ 57 s**, and **~500 KB (under the cap) did not finish in 5 minutes** (pure wasted CPU, 0 findings). Fixed by porting the **LINEAR CommonMark reference "process emphasis"**: a doubly-linked delimiter stack + an `openers_bottom` bucket table (keyed by char, `canOpen`, and original-run-length mod 3 — the invariants the match rule uses) so no closer ever re-scans, plus a sibling linked list so wrapping a span is O(1) instead of an O(N) splice.
  - **the `<…>` angle-destination scan** used an unbounded `indexOf('>')` → O(N²) on `[](<` spam; now length-bounded by `MAX_INLINE_DEST`, matching the sibling non-angle branch.
  - **the code-span (backtick) scan** re-scanned the tail to EOS per run → O(N²) on backtick spam; a failed-run-length memo makes each length scan at most once.
  - **Result:** linear now — the 200 KB emphasis doc scans in **~0.5 s**, the 512 KB worst case in **~1.3 s**. **Parser output is unchanged** — verified structurally identical to the previous parser across 4025 fuzz docs and, where the two agreed, identical to the `commonmark` reference. +2 hermetic guards (91 → 93): a dense-emphasis wall-bound through `checkDocument`, and a functional bound on the angle destination (both fail on the pre-fix code). The 512 KB `MAX_DOC_BYTES` cap remains as the backstop for the residual native-scan paths (reference-label, table), which the cap already holds under ~2 s.

## [0.1.0-beta.5] - 2026-07-09

A reconciliation pass (`plugin.json` vs `CHANGELOG.md`) plus the third CoalBoard dogfood pass (full-mirror, nasa — `.coalboard/reports/audit-2026-07-09-nasa-full-mirror.md`): two LOW findings and a bookkeeping gap.

### Fixed
- **CHANGELOG backfill: v0.1.0-beta.4 shipped with no entry.** `plugin.json` had already moved to `0.1.0-beta.4` while this file's newest entry stayed at beta.3 — an undocumented version bump, caught by a reconciliation pass, not the audit. Reconstructed from `git log`/`git show` v0.1.0-beta.3..v0.1.0-beta.4 (never from memory) and backfilled below. Lesson: a version bump without its CHANGELOG entry is an undocumented release — the release checklist's entry-before-tag order exists for exactly this.
- **[LOW, CoalBoard nasa audit] degenerate/binary input parsed to a near-empty tree, reporting a false "0 findings" clean bill.** `parseMarkdown` never throws, so a corrupted or non-text `.md` produced no structural findings at all — the beta.3 size cap addressed volume, not content validity. Added a `doc-unreadable` pre-parse guard (`scripts/lib/md-checks.mjs`): a NUL byte in the first 8 KB (git/grep/diff's own binary-detection heuristic) is now flagged instead of silently parsed. Documented the remaining honest ceiling in the file's "Known limits" header — genuinely garbled-but-NUL-free UTF-8 text has no such signal and still parses near-empty (this is a structural scanner, not a content validator), and `anchorsOf`'s `catch → null` still treats every unreadable cross-file anchor target alike. +1 hermetic test (90 → 91).
- **[LOW, CoalBoard nasa audit] README doctrine link pointed at the org root instead of the `.github` repo.** "Series doctrine: `TheColliery/.github`" linked `https://github.com/TheColliery` though the visible text names the `.github` repo specifically — corrected to `https://github.com/TheColliery/.github`.

## [0.1.0-beta.4] - 2026-07-09

*(Backfilled 2026-07-09 — this release shipped with no CHANGELOG entry; reconstructed from `git log`/`git show` v0.1.0-beta.3..v0.1.0-beta.4, never from memory.)* CodeQL flagged a second-order sanitization gap in the same file the beta.3 DoS fix touched.

### Fixed
- **[HIGH, CodeQL `js/incomplete-multi-character-sanitization`] the HTML-comment strip in `collectAnchors` could leave a residual comment on overlapping/adjacent markers** (`scripts/lib/md-checks.mjs`). A single `.replace(HTML_COMMENT_RE, '')` pass doesn't re-scan its own output, so input like `<!--<!---->-->` left a partial comment behind — the canonical incomplete-multi-character-sanitization pattern. Fixed with `stripHtmlComments()`, which repeats the replace to a FIXED POINT (loops until the string stops changing) before `collectAnchors` scans for `id`/`name` attributes. The beta.2 anchor-precision property is unaffected; +0 test change (90/90 held). CodeQL's `bad-tag-filter` and dead-code alerts on the same region were reviewed and dismissed — the parser is a block-classifier, not a security sanitizer, and raw HTML is passthrough-flagged, never executed or re-emitted.

### Changed
- CI: `github/codeql-action` (`init`/`analyze`/`upload-sarif`) 4.36.3 → 4.37.0 and `DavidAnson/markdownlint-cli2-action` 23.2.0 → 24.0.0 (Dependabot, SHA-pinned). `dependabot.yml` now groups the three `codeql-action` bumps into one PR (avoids an init/analyze version-skew that reds CodeQL) and assigns bump PRs to the maintainer so they notify at any GitHub watch level.

## [0.1.0-beta.3] - 2026-07-09

Second CoalBoard dogfood pass (full-mirror, nasa) — a HIGH the first pass missed.

> **Correction ([Unreleased]):** the "Parse is now near-linear … never a hang" claim below was **incomplete** — it fixed only the `parseInlineDest` (`[a](`) vector. `processEmphasis`, the `<…>` angle-destination scan, and the backtick scan remained O(N²); a dense-emphasis doc still hung. Closed for real in [Unreleased].

### Fixed
- **[HIGH] the markdown parser was quadratic-time; a crafted doc could hang any scan.** `md-ast.mjs` `parseInlineDest` re-scanned the tail to end-of-string on every `]` with an unclosed `(` — `[a](` repeated N times parsed in O(N²) (measured: 8 KB ≈ 190 ms, 16 KB ≈ 680 ms, 32 KB ≈ 2.9 s, extrapolated ~1 MB ≈ 1 hr), while a benign 273 KB doc parsed in 5 ms. Fixed at the root: the inline destination/title scans are length-bounded (`MAX_INLINE_DEST`; over the cap = not a valid inline link → literal text), and `checkDocument` refuses a doc over `MAX_DOC_BYTES` (512 KB) — flagging `doc-too-large` instead of parsing — which also closes the transitive vector (a benign doc that links a poisoned `.md`). Parse is now near-linear (16 KB pathological ≈ 340 ms, bounded ≈ 5.7 s at the 512 KB cap, never a hang). +2 timing regression tests (88 → 90).

## [0.1.0-beta.2] - 2026-07-09

Launch-day **CoalBoard dogfood** (nasa rigor, opus blind lenses + judge) caught a precision bug the fixture gate missed.

### Fixed
- **[MED] `anchor-missing` could pass a genuinely-broken `#link`.** `collectAnchors`'s `HTML_ID_RE` matched `id`/`name` anywhere in raw HTML — `data-id="x"`, `item-name='y'`, or an `id` inside an HTML comment all registered as FALSE anchors, so a link to a non-existent anchor slipped through. The regex now requires an attribute boundary (a negative lookbehind for a word-char/hyphen) and HTML comments are stripped before scanning — only real `id`/`name` anchors count.

## [0.1.0-beta.1] - 2026-07-09

Initial public beta — phase 1 (engine + pilot) and phase 2 (the full suite + public docs) together.

### Added

- **AST engine (zero-dependency ESM):** `md-ast.mjs` vendored CommonMark+GFM parser with a Unicode-safe slugger (Thai/CJK headings resolve) · `md-checks.mjs` mechanical structure checks (8 stable check ids: heading-skip, heading-multiple-h1, anchor-missing, file-missing, table-ragged, ref-undefined, def-orphan, bare-url) — detection by AST, never regex over raw markdown; fixture-gated against planted defects AND clean decoys (any decoy finding fails the gate — anti-cry-wolf).
- **The 6+1 canaries** (`skills/`): `doc-structure` (BROKEN, mechanical — the engine pilot) · `doc-grounding` (WRONG — claims vs source of truth: code/data/original text/reality; real-time multi-source, offline degrades to `⚠️ unverified`) · `doc-standard` (INCOMPLETE — vs the doc kind's standard) · `doc-rot` (STALE — age-markers + superseded content) · `doc-consistency` (CONTRADICTORY — incl. cross-language drift) · `doc-quality` (UNREADABLE/MALFORMED — bloat, clarity, language mechanics) · `doc-leak` (LEAKED — prose-level audience boundary, SUSPECTED-only, config-gated via `docLeak`). Every canary: CONFIRMED/SUSPECTED split, context-judged severity (never a fixed map), choice-gated fix menu (never auto-fix a live doc), CoalBoard escalation at the correctness boundary, reports in the user's language.
- **SessionStart conductor** (`hooks/coalledger-conductor.js`, Phoenix-13): offer-on-domain-entry for the full set, honoring `disabledCanaries` and the `docLeak` gate; kind-1 self-update scheduling (hook schedules via a throttled local stamp, the agent verifies online with consent).
- **Commands:** `/coalledger:stats` (measurement standard-system — session findings by canary/severity + suite config state, read-only) · `/coalledger:update` (consent-gated self-update procedure).
- **Config system:** `.coalledger.json` global + per-project cascade (project wins), schema SSoT with clamped reads (`coalledgerMode`, `language`, `disabledCanaries`, `severityFloor`, `quickVsFull`, `docLeak`, `publicMode`, `updateMode`, `updateCheckDays`), commented factory template.
- **Gates:** `build-plugin.mjs` (clean dist: manifest + commands + hooks + skills + engine; tests/fixtures never ship) · `verify.mjs` (files, manifests, skill frontmatter contract, version pins, factory-vs-schema, engine fixture smoke, dist-sync both directions) · `test.mjs` (explicit-file-list runner; hermetic conductor spawn tests included).
- **Docs:** README, SECURITY, PRIVACY, CONTRIBUTING, Apache-2.0 LICENSE + NOTICE.
- **CI:** the flock's four SHA-pinned workflows (ci · codeql · markdownlint · scorecard), dependabot, issue templates.
