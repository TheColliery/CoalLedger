# Changelog

All notable changes to CoalLedger are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/) (the version lives in `.claude-plugin/plugin.json`).

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
