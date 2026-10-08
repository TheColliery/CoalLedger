// CWK-133/C-4 + CWK-136 -- the git-spawn census for THIS room. Three rungs, all in one
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
//       bare identifier whose EVERY declaration in this file is `const NAME = gitEnv(...)`
//       (or a safe allowlist, rung 3).
//   (3) ALLOWLIST (08c, main's ruling UMB-456 (2); hardened at 08d against the chief's witness list of 34 must-fail vectors and the
//       must-pass controls): an env built from NAMED keys is as safe as gitEnv() when it
//         (a) reads process.env only as one named key at a time: process.env[k] (k an identifier or a string literal), process.env.NAME, or
//             the membership test `k in process.env`; never a spread, an Object.entries/keys/values/assign, a pass-through, or an alias
//             of the whole object (import { env as e } from 'node:process', const e = process.env) used any other way;
//         (b) spreads only Object.fromEntries(<a named list or an array literal>.filter(...).map(...)), nothing chained after the closing
//             paren; the list is an array literal of string literals in THIS file (a spread of another such list is followed), never
//             concatenated, never mutated after its declaration;
//         (c) carries exactly one top-level GIT_CONFIG_NOSYSTEM: '1' key, and names no GIT_* key (any case) beyond GIT_CONFIG_NOSYSTEM,
//             GIT_TERMINAL_PROMPT ('0': a prompt can only hang the child) and GIT_CEILING_DIRECTORIES (it only NARROWS where git looks);
//             GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE and the rest are what a hook exports and what retargets a spawn;
//         (d) has no computed key, no string concatenation, no template literal, no free function call, no method call beyond
//             filter/map/fromEntries: whatever the census cannot read whole is a FINDING, never a silent pass (fail closed).
//       The same object may be inline, a named variable, or the `env` shorthand. A name is judged on EVERY declaration in the file, and a
//       name that is also a parameter, a destructured binding, a for-of variable or reassigned is refused (the census cannot bind the
//       spawn to one declaration). A named env that is mutated, aliased-then-mutated or handed to a call is refused. A spread AFTER the
//       env key in the options object (it may carry its own env) is refused too.
//   Comments are stripped string-aware (a `//` inside a string literal is not a comment), and the spawn calls are found in the stripped
//   text, so a `//` earlier on the line in a string cannot hide a spawn (08d).
//
// Ported from CoalTipple's scripts/lib/git-env-census.mjs (the exemplar named in this
// room's build order) with the rung-2 check added -- re-derived against THIS room's own
// call shapes, not copied blind. CoalHearth ships a FAR more general version of the same
// idea (arbitrary aliasing through child_process namespace imports, shell-wrapped git,
// mutation-after-declaration tracking) -- deliberately NOT ported here: a full textual
// trace of this room's own `scripts/**/*.mjs` (re-derive: `grep -rn "'git'" --include=*.mjs
// --include=*.js . | grep -v plugin/`) finds every git spawn in this room spelled exactly
// `spawnSync('git', [...], {...})` or `execFileSync('git', [...], {...})`, with no
// namespace import of child_process and no shell wrapping of git. A FOURTH shape, found at R12 INSPECT (F6):
// `CALL_RE` requires the binary name as a quoted literal AT THE CALL SITE
// (`spawnSync('git', ...)`), so `const GIT = 'git'; spawnSync(GIT, [...], { env:
// process.env })` -- a loop-friendly form with the identifier declared once and used
// several times -- is invisible to the whole census, `env: process.env` and all. If a
// future spawn here takes ANY of these shapes (a const binary name, a namespace import, a shell string, a
// spawn/execFile spelling), this census will UNDER-detect it (named here, not silently assumed safe); widen the census the day that shape
// actually lands, not before. Also named, not closed: an env object aliased by a name and mutated through a PROPERTY of an object that
// holds it, a git-env helper imported from a module other than ./git-env.mjs, and a file that DEFINES its own gitEnv() (the canon secret-gate.mjs does, and strips the GIT_* family; the census trusts the name).
//
// Pure: a list of { rel, text } in, a findings array out -- unit-tested directly, red-
// first, without a repo clone. collectScriptsMjs() is the real filesystem walk, kept
// separate so the pure function never touches disk.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const CALL_RE = /(spawnSync|execFileSync)\(\s*['"]git['"]/g;

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
const escapeRe = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- text scanners. Both are one small state machine over quotes: a quote opens a string, a newline inside a ' or " string ends it
// (a regex literal holding a quote, not a string), a backslash escapes the next character.
// Comments become spaces (newlines kept), so every index and line number in the stripped text equals the original's. A `//` inside a
// string literal is NOT a comment (08d: 'a//b' used to hide the rest of the line, a GIT_DIR key included).
function stripComments(t) {
  let out = '';
  let q = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      out += c;
      if (c === '\\') { i++; if (i < t.length) out += t[i]; } else if (c === q || (c === '\n' && q !== '`')) q = null;
      continue;
    }
    if (c === '/' && t[i + 1] === '/') { while (i < t.length && t[i] !== '\n') { out += ' '; i++; } i--; continue; }
    if (c === '/' && t[i + 1] === '*') {
      const e = t.indexOf('*/', i + 2);
      const end = e < 0 ? t.length : e + 2;
      for (; i < end; i++) out += t[i] === '\n' ? '\n' : ' ';
      i--;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') q = c;
    out += c;
  }
  return out;
}

// `t` with the INSIDE of every string literal replaced by underscores (the quotes stay), so a structural check cannot be fooled by,
// or trip on, a bracket, a plus or a call-looking word that sits in a string.
function blankStrings(t) {
  let out = '';
  let q = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '\\') { out += '__'; i++; } else if (c === q) { q = null; out += c; } else if (c === '\n' && q !== '`') { q = null; out += c; } else out += c === '\n' ? c : '_';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') q = c;
    out += c;
  }
  return out;
}

// Only what sits directly inside the OUTER braces of an object literal (depth 1); everything deeper becomes a space. Strings are kept at
// depth 1 (a quoted key is a key) and ignored for bracket counting.
function topLevel(body) {
  let out = '';
  let depth = 0;
  let q = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (q) {
      if (c === '\\') { out += depth === 1 ? c + (body[i + 1] ?? '') : '  '; i++; continue; }
      if (c === q || (c === '\n' && q !== '`')) q = null;
      out += depth === 1 ? c : ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { q = c; out += depth === 1 ? c : ' '; continue; }
    // an opener met AT depth 1 is kept (a computed key is a `[` at depth 1); the outer brace (depth 0) and a closer back at depth 0 are blanked
    if (c === '(' || c === '{' || c === '[') { out += depth === 1 ? c : ' '; depth++; continue; }
    if (c === ')' || c === '}' || c === ']') { depth--; out += depth === 1 ? c : ' '; continue; }
    out += depth === 1 ? c : (c === '\n' ? c : ' ');
  }
  return out;
}

// The balanced (...), {...} or [...] that opens at openIdx (depth over the three bracket kinds), or null when it never closes.
function readBalanced(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') { depth--; if (depth === 0) return text.slice(openIdx, i + 1); }
  }
  return null;
}

// ---- declarations and bindings of a name, all read from the comment-stripped text.
// Every `const|let|var NAME = ...` as { kind: 'gitEnv' | 'object' | 'other', text }. A gitEnv(...) declaration counts only when the
// call is the WHOLE initialiser (`const env = gitEnv(d);`), never `gitEnv(d).x` or `gitEnv(d) || process.env`.
function declarationsOf(name, code) {
  const re = new RegExp(String.raw`\b(?:const|let|var)\s+${escapeRe(name)}\s*=\s*`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(code))) {
    const at = m.index + m[0].length;
    if (/^gitEnv\s*\(/.test(code.slice(at))) {
      const open = code.indexOf('(', at);
      const close = findMatchingClose(code, open);
      out.push(close !== -1 && /^\s*(?:[;,\n)]|$)/.test(code.slice(close + 1)) ? { kind: 'gitEnv' } : { kind: 'other' });
    } else if (code[at] === '{') { const text = readBalanced(code, at); out.push(text ? { kind: 'object', text } : { kind: 'other' }); }
    else out.push({ kind: 'other' });
  }
  return out;
}

// True when NAME is bound in a way the census cannot tie to one declaration: a function or arrow parameter, a destructured
// binding, a for-of / for-in variable, a catch variable, a declaration with no initialiser, or any plain reassignment.
function boundOtherwise(name, code) {
  const n = escapeRe(name);
  const params = [...code.matchAll(/\bfunction\s*[\w$]*\s*\(([^()]*)\)/g), ...code.matchAll(/\(([^()]*)\)\s*=>/g)];
  if (params.some((p) => (p[1].match(/[\w$]+/g) || []).includes(name))) return true;
  const checks = [
    String.raw`(?<![\w$.])${n}\s*=>`,
    String.raw`\b(?:const|let|var)\s*[{\[][^=;]*\b${n}\b[^=;]*[}\]]\s*=`,
    String.raw`\bfor\s*\(\s*(?:const|let|var)\s+${n}\b`,
    String.raw`\bcatch\s*\(\s*${n}\s*\)`,
    String.raw`\b(?:let|var)\s+${n}\s*(?:[;,\n]|$)`,
    String.raw`(?<!\b(?:const|let|var)\s+)(?<![\w$.])${n}\s*=(?![=>])`,
  ];
  return checks.some((c) => new RegExp(c).test(code));
}

// ---- rung (3), the allowlist shape. The three GIT_* names an allowlist may carry; see the header for why each is safe.
const ALLOWED_GIT_KEYS = new Set(['GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT', 'GIT_CEILING_DIRECTORIES']);
// What a KEEP LIST may name: GIT_CONFIG_NOSYSTEM is the literal '1' and a list entry would let the environment's own value override it.
const ALLOWED_LIST_KEYS = new Set(['GIT_TERMINAL_PROMPT', 'GIT_CEILING_DIRECTORIES']);
const PROC_ENV = /\bprocess\s*(?:\.\s*env\b|\[\s*['"`]env['"`]\s*\])/;

// Every name this file binds to the WHOLE process.env: import { env as e } from 'node:process', const e = process.env,
// const { env: e } = process.
function envAliases(code) {
  const names = new Set();
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?process['"]/g)) {
    for (const part of m[1].split(',')) { const mm = /^\s*env(?:\s+as\s+([\w$]+))?\s*$/.exec(part); if (mm) names.add(mm[1] || 'env'); }
  }
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*process\s*(?:\.\s*env\b|\[\s*['"`]env['"`]\s*\])/g)) names.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*process\b/g)) {
    for (const part of m[1].split(',')) { const mm = /^\s*env(?:\s*:\s*([\w$]+))?\s*$/.exec(part); if (mm) names.add(mm[1] || 'env'); }
  }
  return names;
}

// null when a KEEP LIST (an array literal as written) holds only string literals, no concatenation, no GIT_* name beyond the two it may
// carry, and every list it spreads is itself such a list; else the reason.
function listReason(listText, code, depth = 0) {
  if (depth > 4) return 'a key list spreads lists too deeply to read';
  if (!/^\[\s*(?:(?:'[^'\n]*'|"[^"\n]*"|\.\.\.\s*[A-Za-z_$][\w$]*)\s*(?:,\s*|(?=\])))*\]$/.test(listText.trim())) {
    return 'a key list is not an array of string literals (a computed or concatenated name could be GIT_DIR)';
  }
  for (const s of listText.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)) {
    const word = s[1] ?? s[2];
    if (/git/i.test(word) && !ALLOWED_LIST_KEYS.has(word)) return `a key list names ${word} -- only ${[...ALLOWED_LIST_KEYS].join(', ')} may be passed by name; any other GIT_* key retargets the spawn (CWK-133/136)`;
  }
  for (const s of listText.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)) {
    const why = namedListReason(s[1], code, depth + 1);
    if (why) return why;
  }
  return null;
}

// A key list referred to by NAME: every declaration of it must be an array literal that passes listReason, and none may be mutated.
function namedListReason(name, code, depth = 0) {
  const decls = [...new RegExp(String.raw`\b(?:const|let|var)\s+${escapeRe(name)}\s*=\s*`, 'g')[Symbol.matchAll](code)];
  if (!decls.length) return `the key list ${name} is not declared in this file as an array literal -- the census cannot read it whole`;
  for (const d of decls) {
    const at = d.index + d[0].length;
    const list = code[at] === '[' ? readBalanced(code, at) : null;
    if (!list) return `the key list ${name} is not an array literal`;
    const why = listReason(list, code, depth);
    if (why) return why;
  }
  return mutationReason(name, code, 'key list');
}

// The names a mutation could reach NAME through: itself and any `const X = NAME;` alias of it.
function mutationReason(name, code, what) {
  const names = [name];
  for (const m of code.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s+([\w$]+)\s*=\s*${escapeRe(name)}\s*(?=[;\n])`, 'g'))) names.push(m[1]);
  for (const nm of names) {
    const n = escapeRe(nm);
    const mutated = new RegExp(String.raw`(?<![\w$.])${n}\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]*\])\s*=(?!=)`).test(code)
      || new RegExp(String.raw`(?<![\w$.])${n}\s*\.\s*(?:push|unshift|splice|fill|copyWithin)\s*\(`).test(code)
      || new RegExp(String.raw`Object\s*\.\s*assign\s*\(\s*${n}\b`).test(code)
      || new RegExp(String.raw`[\w$.]+\s*\(\s*(?:[^()]*,\s*)?${n}\s*[,)]`).test(code);
    if (mutated) return `an allowlist ${what} (${nm}) is mutated after its declaration, or handed to a call that could mutate it -- a GIT_* key added later is the same hole`;
  }
  return null;
}

// null when `objText` (an object literal, as written) is a safe allowlist env; else the reason. `name` is the variable it was
// declared as (for the mutation scan), or null for an inline object.
function allowlistVerdict(objText, code, name) {
  const body = objText;
  const bare = blankStrings(body);
  const aliases = envAliases(code);
  // (a) process.env, or an alias of it, only ever read one key at a time
  const aliasRe = aliases.size ? '|\\b(?:' + [...aliases].map(escapeRe).join('|') + ')\\b' : '';
  for (const m of body.matchAll(new RegExp(PROC_ENV.source + aliasRe, 'g'))) {
    const before = body.slice(0, m.index);
    const tail = body.slice(m.index + m[0].length);
    let ok = /\bin\s+$/.test(before);
    if (/^\s*\[/.test(tail)) ok = /^\s*\[\s*(?:[A-Za-z_$][\w$]*|'[^'\n]*'|"[^"\n]*")\s*\]/.test(tail);
    else {
      const prop = /^\s*\.\s*[A-Za-z_$][\w$]*/.exec(tail);
      if (prop) { const next = tail.slice(prop[0].length).trimStart()[0]; ok = next !== '(' && next !== '.' && next !== '['; }
    }
    if (!ok) return 'an allowlist env mentions process.env other than as an indexed read (process.env[k], process.env.NAME or `k in process.env`, one named key at a time) -- a git child inherits a hook\'s absolute GIT_DIR that way (CWK-136)';
  }
  // (b) the only spread is Object.fromEntries(<named list>.filter/.map ...), nothing chained after it
  const lists = [];
  for (const m of bare.matchAll(/\.\.\./g)) {
    const rest = body.slice(m.index + 3);
    if (!/^\s*Object\s*\.\s*fromEntries\s*\(/.test(rest)) {
      return 'an allowlist env spreads something other than Object.fromEntries(<named keys>) -- an unknown object can carry any GIT_* key in';
    }
    const open = m.index + 3 + rest.indexOf('(', rest.indexOf('fromEntries'));
    const call = readBalanced(body, open);
    if (!call) return 'an allowlist env has an Object.fromEntries( the census cannot read to its close';
    if (!/^\s*(?:[,}]|$)/.test(body.slice(open + call.length))) return 'an allowlist env chains something after Object.fromEntries(...) -- the census cannot read what it does';
    const arg = call.slice(1, -1).trim();
    const lead = /^([A-Za-z_$][\w$]*)\s*\./.exec(arg);
    if (lead) { const why = namedListReason(lead[1], code); if (why) return why; lists.push(lead[1]); }
    else if (arg.startsWith('[')) { const lit = readBalanced(arg, 0); const why = lit ? listReason(lit, code) : 'an inline key list never closes'; if (why) return why; }
    else return 'an allowlist env builds its pairs from something other than a named key list or an array literal';
  }
  // (d) nothing the census cannot read whole
  if (/\+|`/.test(bare)) return 'an allowlist env uses string concatenation, arithmetic or a template literal -- a computed name could be GIT_DIR';
  if (/\bnew\b|\bfunction\b|=>\s*\{/.test(bare)) return 'an allowlist env holds a constructor call or a function body the census cannot read whole';
  if (/\bObject\s*\.\s*(?!fromEntries\b)/.test(bare)) return 'an allowlist env calls an Object method other than fromEntries (Object.entries/keys/values/assign copy the whole environment)';
  if (/\.\s*(?!(?:filter|map|fromEntries)\b)[A-Za-z_$][\w$]*\s*\(/.test(bare)) return 'an allowlist env calls a method other than filter/map/fromEntries -- the census cannot read what it does';
  if (/(?<![\w$.])(?!(?:if|for|while|switch|catch|return|typeof|void|in|of)\b)[A-Za-z_$][\w$]*\s*\(/.test(bare)) return 'an allowlist env calls a function -- the census cannot read what it returns (a helper that returns process.env looks the same)';
  const top = topLevel(body);
  if (/(?:^|,)\s*\[/.test(top)) return 'an allowlist env has a computed property key -- the census cannot read the name';
  // (c) the GIT_* names, any case, in the object and in every list it names
  const gitNames = (body.match(/\bgit_[a-z0-9_]*/gi) || []);
  const bad = [...new Set(gitNames)].filter((t) => !ALLOWED_GIT_KEYS.has(t));
  if (bad.length) return `an allowlist env names ${bad.join(', ')} -- only ${[...ALLOWED_GIT_KEYS].join(', ')} may appear; any other GIT_* key retargets the spawn (CWK-133/136)`;
  const keys = (k) => [...top.matchAll(new RegExp(String.raw`(?:^|[,{\s])['"]?${k}['"]?\s*:\s*([^,}]*)`, 'g'))];
  const nosys = keys('GIT_CONFIG_NOSYSTEM');
  if (nosys.length === 0 || !/^\s*['"]1['"]\s*$/.test(nosys[0][1])) return "an allowlist env must carry GIT_CONFIG_NOSYSTEM: '1' as a top-level key -- without it the machine's system git config reaches the child";
  if (nosys.length > 1) return 'an allowlist env sets GIT_CONFIG_NOSYSTEM more than once -- the last one wins, so the literal 1 is not what the child sees';
  const prompts = keys('GIT_TERMINAL_PROMPT');
  if (prompts.length > 1) return 'an allowlist env sets GIT_TERMINAL_PROMPT more than once';
  if (prompts.length && !/^\s*['"]0['"]\s*$/.test(prompts[0][1])) return "an allowlist env sets GIT_TERMINAL_PROMPT to something other than '0'";
  if (keys('GIT_CEILING_DIRECTORIES').length > 1) return 'an allowlist env sets GIT_CEILING_DIRECTORIES more than once';
  for (const l of namedListsIn(body, code)) {
    if (/git/i.test(l) && !ALLOWED_LIST_KEYS.has(l)) return `a key list named in the env holds ${l}`;
  }
  if (name) {
    const why = mutationReason(name, code, 'env');
    if (why) return why;
  }
  return null;
}

// Strings a list named by a bare identifier in the object holds (the legacy broad scan, kept as a second net beside the fromEntries one).
function namedListsIn(body, code) {
  const out = [];
  const seen = new Set();
  for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    for (const d of new RegExp(String.raw`\b(?:const|let|var)\s+${escapeRe(m[1])}\s*=\s*\[`, 'g')[Symbol.matchAll](code)) {
      const list = readBalanced(code, d.index + d[0].length - 1);
      if (list) for (const s of list.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)) out.push(s[1] ?? s[2]);
    }
  }
  return out;
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

function envVerdict(callText, code) {
  const key = findEnvKey(callText);
  if (!key) return "carries no 'env:' -- every git spawn must take env from gitEnv() (CWK-133)";
  const raw = key.kind === 'shorthand' ? 'env' : readExpr(callText, key.index + key.length, callText.length);
  const expr = raw.trim();
  const exprEnd = key.kind === 'shorthand' ? key.index + 3 : key.index + key.length + raw.length;
  if (/\.\.\./.test(callText.slice(exprEnd))) return `env: ${expr.length > 60 ? expr.slice(0, 57) + '...' : expr} is followed by a spread in the options object -- the spread may carry its own env and override it; put env last (CWK-136)`;
  if (expr.startsWith('{')) {
    const why = allowlistVerdict(expr, code, null);
    return why ? `env: ${expr.length > 60 ? expr.slice(0, 57) + '...' : expr} ${why}` : null;
  }
  if (PROC_ENV.test(expr)) {
    return `env: ${expr} mentions process.env -- a git child inherits a hook's absolute GIT_DIR that way; take env from gitEnv(...) alone (CWK-136)`;
  }
  if (/^gitEnv\s*\(/.test(expr) && findMatchingClose(expr, expr.indexOf('(')) === expr.length - 1) {
    return null;
  }
  if (/^[A-Za-z_$][\w$]*$/.test(expr)) {
    const decls = declarationsOf(expr, code);
    const readable = decls.length > 0 && decls.every((d) => d.kind !== 'other') && !boundOtherwise(expr, code);
    if (!readable) {
      return `env: ${expr} is not declared \`const ${expr} = gitEnv(...)\` in this file (every declaration must be, or be a safe allowlist; a parameter, a destructured binding, a reassignment or an unreadable initialiser cannot be tied to the spawn) -- take env from gitEnv(...) alone (CWK-136)`;
    }
    for (const d of decls.filter((x) => x.kind === 'object')) {
      const why = allowlistVerdict(d.text, code, expr);
      if (why) return `env: ${expr} is not declared \`const ${expr} = gitEnv(...)\` in this file and is not a safe allowlist (${why}) -- take env from gitEnv(...) alone (CWK-136)`;
    }
    const why = decls.every((d) => d.kind === 'gitEnv') ? mutationReason(expr, code, 'env') : null;
    return why ? `env: ${expr} ${why}` : null;
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
    // The calls are found in the comment-stripped text (same length, same lines): a spawn inside a comment is not counted, and a `//`
    // inside a string earlier on the line does not hide a real one.
    const code = stripComments(text);
    CALL_RE.lastIndex = 0;
    let m;
    while ((m = CALL_RE.exec(code))) {
      const openIdx = code.indexOf('(', m.index);
      const closeIdx = findMatchingClose(code, openIdx);
      const line = lineOf(code, m.index);
      if (closeIdx === -1) {
        findings.push(`${rel}:${line} unbalanced parens scanning a ${m[1]}('git', ...) call -- census cannot vouch for it`);
        continue;
      }
      const callText = code.slice(openIdx, closeIdx + 1);
      const why = envVerdict(callText, code);
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
