// CWK-133/C-4 + CWK-136 -- the git-spawn census for THIS room. Two rungs, both in one
// textual pass:
//   (1) PRESENCE (the CoalTipple exemplar's own census): does every spawnSync('git'...)/
//       execFileSync('git'...) call carry an explicit `env:` key at all? A bare git spawn
//       with no `env:` inherits process.env verbatim -- the CWK-133 hazard (a linked
//       worktree's own hook exporting an absolute GIT_DIR redirects the spawn onto the
//       enclosing repository instead of its own `cwd`).
//   (2) SAFETY (the CWK-136 finding on that exemplar): `env:` can be PRESENT and still be
//       the hole -- `env: process.env`, or a spread/pass-through that mentions it, lets
//       the exact same GIT_DIR straight through. Present is not safe; only gitEnv()
//       (scripts/lib/git-env.mjs) strips the whole GIT_* family, so the census also
//       refuses an `env:` expression that is not EITHER a direct `gitEnv(...)` call OR a
//       bare identifier this file itself declares as `const NAME = gitEnv(...)`.
//
// Ported from CoalTipple's scripts/lib/git-env-census.mjs (the exemplar named in this
// room's build order) with the rung-2 check added -- re-derived against THIS room's own
// call shapes, not copied blind. CoalHearth ships a FAR more general version of the same
// idea (arbitrary aliasing through child_process namespace imports, shell-wrapped git,
// mutation-after-declaration tracking) -- deliberately NOT ported here: a full textual
// trace of this room's own `scripts/**/*.mjs` (re-derive: `grep -rn "'git'" --include=*.mjs
// --include=*.js . | grep -v plugin/`) finds every git spawn in this room spelled exactly
// `spawnSync('git', [...], {...})` or `execFileSync('git', [...], {...})`, with no
// namespace import of child_process, no shell wrapping of git, and no env identifier
// mutated after its `gitEnv(...)` assignment -- CoalHearth's extra generality defends
// against shapes this room does not have. A FOURTH shape, found at R12 INSPECT (F6):
// `CALL_RE` requires the binary name as a quoted literal AT THE CALL SITE
// (`spawnSync('git', ...)`), so `const GIT = 'git'; spawnSync(GIT, [...], { env:
// process.env })` -- a loop-friendly form with the identifier declared once and used
// several times -- is invisible to the whole census, `env: process.env` and all. If a
// future spawn here takes ANY of these four shapes, this census will UNDER-detect it
// (named here, not silently assumed safe); widen the census the day that shape actually
// lands, not before.
//
// Pure: a list of { rel, text } in, a findings array out -- unit-tested directly, red-
// first, without a repo clone. collectScriptsMjs() is the real filesystem walk, kept
// separate so the pure function never touches disk.
import fs from 'node:fs';
import path from 'node:path';

const CALL_RE = /(spawnSync|execFileSync)\(\s*['"]git['"]/g;

// A match on the same line as an EARLIER `//` is inside a line comment -- skip it. Textual
// heuristic, not a real JS parser (same scope note as the exemplar's own version).
function isInLineComment(text, matchIndex) {
  const lineStart = text.lastIndexOf('\n', matchIndex) + 1;
  return text.slice(lineStart, matchIndex).includes('//');
}

function findMatchingClose(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// The text of one object-value expression starting at `from`: up to the first top-level
// `,` or the object's own close, depth-aware over (), {}, [] so `gitEnv(path.dirname(x))`
// (a comma-free call) and a hypothetical `gitEnv(a, b)` are both read whole.
function readExpr(text, from, limit) {
  let depth = 0;
  for (let i = from; i < limit; i++) {
    const c = text[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') { if (depth === 0) return text.slice(from, i); depth--; }
    else if (c === ',' && depth === 0) return text.slice(from, i);
  }
  return text.slice(from, limit);
}

const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

// Is `expr` exactly a bare identifier, declared in THIS file as `const NAME = gitEnv(...)`
// (the shape every identifier-form call site in this room actually uses)? A lighter check
// than CoalHearth's full alias-verdict (no mutation-after-declaration tracking) -- adequate
// at this room's scale (re-derive the identifier set with the grep in the header above),
// and still catches the real hole: an identifier that is NOT declared from gitEnv() at all.
function isGitEnvIdentifier(name, fileText) {
  const re = new RegExp(String.raw`\b(?:const|let|var)\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*=\s*gitEnv\s*\(`);
  return re.test(fileText);
}

// A call's env is supplied either `env: <expr>` (the full form) or the ES6 shorthand
// `{ ..., env, ... }` (a property named exactly `env`, value = the identifier `env`) --
// several real call sites in this room's own test files use the shorthand, and a census
// that only recognises `env:` silently reads them as having NO env at all.
function findEnvKey(callText) {
  const colon = /\benv\s*:/.exec(callText);
  if (colon) return { kind: 'colon', index: colon.index, length: colon[0].length };
  const shorthand = /[{,]\s*(env)\s*(?=[,}])/.exec(callText);
  if (shorthand) return { kind: 'shorthand', index: shorthand.index + shorthand[0].indexOf('env') };
  return null;
}

function envVerdict(callText, fileText) {
  const key = findEnvKey(callText);
  if (!key) return "carries no 'env:' -- every git spawn must take env from gitEnv() (CWK-133)";
  const expr = key.kind === 'shorthand' ? 'env' : readExpr(callText, key.index + key.length, callText.length).trim();
  if (/\bprocess\s*\.\s*env\b/.test(expr) || /\bprocess\s*\[\s*['"`]env['"`]\s*\]/.test(expr)) {
    return `env: ${expr} mentions process.env -- a git child inherits a hook's absolute GIT_DIR that way; take env from gitEnv(...) alone (CWK-136)`;
  }
  if (/^gitEnv\s*\(/.test(expr) && findMatchingClose(expr, expr.indexOf('(')) === expr.length - 1) return null;
  if (/^[A-Za-z_$][\w$]*$/.test(expr)) {
    return isGitEnvIdentifier(expr, fileText) ? null
      : `env: ${expr} is not declared \`const ${expr} = gitEnv(...)\` in this file -- take env from gitEnv(...) alone (CWK-136)`;
  }
  return `env: ${expr || '(empty)'} is not produced by gitEnv() alone -- take env from gitEnv(...) alone (CWK-133/136)`;
}

// Deliberate, narrow, COUNTED exemptions -- the one shape this census cannot otherwise
// pass: a test that exists to PROVE the unguarded hazard is real must itself spawn git
// with the poisoned, unguarded env (scripts/lib/git-env.test.mjs's own "THE HAZARD"
// case). Exact file + exact env expression + an expected spawn COUNT, same discipline as
// CoalHearth's GIT_ENV_EXEMPTIONS: a further match beyond the count is a NEW finding, not
// a silent widening of the exemption.
export const GIT_ENV_EXEMPTIONS = [
  {
    rel: 'scripts/lib/git-env.test.mjs',
    expr: 'poisoned',
    count: 1,
    reason: 'the hazard proof deliberately feeds a poisoned, unguarded GIT_DIR to reproduce the real incident',
  },
];

export function censusGitSpawns(files, { exemptions = GIT_ENV_EXEMPTIONS } = {}) {
  const findings = [];
  const matched = new Map();
  for (const { rel, text } of files) {
    CALL_RE.lastIndex = 0;
    let m;
    while ((m = CALL_RE.exec(text))) {
      if (isInLineComment(text, m.index)) continue;
      const openIdx = text.indexOf('(', m.index);
      const closeIdx = findMatchingClose(text, openIdx);
      const line = lineOf(text, m.index);
      if (closeIdx === -1) {
        findings.push(`${rel}:${line} unbalanced parens scanning a ${m[1]}('git', ...) call -- census cannot vouch for it`);
        continue;
      }
      const callText = text.slice(openIdx, closeIdx + 1);
      const why = envVerdict(callText, text);
      if (!why) continue;
      const key = findEnvKey(callText);
      const expr = key && key.kind !== 'shorthand' ? readExpr(callText, key.index + key.length, callText.length).trim() : null;
      const ex = exemptions.find((e) => e.rel === rel && expr !== null && expr === e.expr);
      if (ex) {
        const n = (matched.get(ex) || 0) + 1;
        matched.set(ex, n);
        if (n <= (ex.count ?? 1)) continue;
        findings.push(`${rel}:${line} ${m[1]}(git, ...) env: ${expr} matches the exemption for ${ex.rel} (${ex.reason}), which allows ${ex.count ?? 1} spawn(s) -- this is spawn ${n}`);
        continue;
      }
      findings.push(`${rel}:${line} ${m[1]}(git, ...) ${why}`);
    }
  }
  // Stale: an exemption that matched FEWER spawns than its declared count (including
  // none at all) is reported, so a removed/renamed spawn cannot leave a dead exemption.
  for (const e of exemptions) {
    const n = matched.get(e) || 0;
    if (n < (e.count ?? 1)) findings.push(`${e.rel} exemption for env: ${e.expr} expected ${e.count ?? 1} spawn(s), matched ${n} -- stale exemption, remove or fix it`);
  }
  return findings;
}

// Real filesystem walk of scripts/**/*.mjs, `rel` relative to `repo` so a finding names the
// exact path a human would open. Scoped to scripts/ because this room's git spawns live
// there only (grep-verified, command in the header comment above) -- never hooks/, which
// carries none today.
export function collectScriptsMjs(repo) {
  const scriptsDir = path.join(repo, 'scripts');
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.mjs')) {
        files.push({ rel: path.relative(repo, p).replace(/\\/g, '/'), text: fs.readFileSync(p, 'utf8') });
      }
    }
  })(scriptsDir);
  return files;
}
