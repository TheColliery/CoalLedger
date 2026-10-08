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
//   (3) ALLOWLIST (08c, main's ruling UMB-456 (2)): an env built from NAMED keys is as safe as gitEnv() when it (a) reads process.env only one
//       named key at a time (process.env[k]), never a spread, an assign or a pass-through, (b) carries GIT_CONFIG_NOSYSTEM: '1', and (c) names
//       no GIT_* key beyond GIT_CONFIG_NOSYSTEM, GIT_TERMINAL_PROMPT ('0': a prompt can only hang the child) and GIT_CEILING_DIRECTORIES (it only
//       NARROWS where git looks for a repository). Measured against the canon scripts/release-notes.mjs, which is the file this rung exists
//       for: its keep list passes GIT_CEILING_DIRECTORIES by name and its object sets the other two. Every other GIT_* key (GIT_DIR,
//       GIT_WORK_TREE, GIT_INDEX_FILE) is what a hook exports and what retargets a spawn. The same object may be inline, a named variable, or
//       the `env` shorthand. Textual, like the rest: a keep list, an object literal and the mutation scan are read as text, so an
//       allowlist assembled by a helper in ANOTHER file is not seen (it is a finding, never silently safe).
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
import { createHash } from 'node:crypto';

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

// ---- rung (3), the allowlist shape (08c). The three GIT_* names an allowlist may carry; see the header for why each is safe.
const ALLOWED_GIT_KEYS = new Set(['GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT', 'GIT_CEILING_DIRECTORIES']);

// A comment names GIT_DIR to explain the rule (the canon file does); only code is judged.
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

// The balanced {...} or [...] that opens at openIdx (depth over the three bracket kinds), or null when it never closes.
function readBalanced(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') { depth--; if (depth === 0) return text.slice(openIdx, i + 1); }
  }
  return null;
}

const escapeRe = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every declaration of NAME in the file, as { kind: 'gitEnv' | 'object' | 'other', text }.
function declarationsOf(name, fileText) {
  const re = new RegExp(String.raw`\b(?:const|let|var)\s+${escapeRe(name)}\s*=\s*`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(fileText))) {
    const at = m.index + m[0].length;
    if (/^gitEnv\s*\(/.test(fileText.slice(at))) out.push({ kind: 'gitEnv' });
    else if (fileText[at] === '{') { const text = readBalanced(fileText, at); out.push(text ? { kind: 'object', text } : { kind: 'other' }); }
    else out.push({ kind: 'other' });
  }
  return out;
}

// The text of every array literal the object names as a bare identifier (its keep list), comments stripped.
function namedLists(body, fileText) {
  const seen = new Set();
  let lists = '';
  for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of new RegExp(String.raw`\b(?:const|let|var)\s+${escapeRe(id)}\s*=\s*\[`, 'g')[Symbol.matchAll](fileText)) {
      const list = readBalanced(fileText, d.index + d[0].length - 1);
      if (list) lists += '\n' + stripComments(list);
    }
  }
  return lists;
}

// null when `objText` (an object literal, as written) is a safe allowlist env; else the reason. `name` is the variable it was
// declared as (for the mutation-after-declaration scan), or null for an inline object.
function allowlistVerdict(objText, fileText, name) {
  const body = stripComments(objText);
  for (const m of body.matchAll(/\bprocess\s*(?:\.\s*env\b|\[\s*['"`]env['"`]\s*\])/g)) {
    if (!/^\s*\[/.test(body.slice(m.index + m[0].length))) {
      return 'an allowlist env mentions process.env other than as an indexed read (process.env[k], one named key at a time) -- a git child inherits a hook\'s absolute GIT_DIR that way (CWK-136)';
    }
  }
  for (const m of body.matchAll(/\.\.\./g)) {
    if (!/^\s*Object\s*\.\s*fromEntries\s*\(/.test(body.slice(m.index + 3))) {
      return 'an allowlist env spreads something other than Object.fromEntries(<named keys>) -- an unknown object can carry any GIT_* key in';
    }
  }
  const tokens = (body + namedLists(body, fileText)).match(/\bGIT_[A-Z0-9_]+\b/g) || [];
  const bad = [...new Set(tokens)].filter((t) => !ALLOWED_GIT_KEYS.has(t));
  if (bad.length) return `an allowlist env names ${bad.join(', ')} -- only ${[...ALLOWED_GIT_KEYS].join(', ')} may appear; any other GIT_* key retargets the spawn (CWK-133/136)`;
  if (!/\bGIT_CONFIG_NOSYSTEM\s*:\s*['"]1['"]/.test(body)) return "an allowlist env must carry GIT_CONFIG_NOSYSTEM: '1' -- without it the machine's system git config reaches the child";
  const prompt = /\bGIT_TERMINAL_PROMPT\s*:\s*([^,}\s]+)/.exec(body);
  if (prompt && !/^['"]0['"]$/.test(prompt[1])) return "an allowlist env sets GIT_TERMINAL_PROMPT to something other than '0'";
  if (name) {
    const code = stripComments(fileText);
    const n = escapeRe(name);
    if (new RegExp(String.raw`\b${n}\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]*\])\s*=(?!=)`).test(code) || new RegExp(String.raw`Object\s*\.\s*assign\s*\(\s*${n}\b`).test(code)) {
      return `an allowlist env (${name}) is mutated after its declaration -- a GIT_* key assigned later is the same hole`;
    }
  }
  return null;
}

function envVerdict(callText, fileText) {
  const key = findEnvKey(callText);
  if (!key) return "carries no 'env:' -- every git spawn must take env from gitEnv() (CWK-133)";
  const expr = key.kind === 'shorthand' ? 'env' : readExpr(callText, key.index + key.length, callText.length).trim();
  if (expr.startsWith('{')) {
    const why = allowlistVerdict(expr, fileText, null);
    return why ? `env: ${expr.length > 60 ? expr.slice(0, 57) + '...' : expr} ${why}` : null;
  }
  if (/\bprocess\s*\.\s*env\b/.test(expr) || /\bprocess\s*\[\s*['"`]env['"`]\s*\]/.test(expr)) {
    return `env: ${expr} mentions process.env -- a git child inherits a hook's absolute GIT_DIR that way; take env from gitEnv(...) alone (CWK-136)`;
  }
  if (/^gitEnv\s*\(/.test(expr) && findMatchingClose(expr, expr.indexOf('(')) === expr.length - 1) return null;
  if (/^[A-Za-z_$][\w$]*$/.test(expr)) {
    const decls = declarationsOf(expr, fileText);
    if (decls.some((d) => d.kind === 'object') && decls.every((d) => d.kind !== 'other')) {
      for (const d of decls.filter((x) => x.kind === 'object')) {
        const why = allowlistVerdict(d.text, fileText, expr);
        if (why) return `env: ${expr} is not declared \`const ${expr} = gitEnv(...)\` in this file and is not a safe allowlist (${why}) -- take env from gitEnv(...) alone (CWK-136)`;
      }
      return null;
    }
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
    // R12 bounce 3: the ORIGINAL single HAZARD test (1 poisoned spawn) was split into
    // two tests plus a probe function that all deliberately reproduce the same
    // unguarded-GIT_DIR shape (the fixture-half test, the bare-flip-capability probe,
    // and the victim-half test) -- 3 sites now, counted exactly, not widened silently.
    count: 3,
    reason: 'the hazard proof (and the probe that decides whether this host can reproduce its bare-flip half) deliberately feeds a poisoned, unguarded GIT_DIR to reproduce the real incident',
  },
];

// R14 / CWK-174: the house secret scan arrives as byte-equal copies of the published-code template
// (SERIES-CANON "Secret scan"). Two of its files are TEST files that spawn git by their own shapes: secret-gate.test.mjs
// spreads a LOCAL gitEnv() that strips the GIT_* family (blob 3fcd3f0d...), secret-scan.test.mjs spawns with no env
// at all (blob a9cb7145..., the org template's own source). Neither can be edited here without breaking the byte-equal
// parity, so each is exempt ONLY while its content is exactly the pinned blob: any edit, or a template re-sync that
// changes it, makes the entry a finding again, so the exemption cannot widen or outlive its reason silently. The pin is a
// git blob id (git hash-object <file>) against the .github template that carries the file: templates/published-code/scripts/ for the
// two secret-scan tests, templates/overlay-coal-skill/scripts/ for release-notes.mjs (05a F1: the mismatch message names both,
// because a per-carrier map would be a second roster that can drift when a carrier is added). The CoalMine and CoalBoard
// R13/R14 precedent; a NEW spawn anywhere else is still judged by the two rungs above.
// 08c (order 08c, the re-sync): three carriers, each byte-equal to its committed source blob. Measured, each with its pin taken out and the
// real file judged by the rungs above (scratchpad/08c/measure-pins.mjs): scripts/release-notes.mjs (the overlay's f8d998d8, an explicit
// ALLOWLIST env) PASSES under rung (3), so its pin is gone. The three that remain still need theirs, each for a shape rung (3) does not
// accept, on purpose: secret-gate.test.mjs (the canon a17ae233) builds its env as { ...gitEnv(), ...extra }, a spread of a caller's
// object; secret-scan.test.mjs (the Bankfire SOURCE test 4433fb56; the .github template's copy still reads bd5b156c, a lag the return
// names) filters process.env by DENYING the GIT_* family (cleanEnv), a denylist, not an allowlist; and release-notes.test.mjs (the overlay's
// 8cf7e5fd) takes its git env from the test file's own sandboxEnv(), HOME and the temp variables redirected into a scratch folder, which
// carries no GIT_CONFIG_NOSYSTEM. The 05a HOLD of release-notes.test.mjs at d7e299c4 is RELEASED: the canon fixed the env assertion that
// failed on macOS and under coverage (8cf7e5fd), so the room carries the canon blob and no named divergence.
// A pin is RE-PINNED, never dropped, when it still does not pass.
export const EXEMPT_CARRIERS = {
  'scripts/secret-gate.test.mjs': 'a17ae233275c05c6d030f7aa7f0654002b310356',
  'scripts/secret-scan.test.mjs': '4433fb56bc97d1facc3fb27804e1934c0577115f',
  'scripts/release-notes.test.mjs': '8cf7e5fd58b89d051395efc53cc0a4f6c86848da',
};

// The git blob id of `text`, as `git hash-object` prints it for a file holding exactly these bytes.
export function blobId(text) {
  const body = Buffer.from(text, 'utf8');
  return createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + body.length + String.fromCharCode(0)), body])).digest('hex');
}

export function censusGitSpawns(files, { exemptions = GIT_ENV_EXEMPTIONS, carriers = EXEMPT_CARRIERS } = {}) {
  const findings = [];
  const matched = new Map();
  for (const { rel, text } of files) {
    if (Object.hasOwn(carriers, rel)) {
      const id = blobId(text);
      if (id !== carriers[rel]) findings.push(`${rel} is an exempt byte-equal org carrier but its blob id is ${id}, not the pinned ${carriers[rel]} -- re-derive it from the .github template that carries it: templates/published-code/scripts/ (the secret-scan tests) or templates/overlay-coal-skill/scripts/ (release-notes.mjs) (CWK-174)`);
      continue;
    }
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
