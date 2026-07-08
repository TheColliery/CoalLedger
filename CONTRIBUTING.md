# Contributing to CoalLedger

CoalLedger is the docs-health canary suite of the [TheColliery](https://github.com/TheColliery) series. We welcome issues, bug reports, and pull requests.

---

## 🤝 Proposing a Change

1. **Open an issue first** describing the problem, gap, or proposed feature (especially for a `SKILL.md` or AST-engine change — the engine's rendering fidelity is the load-bearing surface: a check that flags something GitHub renders fine is the failure mode the whole suite exists to avoid).
2. Make your code changes and keep the verification gates green.
3. Validate behavior against the planted fixtures: `scripts/fixtures/` carries defect files (every finding known) and clean decoys (any finding = a false positive) — a check change must keep the decoys at ZERO findings.

---

## 💻 Developing & Testing

CoalLedger is **zero-dependency** (Node.js built-ins only, Node 18+). No `npm install` and no `package.json` — the gates run directly:

```bash
node scripts/build-plugin.mjs   # regenerate plugin/ from source
node scripts/verify.mjs         # gate: manifests, factory config vs schema, skills, version pins, fixtures, dist-sync
node scripts/test.mjs           # zero-dependency test suite (node --test, explicit file list)
```

### Development Rules

- **Rebuild the dist after a source change:** edit `hooks/`, `skills/`, `commands/`, `scripts/lib/`, or the manifest, then `node scripts/build-plugin.mjs` to re-sync `plugin/` (verify fails on a stale dist).
- **`scripts/lib/config-schema.mjs` is the single source of truth** for every `.coalledger.json` key — `verify.mjs` validates the factory template against it; the README key table mirrors it.
- **Detection goes through the AST, never regex over raw markdown:** `md-ast.mjs` (CommonMark+GFM) is the only way a structure check reads a doc — the anti-cry-wolf property. Honest ceiling stays "CommonMark+GFM fidelity", never a GitHub-pixel claim.
- **Keep the hook Phoenix-pure:** zero dependencies, fail-silent (try/catch, exit 0, never `process.exit()`), no network, no child processes, silent except the sanctioned channel.
- **Add tests:** every lib change gets a unit test; every hook-behavior change gets a **hermetic spawn test** (spawn the real hook, sandbox TEMP + HOME). Register a new test *file* in `scripts/test.mjs` (the runner fails on an unlisted orphan).
- **Language & tone:** shipped source and docs stay in English; the canaries themselves REPORT in the user's language.

---

## 🖥️ Supported Platforms

Cross-agent by design — the canaries are plain SKILL.md contracts and the engine is plain Node scripts — but **the conductor hook is Claude-Code-only** (capability-keyed: a platform with lifecycle hooks can wire it; a hookless platform invokes canaries manually or via a best-effort agent-driven offer). A field report from another platform is a welcome contribution.

---

## 🗂️ Project Layout

| Path | Purpose |
|---|---|
| `hooks/coalledger-conductor.js` | SessionStart conductor: canary offers + self-update scheduling (Phoenix-13). |
| `hooks/hooks.json` | Hook wiring via `${CLAUDE_PLUGIN_ROOT}/hooks/…`. |
| `scripts/lib/` | The engine (ESM, shipped): `md-ast` CommonMark+GFM parser · `md-checks` structure checks · config modules. |
| `skills/` | The 6+1 canary contracts (`doc-structure`, `doc-grounding`, `doc-standard`, `doc-rot`, `doc-consistency`, `doc-quality`, `doc-leak`). |
| `commands/` | `/coalledger:stats` (measurement) · `/coalledger:update` (self-update procedure). |
| `scripts/` | Tool scripts: `build-plugin.mjs`, `verify.mjs`, `test.mjs`, the unit/hermetic tests, and `fixtures/` (planted defects + clean decoys). |
| `plugin/` | Generated Claude Code plugin distribution — never hand-edit. |
| `platform-configs/.coalledger.json` | Commented factory default configuration. |

---

## 🚀 Releasing (Maintainers)

Bump version in `.claude-plugin/plugin.json` ➡️ add a `CHANGELOG.md` entry ➡️ ensure `verify.mjs` and `test.mjs` pass ➡️ commit ➡️ create a signed git tag (`vX.Y.Z`) ➡️ push ➡️ create a GitHub Release (stable tags only — with ONE named exception: the repo's FIRST public beta tag ships as a prerelease so the Releases panel is never empty at launch; later beta tags are history-only).

---

## 📄 License & Conduct

Contributions are licensed under the [Apache License 2.0](LICENSE). Please assume good faith and be respectful. Report security issues per [SECURITY.md](SECURITY.md).
