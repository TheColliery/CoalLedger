// CWK-075 — POINTER gate. Ship-text names something that cannot be reached.
//
// WHY THIS IS NOT CWK-060's GATE. That one resolves KEYS against config-schema.mjs.
// These are POINTERS — to a file, a directory, a section, a symbol — and nothing
// resolved them. Same family, different resolver: the key gate asks "is this name in
// the schema", this one asks "is the thing this name points at REACHABLE FROM A CLONE".
//
// THE CHAIR'S RULING THIS ENFORCES (settled; this module does not re-decide it):
// a probe cited as proof is not a throwaway. Cite the DURABLE artefact — a commit SHA,
// a reviewer return, a lab record — and recycle the probe; if the probe file is the only
// evidence, it has stopped being a throwaway, so commit it or restate the claim. A
// GITIGNORED PATH IS NOT A DURABLE CITATION. The gate enforces that distinction. It does
// NOT ban citations, and the shape of that restraint is the whole detection rule below.
//
// ============================================================================
// ⚠ READ THIS BEFORE ANY NUMBER BELOW — WHOSE MEASUREMENT IS WHOSE.
//
// This module is a PORT of CoalMine's, and its header arrived carrying CoalMine's own
// measurements written in the first person ("MEASURED on this repo"). INSPECT found the
// class three times and then found four more instances; patching them figure by figure
// was whack-a-mole, and each patched number would go stale again on its next edit. So
// the layer is ATTRIBUTED once, here, instead:
//
//   EVERY FIGURE BELOW IS COALMINE'S unless a block says OURS. They are retained
//   deliberately, as the REASONING THAT PRODUCED THE RULE -- which step removed which
//   class of false positive, and why each was chosen -- never as a claim about this
//   tree. That reasoning is why the rule has the shape it has, and deleting it would
//   leave a set of unexplained filters.
//
//   COALLEDGER'S OWN MEASUREMENTS, the only first-person numbers in this file, are the
//   FUNNEL block below (48 surfaces / 49 in scope / 49 resolving -- the four terms the
//   gate itself PRINTS at run time) and the BACKSLASH block further down (14 backslash
//   tokens, 2 path-shaped, both this module's own fixtures). Re-derive either with the
//   walk in verify.mjs 2.12. THE TWO SHAPE-FUNNEL INTERMEDIATES (backticked tokens
//   before/after fence-stripping) are deliberately NOT quoted here (CWK-078
//   findings-back MED-3): every `.mjs` comment line in this file is itself a candidate
//   for that count, so the header measures a population that contains itself and
//   falsifies on its own next edit -- CWK-075 r2 measured 1,339/146, and this unit's own
//   +25 comment lines moved it again to 1,347/151 with nobody re-measuring. The four
//   terms above stay honest because the gate PRINTS them fresh every run; the two
//   intermediates cannot, so they are cut rather than re-typed to go stale again.
//
//   THE FLOCK RULE THIS OBEYS: a source's variables are not ours. A ported number is a
//   HYPOTHESIS about a different tree until measured here -- so it is labelled, not
//   silently adopted and not silently deleted.
// ============================================================================
// DETECTION RULE — every step MEASURED before it was chosen, because cry-wolf is the failure mode this room has already
// paid for once (the tripwireMaxLines gate firing on compliant code).
//
//   The rule is TWO layers, and which layer a test belongs to is not cosmetic:
//   SHAPE tests live in pointerCandidates (text only, no tree knowledge); SCOPE tests
//   live in checkPointers (ourRoots, agentHomes, hasEntry). A shape rule that needs the
//   tree is a rule in the wrong place, and CWK-075 r2 moved one back after it silently
//   excluded four of our own tracked files.
//
//   SHAPE (pointerCandidates)                          drops
//     - whitespace                a command or a Markdown table row, not a pointer
//     - <placeholder>             the author already said "not a literal path"
//     - glob metacharacter        a glob names a SET, not a file
//     - no `/`                    a bare filename is the SCANNED user's repo's
//     - absolute / `~` / URL      not this repo's to resolve
//     - a `.` or `..` SEGMENT     navigates, does not NAME; and would escape the repo
//
//   SCOPE (checkPointers)                              decides
//     - an agent install home     the SCANNED project's tree, even where the root is ours
//     - first segment in ourRoots resolve from the repo root
//     - first segment beside the  resolve from the citing file's own directory (or its
//       citer (or its parent)     parent) -- structural, so it is never circular
//
//   MEASURED ON THIS REPO -- CoalLedger, and these are OURS, re-derived here rather
//   than carried over with the file: 48 surfaces -> 49 IN SCOPE -> 49 resolve, 0
//   non-resolving, 0.0% noise. THE TWO SHAPE-FUNNEL INTERMEDIATES (backticked tokens
//   before/after fence-stripping) are deliberately not quoted here -- see the banner
//   above (CWK-078 findings-back MED-3): every comment line in this file is itself a
//   candidate for that count, so it self-invalidates on the file's own next edit, and
//   this unit's own +25 lines already moved it once without anyone noticing. Re-derive
//   with the walk in verify.mjs 2.12; never quote a number forward.
//
//   PORT NOTE (CWK-075 INSPECT MED-1): this block arrived byte-identical to CoalMine's
//   own -- 76 surfaces / 1,483 / 121 / 67 -- under the words "MEASURED on this repo",
//   with a re-derive pointer at ITS block number (2.11, ours is 2.12). A foreign
//   measurement wearing the first person is the same defect this gate's own header
//   already records twice about backticked paths, one layer deeper: the port carried a
//   CLAIM ABOUT A DIFFERENT TREE and the word "this" silently re-pointed it. The numbers
//   above are this room's, produced by the walk named above; the two sets differ in
//   every term, which is exactly why inheriting them would have been wrong rather than
//   merely stale.
//
//   THE TWO SCOPE TESTS ARE CWK-075 ROUND 2, AND BOTH CLOSED A SILENT HOLE, which is the
//   quieter failure and the one this whole class is about. Before them the gate was
//   repo-root-anchored and dropped every dot-first token, so 40 citations were checked
//   where 67 were checkable:
//     +15  citer-relative -- `references/checks.md` cited from its own skill dir was
//          never checked at all. A sibling room's gate called such a path NON-RESOLVING
//          (a loud false positive); ours dropped it from coverage without a word.
//     +16  dot-dir -- `.claude-plugin/plugin.json`, `.githooks/`, `.github/workflows/ci.yml`
//          are real TRACKED files of ours that the extractor discarded on sight. TWELVE
//          were in the surfaces as they stood; the other four are dot-dir citations this
//          very header adds while explaining the fix, and they are dot-dir citations like
//          any other -- an earlier wording counted them as a separate "+4 new header"
//          term, which double-counts the same tokens under two labels. 15 + 16 = 31, and
//          40 + 31 = 71, the number the pass line reports.
//   Noise stayed 0.0% across both, which is the number that had to hold.
//
// THE INSIGHT THAT MAKES THE RULE WORK, and a naive rule unusable: a shipped skill's
// prose names files in the SCANNED USER's repo — `package-lock.json`, `STANDARDS.md`,
// a bare `SKILL.md` — which by construction do not exist in ours. Those are not
// pointers into our tree at all. Steps 5-8 are four different ways of saying the same
// thing: only a path ROOTED IN OUR OWN TREE is a claim this repo can be wrong about.
//
// Steps 2, 3, 6 and 7 were NOT in the rule as first sketched, and each removed a whole
// class of false positive that a directory-component rule alone leaves standing:
//   2  shell commands and Markdown table rows are path-shaped (`node scripts/install.mjs
//      cursor`, `| package | direct/transitive | ... |`) — a SPACE is what separates a
//      command from a pointer.
//   3  `<gitroot>/.coalmine.json`, `plugin/skills/<name>/SKILL.md` are TEMPLATES; the
//      angle bracket is the author already saying "this is not a literal path".
//   6  a URL or an absolute path is not this repo's to resolve.
//   7  `.cursor/skills/`, `.gemini/skills/`, `.claude/rules/`, `.git/hooks` — a DOT-DIR
//      is an agent or tool HOME, and shipped prose names those in the USER's project.
//      This is step 8's insight one level up, and without it the residue is 15.9% noise
//      of which every single flag is wrong.
//
// NAMED BLIND SPOTS — stated as what is UNCOVERED, with its measured cost, never as a
// denial. A reader who is only told what the gate is NOT learns nothing about what is
// exposed; this room's own flock rail, applied to this gate first.
//
//   1. AN UNBACKTICKED PATH IS INVISIBLE. Extraction keys on backticks, so a path named
//      in plain prose is never a candidate — it cannot fail, and it cannot be counted in
//      the pass line either. MEASURED, fenced code stripped FIRST (a sibling room's own
//      count moved 6 -> 7 -> 2 the moment fences were stripped, so the order is part of
//      the measurement): 2 unbackticked path-shaped tokens rooted in our own tree, and
//      BOTH are grep artefacts rather than citations — "skills/_shared" is a Markdown H1
//      that happens to be a directory name, and "hooks/scripts" in README is English
//      prose meaning "hooks and scripts". They are quoted here WITHOUT backticks on
//      purpose: backticking them makes them real citations, and when this paragraph was
//      first written the gate FAILED on this very comment, naming the second token as a
//      citation that does not resolve. The documentation of a blind spot must not
//      manufacture one — twice over, since the first reword quoted the FAIL message
//      verbatim and re-introduced the backticks it was reporting. So the uncovered
//      population is 2 tokens and 0 real citations today. That is the cost, and it is
//      small because the house style already backticks paths — not because the gate
//      reaches them.
//
//   2. A SECTION AND A SYMBOL ARE NOT RESOLVED AT ALL. Not "the gate is path-only" — the
//      uncovered things are: a `file.md` §Heading whose heading has moved, and a
//      backticked identifier in a comment whose symbol has been renamed. Both were
//      measured and both flood (below); nothing checks them, and the pass line says so.
//
// ============================================================================
// WHAT IS NOT SHIPPED, AND THE MEASUREMENT THAT DECIDED IT. The dispatch asked for
// three resolvers — path, section, symbol. PATH is shipped. The other two were measured
// FIRST and both flood; shipping them would have been the cry-wolf gate this rule's own
// step-by-step exists to avoid.
//
//   SECTION ("the X section below", `file.md` §Heading):
//     - SELF-REFERENTIAL pointers are a population of FOUR across every .md and .mjs in
//       the tree, and all four resolve. A gate over four passing candidates buys nothing.
//     - Worse, the matcher cannot be made honest: run against CWK-059's own history
//       (`config-keys.mjs` at 04116d1 and 209689b) a "<token> ... below" rule reports
//       8 candidates and 6 DANGLING — and all six are false, because natural language
//       puts the wrong word next to "below" (`matches KEY_SHAPE below` is read as
//       "matches ... below"). 75% noise, 100% of it wrong.
//     - CROSS-FILE section refs are ~55 and the overwhelming majority target files that
//       do not exist here at all (`hooks-safety.md` §9, `skill-authoring.md` §3b live in
//       the umbrella). Resolving them is not this repo's job.
//
//   SYMBOL (a backticked identifier in our own code comments):
//     - 45 candidates, 37 resolve, 8 do not — 17.8% noise, AND ALL EIGHT FLAGS ARE
//       FALSE. Every one is a symbol named as a REJECTED ALTERNATIVE or an external
//       stdlib name the comment says we do NOT call (`renameSync`, `statSync`,
//       `appendFileSync`, `ignoreExclusions`, `disableFilters`). Discriminating "named
//       as the thing we use" from "named as the thing we rejected" is prose parsing, and
//       after such a filter the surviving population is all-resolving — a gate that
//       catches nothing.
//
//   So: partial coverage, STATED. Path is machine-checked; section and symbol are not
//   checked at all, by these numbers, and nobody should read this gate's green as
//   covering them.
//
// ============================================================================
// ADOPTER CONTRACT — DATA, never LOGIC. Six rooms reached six different verdicts on
// CWK-060's filter and this rule will fare no better, so nothing below hardcodes
// CoalMine's layout. A room supplies: its own surfaces (walked), its own ourRoots and
// ignoredRoots (derived from ITS tree), its own agentHomes, and its own hasEntry() and
// resolve(). Every one of those is DATA read out of the adopting tree; none of them is
// a decision this module makes for a room.
//
// agentHomes, CORRECTED (CWK-078) — the FIRST version of this contract derived
// agentHomes from whatever map a tool uses to WRITE into a user's tree (CoalMine's own
// targets map), reasoned this room "HAS NONE, ships no installer" and therefore shipped
// agentHomes as the EMPTY SET. That was the WRONG AXIS: this gate asks what a citation
// READS a key FROM in a user's tree, and reading needs no installer at all. This room's
// own cascade (config-load.mjs's projectConfigCandidates) already names its agent-home
// roots without ever writing to one, and verify.mjs 2.12 now derives agentHomes from
// exactly that. The empty set was itself the two-files-one-unit defect CWK-075's own
// INSPECT records elsewhere in this file (a ported line naming a file we lack, paired
// with our own wiring depending on its absence) — this comment is the corrected half.

// SURFACE PLAN, DECLARED (CWK-090 fix 3, ported from CoalMine -- CoalHearth's original
// finding). "scripts/+hooks/ comments are a walked surface" was CODE in `verify.mjs` --
// two hardcoded for-loops (concatenated for skills+commands, and again for
// scripts+hooks) with no countable home, so a room copying the shape had to READ the
// driver to know what it walks. That is THIS room's own variable, not the flock's:
// CoalMine's own default plan carries 14 rows (an `agents/` doc dir, `.githooks/` and
// `.ps1` hash-comment rows, `.github/ISSUE_TEMPLATE`); this room has none of those as
// walked surfaces. Now the walk is DATA, one row per surface, each carrying its own
// `why` -- the same reason `declaredOutClasses` (verify.mjs) is already data and not a
// comment: a prose list restating a table is a second source of truth that drifts.
//
// THE NARROWING FORM, one sentence an adopter copies rather than guesses: a room that
// walks fewer surfaces DELETES the row and states its reason in the row's own `why`,
// never by editing `collectSurfaces` or leaving the row in place unused.
//
// `kind` is one of four: `md` (a directory of markdown files, walked recursively, whole
// text) · `raw` (a single file's whole text, OR a directory walk with an extension
// filter and no comment-line stripping) · `comments` (a directory walk, `//`/`*`-prefixed
// lines only) · `hash-comments` (a directory walk, `#`-prefixed lines only). `dir: true`
// means `root` is a directory to walk; its absence means `root` is one exact file.
// `historyOnly: true` marks a surface `checkPointers` binds to the gitignored-root case
// only, never the ordinary resolve check (CHANGELOG.md — published history is never
// fixed forward).
//
// FOUR ROWS COALMINE CARRIES AND THIS ROOM DOES NOT, each checked against THIS tree
// before being left out (never assumed from the order that named them) -- CWK-090's own
// dispatch claimed two of these as "this room does not have"; both were WRONG as a claim
// about the tree (this room DOES have `.githooks/pre-commit`+`pre-push` and
// `.github/ISSUE_TEMPLATE/*.yml`) and RIGHT as a claim about what the gate WALKS today --
// this room's own pre-existing `declaredOutClasses` (verify.mjs) already disposes of both,
// and fix 3 is a walk-MECHANISM port, never a surface-identity change (the fingerprint
// proof below is the reason that boundary is not this unit's to cross):
//   - `agents` (md, dir) -- no `agents/` directory exists anywhere in this room's tree.
//   - `.githooks` (hash-comments) -- `.githooks/pre-commit`+`pre-push` exist and carry
//     `#`-comments, but this room's `declaredOutClasses` already names `.githooks/**`
//     out ("git hook scripts, not ship-text") -- kept that disposition rather than
//     silently widening what the pointer gate reads.
//   - `.ps1` hash-comments, scripts/ and hooks/ sides -- zero `.ps1` files anywhere in
//     this room (`find . -iname *.ps1` returns nothing); this room ships no PowerShell
//     fallback/`alt/` at all.
//   - `.github/ISSUE_TEMPLATE` (raw, ext `.yml`) -- the files exist and carry real prose
//     (a version-pin citation among them), but this room's `declaredOutClasses` folds
//     ALL of `.github/**` into one declared-out class today. Splitting that class so the
//     pointer gate also reads ISSUE_TEMPLATE prose would be a genuine, separate widening
//     of this gate's reach -- named here as a follow-up, not done inside a fix-3 port
//     whose own proof obligation is that the surface set does NOT move.
export const DEFAULT_SURFACE_PLAN = [
  { kind: 'md', root: 'skills', dir: true,
    why: 'every canary body is ship-text a user reads' },
  { kind: 'md', root: 'commands', dir: true,
    why: 'command docs are ship-text a user reads' },
  { kind: 'raw', root: 'README.md',
    why: 'the front door -- every install/config claim starts here' },
  { kind: 'raw', root: 'CONTRIBUTING.md',
    why: 'the dev-facing surface, and it cites internal paths' },
  { kind: 'raw', root: 'SECURITY.md',
    why: 'the disclosure surface, and it cites internal paths (e.g. a hook line ref)' },
  { kind: 'raw', root: 'PRIVACY.md',
    why: 'the privacy surface, and it cites internal paths' },
  { kind: 'comments', root: 'scripts', dir: true, ext: /\.(mjs|js)$/,
    why: 'a path inside CODE is exercised by the tests; a path inside a COMMENT is exercised by nothing at all' },
  { kind: 'comments', root: 'hooks', dir: true, ext: /\.(mjs|js)$/,
    why: 'same class as the scripts/ row, hooks/ side' },
  { kind: 'raw', root: 'CHANGELOG.md', historyOnly: true,
    why: 'published history is never fixed forward -- a path correct when the entry was written is not a defect now, but a gitignored citation was never correct on any day' },
];

// COLLECT — plan-driven, DI'd fs so this module stays pure (it imports nothing today and
// must not start). `io.join`/`io.walkMd`/`io.walkSrc`/`io.read`/`io.rel` are the SAME
// filesystem primitives the caller already owns; `io.commentLines`/`io.hashComments` are
// the two comment-line filters. `io.walkMd(dir)` returns absolute `.md` paths recursively;
// `io.walkSrc(dir, keep)` returns absolute paths whose basename passes `keep(name)`.
// Runs the plan in ORDER, so a room's own surface count/order is exactly its plan's —
// no hidden reordering. Ported byte-for-byte from CoalMine's own module (CWK-090 fix 3) —
// this function carries no CoalMine-specific fact, only the plan/collector contract.
export function collectSurfaces(repo, plan, io) {
  const surfaces = [];
  for (const row of plan) {
    if (row.dir) {
      const abs = io.join(repo, row.root);
      if (row.kind === 'md') {
        for (const f of io.walkMd(abs)) surfaces.push({ label: io.rel(f), text: io.read(f) });
      } else {
        const keep = row.ext ? (n) => row.ext.test(n) : () => true;
        for (const f of io.walkSrc(abs, keep)) {
          const src = io.read(f);
          let text;
          if (row.kind === 'comments') text = src === null ? null : io.commentLines(src);
          else if (row.kind === 'hash-comments') text = src === null ? null : io.hashComments(src);
          else text = src; // 'raw' dir-walk: whole file, no comment-line filter
          surfaces.push({ label: io.rel(f), text });
        }
      }
    } else {
      const s = { label: row.root, text: io.read(io.join(repo, row.root)) };
      if (row.historyOnly) s.historyOnly = true;
      surfaces.push(s);
    }
  }
  return surfaces;
}

// A path this room deliberately points at BEFORE it exists. Ships EMPTY, and the empty
// list is a MEASUREMENT, not an omission -- but the "67 of 67 at the CWK-075 r2
// re-measurement" figure once printed here was COALMINE'S OWN number, not ours: it is
// byte-identical in CoalMine's own scripts/lib/pointer-check.mjs (diff the two files'
// comment blocks to re-derive this), carried over unchanged by the port per this file's
// own attribution banner ("every figure is CoalMine's unless a block says OURS") --
// never re-measured for this tree, which is exactly the port-defect class that banner
// exists to name (CWK-078 findings-back F2). THIS ROOM's own figure is the attribution
// banner's own FUNNEL block above (48 surfaces / 49 in scope / 49 resolving), which
// matches the live gate's own printed pass line -- re-derive with the walk in verify.mjs
// 2.12, never trust either number quoted here. The POINT stands unchanged either way:
// every in-scope pointer resolves, so nothing here has needed a declaration yet.
//
// The mechanism exists anyway, and that is a decision with a reason rather than padding:
// without an escape hatch the first legitimate forward pointer hard-FAILs, and the
// cheapest way to make a FAIL go away is to delete the gate. Same EVENT-based expiry as
// PENDING_KEYS/NOT_CONFIG — a declaration is pruned by what BECOMES TRUE, never by a
// date nobody re-reads.
export const PENDING_POINTERS = [
  // { path: 'scripts/lib/thing.mjs', reason: 'CWK-000 — landing next unit' },
];

// CHECK-IGNORE CLASSIFIER (CWK-090 fix 1, ported byte-for-byte from CoalMine, whose own
// header names OUR `94e994f` as the parallel measurement this closes across the flock).
// Pure -- takes the exact shape a `spawnSync('git', ['check-ignore', '--stdin'], {...})`
// result carries and answers ONE question: did this run actually tell us anything? Exit
// 0 and exit 1 both SUCCEED (1 = "none of the fed paths are ignored", not an error); a
// spawn error or any OTHER status (128 included -- a bad pattern, an unreadable
// `.gitignore`, a broken worktree) means the run answered NOTHING, and the caller must
// not treat an empty stdout as "zero ignored". OUR own pre-fix code (shipped `94e994f`)
// checked `!ci.error && typeof ci.stdout === 'string'` inline in `verify.mjs` -- the
// identical fail-open shape CoalMine independently found and fixed the same way, closed
// there by moving the classification out where a mutation test can drive it (see
// `applyCheckIgnoreProbe` below).
//
// Exported and kept pure so this classification is unit-testable without a real git
// child. NOT independently re-attempted on this box: CoalMine measured no reliable way
// to force `check-ignore --stdin` to a non-0/1 exit while `ls-files` (verify.mjs's own
// pre-gate, same cwd) still succeeds -- every malformed-input shape they tried degraded
// to exit 1 or was unreachable through their own hardcoded args, and the one REAL
// non-0/1 exit they reproduced (129, an unknown option) needed a flag verify.mjs never
// passes. That result is a property of `git check-ignore --stdin`'s own exit contract,
// not of CoalMine's tree, so it is ported as a fact about git rather than re-measured
// per room -- this room's own PROOF is instead the wiring test below (mutation, not a
// forced git exit): the pre-DI inline guard mutated to `if (false)` left this room's
// OWN suite byte-identically green at 266/266 (recorded before this fix landed), the
// same fail-open shape CoalMine's own INSPECT found in their inline call site.
export function classifyCheckIgnoreResult(ci) {
  if (ci.error) {
    return { ok: false, message: `git check-ignore --stdin failed to spawn: ${ci.error.message}` };
  }
  if (ci.status !== 0 && ci.status !== 1) {
    const stderrLine = typeof ci.stderr === 'string' ? ci.stderr.split('\n')[0].trim() : '';
    return {
      ok: false,
      message: `git check-ignore --stdin exited ${ci.status}${stderrLine ? ` -- ${stderrLine}` : ''} -- cannot tell which cited roots are gitignored`,
    };
  }
  // NAMED BOUND -- exit 0 means AT LEAST ONE fed path matched, but a non-string or
  // empty-of-content stdout here would still answer ok with zero recovered roots: git
  // said something matched, this classifier would conclude nothing did. UNREACHABLE
  // today, on both halves -- `encoding: 'utf8'` makes `ci.stdout` a string whenever the
  // spawn itself did not error (caught by the branch above), and verify.mjs never passes
  // `-q` (the one flag that pairs a silent, empty stdout with exit 0). A stated bound,
  // not a guard: adding a branch for a case nothing can reach is the over-hardening this
  // room's own rules ban, the same register as the NAMED BOUNDs already carrying that
  // exact phrase in this file and in verify.mjs.
  return { ok: true, stdout: typeof ci.stdout === 'string' ? ci.stdout : '' };
}

// APPLY the check-ignore probe's verdict onto `ignoredRoots`, or FAIL loudly (CWK-090
// fix 1, the WIRING half). `classifyCheckIgnoreResult` above is pure and well
// unit-tested; nothing ties THAT classification to the gate's own `fail()` unless the
// call site is DI'd -- CoalMine's own INSPECT proved this by mutating their inline
// `if (!verdict.ok) { fail(...) }` to `if (false)` and watching their whole suite stay
// green, because nothing exercised the branch. This room's OWN pre-DI equivalent (the
// bare `if (ci.error || (ci.status !== 0 && ci.status !== 1))` shipped at `94e994f`)
// carries the identical hole, proven the same way as part of this fix (see the
// classifier comment above).
//
// WHAT ACTUALLY CLOSES THE HOLE IS THIS ROOM'S OWN COVERAGE, NOT A PROPERTY OF THE FIX
// (CWK-092, CoalMine's own re-measurement, flowed back): the DI moves the branch to a
// place a test CAN reach; it does not by itself GUARANTEE one reaches it. CoalTipple ran
// the identical mutation against the identical fix and it did NOT reproduce there -- no
// wiring test exercised that branch in that room's tree, so the mutant stayed green.
// MEASURED HERE, three rows, re-derived rather than carried from CoalMine's own table
// (a different tree, a different count -- THE SOURCE'S VARIABLES ARE NOT OURS):
//   baseline (this file unmutated)                                309 / 309 / 0 / 0
//   mutation `if (!verdict.ok)` -> `if (false)`, whole suite      309 / 308 / 1 / 0
//   same mutation, the 3 applyCheckIgnoreProbe tests DELETED      306 / 306 / 0 / 0
// Row 3 is the point: delete the coverage and the mutation goes green again, on THIS
// tree exactly as it did on CoalTipple's. So the credit for closing the class belongs to
// the wiring test below, not to the DI shape alone -- an adopter that ports this function
// without a test exercising its `fail()` branch should EXPECT CoalTipple's result, not
// treat it as an exception. Moved out of `verify.mjs` into this exported function so a
// unit test can drive the EXACT code `verify.mjs` runs, with an injected `runCheckIgnore`
// in place of a real `spawnSync` -- the same DI shape `collectSurfaces(repo, plan, io)`
// already uses for the surface walk, applied to the sibling spawn site. Ported
// byte-for-byte from CoalMine's module; no room-specific fact lives in this function.
// `runCheckIgnore(input)` takes the newline-joined probe input and returns the same
// `{status, stdout, stderr, error}` shape a real `spawnSync` result carries.
//
// PROBE_SUFFIX is exported (CWK-092 flow-back 3) -- it is this module's OWN constant
// (what the probe appends to a candidate root before feeding `git check-ignore`), not
// the driver's to declare. `probeSuffix` DEFAULTS to it, so a caller cannot hold a
// stale copy that drifts from what this function actually probes with -- `verify.mjs`'s
// own call site used to declare a bare local `const PROBE_SUFFIX = '/.pointer-check-probe'`
// and pass it in required; two sources of truth for one literal, closed by making the
// module the one place it is spelled.
export const PROBE_SUFFIX = '/.pointer-check-probe';

// RETURNS a fresh Set (CWK-092 flow-back 3) rather than mutating a caller-owned one.
// The pre-flow-back shape took `ignoredRoots` as a required param and pushed into it --
// this function OWNS the set it produces; a caller consumes the return, it does not
// hand in an accumulator for this function to fill. `verify.mjs`'s own call site is
// updated to match: `const ignoredRoots = applyCheckIgnoreProbe({ toProbe, fail, runCheckIgnore })`.
export function applyCheckIgnoreProbe({ toProbe, probeSuffix = PROBE_SUFFIX, fail, runCheckIgnore }) {
  const ignored = new Set();
  if (!toProbe.length) return ignored;
  const ci = runCheckIgnore(toProbe.map((n) => n + probeSuffix).join('\n') + '\n');
  const verdict = classifyCheckIgnoreResult(ci);
  if (!verdict.ok) {
    fail(verdict.message);
    return ignored;
  }
  for (const line of verdict.stdout.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    ignored.add(t.endsWith(probeSuffix) ? t.slice(0, -probeSuffix.length) : t.replace(/\/$/, ''));
  }
  return ignored;
}

const GLOB = /[*?[\]{}|]/;
const OUTSIDE = /^([~/]|[A-Za-z]:|[a-z][a-z0-9+.-]*:\/\/)/;
// A `.` or `..` SEGMENT -- never a dot-DIR like `.github`, which is a real name.
const DOTSEG = /(^|\/)\.\.?(\/|$)/;
// A BACKSLASH is not a separator this gate reads (CWK-075 r2 LOW-1). DOTSEG is
// segment-whole for `/`-delimited tokens and that property is untouched -- but it does
// not see a BACKSLASH-delimited segment, so `scripts/..\..\escape.md` survived every
// shape test, took the ourRoots branch on `scripts`, and path.resolve landed OUTSIDE
// the repo (measured). That is this room's own recorded lesson -- resolve-and-contain,
// not segment-scan, because a scan misses `\` on Windows -- reappearing inside the fix
// written to close a traversal hole.
//
// REJECTION rather than a wider separator class, and the reason is the lesson itself:
// widening DOTSEG keeps the segment-scan SHAPE and patches one miss, leaving the
// invariant platform-conditional. Rejecting the character makes it unconditional --
// A CITATION IN OUR SURFACES IS `/`-DELIMITED, on every platform, full stop -- and it
// closes more than the traversal case: `scripts\lib/x.mjs` (mixed) yields a first
// segment nothing matches, so it was SILENTLY skipped rather than dangerous. Half the
// class was quiet and half was live; now the whole class is out of scope uniformly.
//
// MEASURED HERE BEFORE KEEPING IT, on CoalLedger's own 48 surfaces rather than on the
// exemplar's (CWK-075 INSPECT MED-2: the ported line cited "9 tokens across the 76
// surfaces" -- CoalMine's population, and the LOAD-BEARING basis for this rule's own
// named blind spot, so inheriting it would have justified our exclusion with another
// room's evidence): 14 backticked tokens contain a backslash, and exactly 2 are
// path-shaped. BOTH are in THIS FILE -- the two fixture strings in the header above,
// written to illustrate the rejection itself. So outside this module the live
// population is ZERO, and the rejection removes nothing that reaches the scope tests.
// The blind spot stands as stated; only its evidence is now ours.
//
// NAMED BLIND SPOT, not a denial: a legitimate WINDOWS-STYLE citation is now dropped,
// unchecked and unannounced. Measured population today: zero. If that ever stops being
// zero the right answer is to normalise separators at the boundary, never to re-admit
// the character into a segment scan.
const BACKSLASH = /\\/;

// LAST-SEGMENT SHAPE TEST (CWK-079, ported from CoalMine's own CWK-079 -- 6588d14
// .. 8fcf443) -- feeds ONLY verify.mjs's ignore-probe candidate-root derivation, NEVER
// pointerCandidates' own resolve-path population below. Kept OUT of pointerCandidates
// deliberately: a token this test rejects may still be a real, existing, TRACKED
// citation (`.github/workflows`, `scripts/lib`) that the ordinary resolve() check must
// keep seeing -- narrowing pointerCandidates itself would silently drop those from
// resolution checking too, a different and unrelated regression from the one this test
// exists to fix.
//
// THE DEFECT THIS CLOSES: a token containing a `/` is not necessarily a path -- the
// no-`/` drop below (:335) proves the token HAS a slash, never what the slash
// SEPARATES. MEASURED ON THIS REPO (not carried over from CoalMine's own 51/36 -- a
// different tree, a different count, per THE SOURCE'S VARIABLES ARE NOT OURS): 71
// distinct backticked candidate tokens across our surfaces, 10 shape-rejected --
// `log/slog` (a Go package pair), four `js/<codeql-query-id>` tokens, `github/codeql-action`
// and `DavidAnson/markdownlint-cli2-action` (workflow action refs, an owner/repo pair,
// not a path), plus `.git/hooks` and `scripts/lib` and `.github/workflows` -- the last
// two are the DISCOVERY-EXCLUDED-but-still-tracked population named below. Re-derive:
// walk every surface through `pointerCandidates`, partition by `looksPathShaped`.
//
// THIS GATES DISCOVERY ONLY, NOT JUDGEMENT (CoalMine's own findings-back round-2 lesson,
// ported alongside the mechanism it corrects, so the same defect is not re-discovered
// here later): this test decides which ROOTS verify.mjs adds to its ignore-probe
// candidates; it is never consulted by `checkPointers`' own `ignoredRoots.has(first)`
// branch below, which judges EVERY token reaching it regardless of shape. So a rejected
// token is NOT excluded from the check -- it is excluded only from CONTRIBUTING ITS OWN
// ROOT to the set the check runs against. The true property is NON-LOCAL: a citation
// this test rejects is checked IF AND ONLY IF some OTHER, unrelated, path-shaped
// citation anywhere in the surface set shares its first segment. PROVEN LIVE in
// verify.test.mjs with a two-plant pair (a shape-rejected citation planted alone stays
// silent; the same citation planted beside a shape-qualified sibling under the same
// gitignored root FAILs both).
//
// THE TEST: strip a trailing `:line(-line)?` ref (the same suffix `normalise()` strips
// for resolution below), then either the token ends in `/` (an explicit directory
// reference) or its LAST segment carries a `.ext`-shaped suffix (a filename). Both are
// the deliberate, common path conventions this house's own prose already uses;
// arithmetic, rule-force pairs, workflow-action refs, and CodeQL query ids carry
// neither.
//
// THE RESIDUE, both directions, named rather than hidden:
//   - STILL LETS THROUGH: a token ending `/` is accepted with no check on what precedes
//     it -- `os.tmpdir()/coalledger/` (a function call, not a directory) still reaches
//     the probe. Harmless in practice (no real `.gitignore` pattern is named that),
//     named here rather than papered over with a further heuristic. A latent
//     accept-side case nobody has hit: the LAST-segment test accepts an ALL-DIGIT
//     "extension" (`.[A-Za-z0-9]{1,10}` matches digits too), so a slash-separated
//     version-shaped token would pass as filename-shaped. Measured population on this
//     tree today: ZERO.
//   - DISCOVERY-EXCLUDED, but NOT check-exempt per the non-locality above: an
//     extensionless real path with no trailing slash is no longer a source of its own
//     root. Two such paths are real, cited, tracked citations on this tree today --
//     `.github/workflows` and `scripts/lib`. Live cost on THIS tree is zero regardless
//     of the non-locality above -- not because they are covered by some other citation,
//     but because neither root (`.github`, `scripts`) matches any pattern in this
//     room's own `.gitignore` today (CLAUDE.md, MEMORY*.md, AGENTS.md, .claude/,
//     .agents/, COALLEDGER_BLUEPRINT.md, skillspector-*, skills-lock.json,
//     dist-claude-ai/ -- neither name is on that list). Both are exposed to the
//     non-locality above the moment a sibling, path-shaped citation under the same
//     root is ever gitignored.
export function looksPathShaped(tok) {
  const t = tok.replace(/:\d+(-\d+)?$/, '');
  if (t.endsWith('/')) return true;
  return /\.[A-Za-z0-9]{1,10}$/.test(t.split('/').pop());
}

// Candidate extraction. Exported so an adopter can measure its OWN funnel with the
// same instrument rather than re-implementing it and getting different numbers.
export function pointerCandidates(text) {
  const out = [];
  // Fenced code blocks are EXAMPLES, not prose claims about this tree.
  const prose = String(text).replace(/^```[\s\S]*?^```/gm, '');
  for (const m of prose.matchAll(/`([^`\n]+)`/g)) {
    const tok = m[1];
    if (/\s/.test(tok)) continue;          // a command or a table row, not a pointer
    if (/[<>]/.test(tok)) continue;        // <placeholder>
    if (GLOB.test(tok)) continue;          // a glob names a SET, not a file
    if (!tok.includes('/')) continue;      // a bare filename is the USER's repo's
    if (OUTSIDE.test(tok)) continue;       // absolute, home-relative, or a URL
    if (DOTSEG.test(tok)) continue;        // `../` navigates, it does not NAME a path,
                                           // and it would also escape the repo on resolve
    if (BACKSLASH.test(tok)) continue;     // not a separator this gate reads -- see above
    // A DOT-DIR IS NO LONGER DROPPED HERE. It was, and that silently excluded four real
    // tracked files of ours (.claude-plugin/plugin.json, .githooks/, .github/workflows/ci.yml).
    // Whether a dot-dir is OURS or the scanned project's is TREE knowledge, not text shape,
    // so the decision moved to checkPointers where ourRoots and agentHomes exist.
    out.push(tok);
  }
  return out;
}

// `docs/x.md:12` and `scripts/` both name a real thing; the suffix and the trailing
// slash are punctuation, not part of the path.
function normalise(tok) {
  return tok.replace(/:\d+(-\d+)?$/, '').replace(/\/+$/, '');
}

export function checkPointers({
  surfaces = [],          // [{ label, text, historyOnly? }]
  ourRoots = new Set(),   // top-level names that belong to THIS repo
  ignoredRoots = new Set(), // first segments of CITED paths that .gitignore matches (CWK-079: existence-independent -- not a listing of dirs the caller has on disk)
  agentHomes = new Set(), // repo-relative install homes this tool writes INTO A USER's tree
  hasEntry = () => false, // (relDir, name) => boolean -- does `name` exist directly in relDir
  resolve,                // (relPath) => 'tracked' | 'untracked' | 'missing'
  pending = PENDING_POINTERS,
} = {}) {
  const findings = [];
  if (typeof resolve !== 'function') {
    findings.push({ level: 'FAIL', msg: 'pointer check: no resolve() supplied — the gate cannot answer its own question' });
    return findings;
  }

  const cited = new Set();
  let checked = 0;

  for (const s of surfaces) {
    if (typeof s.text !== 'string') {
      // NAME what could not be read. A caller that filters unreadable surfaces out
      // first hides its own scope gap — the silent narrowing this family of gates
      // exists to catch, committed by the gate's own wiring.
      findings.push({ level: 'SKIP', msg: `pointer check could not read ${s.label}` });
      continue;
    }
    const seen = new Set();
    for (const tok of pointerCandidates(s.text)) {
      if (seen.has(tok)) continue;
      seen.add(tok);
      const first = tok.split('/')[0];

      // A GITIGNORED ROOT IS THE SHARP CASE, and it is decided WITHOUT resolving:
      // from any other machine "gitignored" and "does not exist" are indistinguishable,
      // so such a path was never durable — not even on the day it was written. That is
      // why this branch also binds a history-only surface, where the ordinary
      // resolution check does not: a renamed file was a correct citation once, a
      // scratchpad path never was.
      // NOTE this branch runs BEFORE `pending` is consulted, deliberately: a declaration
      // can excuse a path that does not exist YET, never one that exists and is
      // unreachable from a clone. A gitignored citation cannot be declared durable.
      if (ignoredRoots.has(first)) {
        cited.add(normalise(tok));
        checked++;
        findings.push({
          level: 'FAIL',
          msg: `${s.label} cites \`${tok}\`, which lives under the gitignored \`${first}/\` — not reachable from a clone. Cite the durable artefact (a commit SHA, a shipped doc) or commit the file.`,
        });
        continue;
      }

      // AN AGENT INSTALL HOME NAMES THE SCANNED PROJECT'S TREE, NEVER OURS -- and the two
      // genuinely collide: .github/skills/ is Copilot's home while `.github/workflows/`
      // is ours. CWK-075 PORT NOTE: the first of those is deliberately UNBACKTICKED
      // here. CoalMine has that directory; this room does not, so the backticked form
      // it shipped with FAILED this very gate on its first run in this tree -- the
      // exemplar's own recorded lesson (the documentation of a blind spot must not
      // manufacture one) reproducing itself through the act of porting the document.
      // is ours, same root, opposite owner, indistinguishable from the token alone. The
      // set is DERIVED from the tool's own TARGETS map, never enumerated here, so it
      // cannot rot the day a vendor path changes.
      const norm = normalise(tok);
      if (agentHomes.has(norm) || [...agentHomes].some((h) => norm.startsWith(h + '/'))) continue;

      // SCOPE, two independent tests, either sufficient -- and BOTH are structural, so
      // neither is circular. The old rule was repo-root only, which SILENTLY SKIPPED any
      // token whose first segment is not a top-level dir: `references/checks.md` cited
      // from its own skill dir was never checked at all. A skipped citation is the
      // quieter failure than a wrongly-flagged one, and it is the failure this whole
      // class is about.
      const citerDir = s.label.includes('/') ? s.label.slice(0, s.label.lastIndexOf('/')) : '';
      const parentDir = citerDir.includes('/') ? citerDir.slice(0, citerDir.lastIndexOf('/')) : '';
      let base = null;
      if (ourRoots.has(first)) base = '';
      else if (citerDir && hasEntry(citerDir, first)) base = citerDir;
      else if (parentDir && hasEntry(parentDir, first)) base = parentDir;
      if (base === null) continue;  // a path into someone else's tree
      cited.add(norm);

      // Published history is never fixed forward: a path that was correct when the
      // entry was written is not a defect now. Such a surface is checked for the
      // gitignored case above and nothing else.
      if (s.historyOnly) continue;

      checked++;
      const rel = base ? base + '/' + norm : norm;
      const state = resolve(rel);
      if (state === 'tracked') continue;
      if (pending.some((p) => p && p.path === rel)) continue;
      if (state === 'untracked') {
        findings.push({ level: 'FAIL', msg: `${s.label} cites \`${tok}\`, which exists here but is UNTRACKED — a clone does not have it. Commit it, or cite the durable artefact.` });
      } else {
        findings.push({ level: 'FAIL', msg: `${s.label} cites \`${tok}\`, which does not resolve in this repo` });
      }
    }
  }

  // EVENT-based expiry, both directions. A declaration list nobody prunes becomes a
  // permanent hole with an author's name on it.
  for (const p of pending) {
    if (!p || !p.path) { findings.push({ level: 'FAIL', msg: 'PENDING_POINTERS entry has no path' }); continue; }
    if (!p.reason) { findings.push({ level: 'FAIL', msg: `PENDING_POINTERS declares ${p.path} with no reason — an allowlist of bare strings is a bypass with no author` }); }
    if (resolve(p.path) === 'tracked') {
      findings.push({ level: 'FAIL', msg: `PENDING_POINTERS declares ${p.path} as not-yet-existing, but it now resolves — delete the entry` });
    } else if (!cited.has(p.path)) {
      findings.push({ level: 'FAIL', msg: `PENDING_POINTERS declares ${p.path}, but no in-scope surface cites it — delete the entry` });
    }
  }

  findings.checked = checked;
  return findings;
}
