import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { censusGitSpawns, collectScriptsMjs, blobId, EXEMPT_CARRIERS } from './git-env-census.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Every fixture below needs its TEXT VALUE to read as a real `spawnSync('git', ...)` /
// `execFileSync('git', ...)` call, so censusGitSpawns can parse it the way it would a real
// file. But THIS FILE is itself walked by the production census (it lives under scripts/),
// so the literal SOURCE CHARACTERS "spawnSync(" / "execFileSync(" must never appear
// contiguously here -- the same convention this room already uses for a comment that
// would otherwise manufacture the exact citation it describes (verify.test.mjs's
// CWK-079 non-locality test). Built via concatenation so the SOURCE text never contains
// the whole function name; the STRING VALUE a fixture carries is unaffected.
const SS = ['spawn', 'Sync'].join('');
const EF = ['exec', 'FileSync'].join('');

test('censusGitSpawns: a git spawn with NO env: at all is a CWK-133 finding', () => {
  const findings = censusGitSpawns([{ rel: 'scripts/x.mjs', text: `${SS}('git', ['init'], { cwd: dir });` }], { exemptions: [] });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /scripts\/x\.mjs:1/);
  assert.match(findings[0], /carries no 'env:'/);
  assert.match(findings[0], /CWK-133/);
});

test('censusGitSpawns: env: process.env -- the CWK-136 hole -- is a FAIL, the whole point of the "next rung" (build order item 2)', () => {
  const findings = censusGitSpawns([{ rel: 'scripts/x.mjs', text: `${SS}('git', ['init'], { cwd: dir, env: process.env });` }], { exemptions: [] });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /mentions process\.env/);
  assert.match(findings[0], /CWK-136/);
});

test('censusGitSpawns: env: { ...process.env, GIT_CEILING_DIRECTORIES } -- a spread pass-through -- also FAILs', () => {
  const findings = censusGitSpawns([{ rel: 'scripts/x.mjs', text: `${SS}('git', ['init'], { cwd: dir, env: { ...process.env, GIT_CEILING_DIRECTORIES: '/x' } });` }], { exemptions: [] });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /mentions process\.env/);
});

test('censusGitSpawns: env: process["env"] (bracket form) is caught the same as the dotted form', () => {
  const findings = censusGitSpawns([{ rel: 'scripts/x.mjs', text: `${SS}('git', ['init'], { cwd: dir, env: process["env"] });` }], { exemptions: [] });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /mentions process\.env/);
});

test('censusGitSpawns: env: gitEnv(...) directly -- PASSES, zero findings', () => {
  const findings = censusGitSpawns([{ rel: 'scripts/x.mjs', text: `${SS}('git', ['init'], { cwd: dir, env: gitEnv(path.dirname(dir)) });` }], { exemptions: [] });
  assert.deepEqual(findings, []);
});

test('censusGitSpawns: env: <identifier> (full colon form) PASSES when the SAME file declares `const <identifier> = gitEnv(...)`', () => {
  const text = `const env = gitEnv(path.dirname(dir));\n${SS}('git', ['init'], { cwd: dir, env: env });`;
  const findings = censusGitSpawns([{ rel: 'scripts/x.mjs', text }], { exemptions: [] });
  assert.deepEqual(findings, []);
});

test('censusGitSpawns: env (ES6 shorthand property) PASSES too when declared from gitEnv()', () => {
  const text = `const env = gitEnv(path.dirname(dir));\n${SS}('git', ['init'], { cwd: dir, env });`;
  const findings = censusGitSpawns([{ rel: 'scripts/x.mjs', text }], { exemptions: [] });
  assert.deepEqual(findings, []);
});

test('censusGitSpawns: env: <identifier> FAILs when that identifier is NOT declared from gitEnv() in the same file', () => {
  const text = `const env = { ...process.env };\n${SS}('git', ['init'], { cwd: dir, env });`;
  const findings = censusGitSpawns([{ rel: 'scripts/x.mjs', text }], { exemptions: [] });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /is not declared/);
  assert.match(findings[0], /CWK-136/);
});

test('censusGitSpawns: a git spawn written inside a // comment is not counted at all', () => {
  const findings = censusGitSpawns([{ rel: 'scripts/x.mjs', text: `// ${SS}('git', ['init'], { cwd: dir });` }], { exemptions: [] });
  assert.deepEqual(findings, []);
});

test('censusGitSpawns: execFileSync(git, ...) is covered the same as spawnSync', () => {
  const findings = censusGitSpawns([{ rel: 'scripts/x.mjs', text: `${EF}('git', ['rev-parse'], { cwd: dir });` }], { exemptions: [] });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /execFileSync/);
});

test('censusGitSpawns: unbalanced parens are reported, not thrown/crashed', () => {
  const findings = censusGitSpawns([{ rel: 'scripts/x.mjs', text: `${SS}('git', ['init'], { cwd: dir ` }], { exemptions: [] });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /unbalanced parens/);
});

test('censusGitSpawns: a declared exemption absorbs exactly its counted spawn(s); a spawn BEYOND the count is a finding', () => {
  const text = `${SS}('git', ['init'], { cwd: dir, env: poisoned });\n${SS}('git', ['init'], { cwd: dir2, env: poisoned });`;
  const findings = censusGitSpawns([{ rel: 'x.test.mjs', text }], {
    exemptions: [{ rel: 'x.test.mjs', expr: 'poisoned', count: 1, reason: 'test' }],
  });
  assert.equal(findings.length, 1, findings.join('\n'));
  assert.match(findings[0], /spawn 2/);
});

test('censusGitSpawns: an exemption that matches FEWER spawns than its declared count is reported stale', () => {
  const findings = censusGitSpawns([{ rel: 'x.test.mjs', text: '// no git spawns here at all' }], {
    exemptions: [{ rel: 'x.test.mjs', expr: 'poisoned', count: 1, reason: 'test' }],
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /stale exemption/);
});

test('collectScriptsMjs: walks the real scripts/ tree and returns every .mjs file with its text', () => {
  const files = collectScriptsMjs(repo);
  assert.ok(files.length > 10, `expected many .mjs files, got ${files.length}`);
  const verify = files.find((f) => f.rel === 'scripts/verify.mjs');
  assert.ok(verify, 'scripts/verify.mjs must be in the walk');
  assert.ok(verify.text.includes('gitEnv'), 'the real verify.mjs must already reference gitEnv');
});

// THE LIVENESS CONTROL AND THE GREEN PROOF, together: the census against the REAL tree,
// after every git-spawn site in this room was fixed, must report ZERO findings -- and the
// control proves the census is actually LOOKING (it is not vacuously empty because it
// never matched anything), by independently counting the git spawns the instrument saw.
test('censusGitSpawns against THIS ROOM\'s real scripts/ tree: zero findings post-fix, and the census genuinely saw every git spawn (non-vacuity control)', () => {
  const files = collectScriptsMjs(repo);
  const findings = censusGitSpawns(files);
  assert.deepEqual(findings, [], `every git spawn in this room must carry env: gitEnv(...) alone (or a declared exemption); got:\n${findings.join('\n')}`);

  // Non-vacuity: a plain text count, taken independently of the census's own internal
  // CALL_RE logic (a different regex, built differently), so a silent census bug (one
  // that never matches anything) cannot hide behind a vacuously-empty findings array.
  // Still built from SS/EF, same reason as every fixture above: `files` includes THIS
  // test file's own source, and a literal "spawnSync('git'" written here would be a
  // second, self-inflicted hit the real-tree "zero findings" assertion above would then
  // have to explain away.
  const nameRe = new RegExp(`(${SS}|${EF})\\('git'`, 'g');
  const bySimpleCount = files.reduce((n, f) => n + (f.text.match(nameRe) || []).length, 0);
  assert.ok(bySimpleCount >= 14, `expected the census to have real git spawns to judge (independently counted ${bySimpleCount}) -- a count of 0 here would mean this test proves nothing`);
});

// R14 / CWK-174: the house secret scan arrives as byte-equal copies of the published-code template, whose
// test files spawn git through their own cleaned environment (a local gitEnv spread) or none at all. A carrier is
// exempt ONLY while its content is exactly the pinned blob; every other file, and any edit, is judged as before.
const CARRIER = SS + "('git', ['fetch'], { cwd: dir });\n";
test('census carriers (CWK-174): a pinned byte-equal carrier is skipped, an edited one is a finding again', () => {
  const carriers = { 'scripts/carrier.mjs': blobId(CARRIER) };
  const opts = (c) => ({ exemptions: [], carriers: c });
  assert.equal(censusGitSpawns([{ rel: 'scripts/carrier.mjs', text: CARRIER }], opts({})).length, 1, 'control: not exempt, the spawn is a finding');
  assert.deepEqual(censusGitSpawns([{ rel: 'scripts/carrier.mjs', text: CARRIER }], opts(carriers)), [], 'pinned content passes');
  const edited = censusGitSpawns([{ rel: 'scripts/carrier.mjs', text: CARRIER + '// edited\n' }], opts(carriers));
  assert.equal(edited.length, 1, 'any edit re-opens it');
  assert.match(edited[0], /exempt byte-equal org carrier but its blob id is/);
  assert.equal(censusGitSpawns([{ rel: 'scripts/other.mjs', text: CARRIER }], opts(carriers)).length, 1, 'the exemption is per path, not per content: a new unexempt spawn still turns the census red');
});

test('census carriers (CWK-174): blobId equals git hash-object for the same bytes, and the live carriers match their pins', () => {
  assert.equal(blobId(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391', "git's empty-blob id");
  assert.equal(blobId('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a', 'git hash-object of "hello" + LF');
  // 08d: the roster is ONE. release-notes.mjs left at 08c (rung 3 accepts its allowlist env); at 08d secret-scan.test.mjs (the Bankfire decoy fix) and
  // release-notes.test.mjs (sandboxEnv is one returned literal of named keys) left too. Only secret-gate.test.mjs still needs a pin.
  assert.deepEqual(Object.keys(EXEMPT_CARRIERS).sort(), ['scripts/secret-gate.test.mjs']);
  const live = collectScriptsMjs(repo).filter((f) => Object.hasOwn(EXEMPT_CARRIERS, f.rel));
  assert.equal(live.length, Object.keys(EXEMPT_CARRIERS).length, 'every pinned path exists in the tree (a stale pin is a finding here, never silence)');
  assert.deepEqual(censusGitSpawns(live, { exemptions: [] }), [], 'and each is byte-equal to its pin');
});

// 05a bounce 1 / F1: the remediation hint of a blob mismatch must point at the template that actually carries the file. The
// carriers come from TWO canon templates (published-code: the secret-scan tests; overlay-coal-skill: release-notes.mjs), and a
// hint naming only published-code sent a maintainer to a directory that does not hold release-notes.mjs.
test('census carriers (F1): a mismatch message names BOTH canon templates, so the one carrying the file is always named', () => {
  const carriers = { 'scripts/carrier.mjs': blobId(CARRIER) };
  const edited = censusGitSpawns([{ rel: 'scripts/carrier.mjs', text: CARRIER + '// edited\n' }], { exemptions: [], carriers });
  assert.equal(edited.length, 1);
  assert.match(edited[0], /templates\/published-code\/scripts\//);
  assert.match(edited[0], /templates\/overlay-coal-skill\/scripts\//);
});

test('census carriers (F1): the live secret-gate.test.mjs carrier, edited by one line, is told to re-derive from the canon templates', () => {
  const files = collectScriptsMjs(repo).map((f) => (f.rel === 'scripts/secret-gate.test.mjs' ? { ...f, text: f.text + '// edited\n' } : f));
  const findings = censusGitSpawns(files);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /^scripts\/secret-gate\.test\.mjs is an exempt byte-equal org carrier/);
  assert.match(findings[0], /templates\/published-code\/scripts\//);
});

// ---- 08c commit 2 (main's ruling UMB-456 (2)): the ALLOWLIST env shape. An env object built from NAMED keys is as safe as gitEnv() when
// it (a) reads process.env only one NAMED key at a time (process.env[k]), never a spread, an assign or a pass-through, (b) carries
// GIT_CONFIG_NOSYSTEM: '1', and (c) sets or passes no GIT_* key beyond the three the canon release-notes.mjs actually uses.
// The three GIT_* names allowed, measured against that file's own env: GIT_CONFIG_NOSYSTEM (required: it stops the machine's system
// config from reaching the child), GIT_TERMINAL_PROMPT (set to '0': a prompt can only hang the child, it cannot aim it anywhere) and
// GIT_CEILING_DIRECTORIES (passed by name: it only NARROWS where git searches for a repository, UMB-456 (1) iii). Every other GIT_* key
// (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, ...) is what a hook exports and what retargets a spawn, so naming one is a finding.
//
// Fixtures are built from strings (the SS/EF convention above); `process.env[k]` appears here only inside fixture TEXT.
const PE = ['process', 'env'].join('.');
const KEEP = "const keep = ['PATH', 'Path', 'HOME', 'GIT_CEILING_DIRECTORIES'];\n";
const FROM_ENTRIES = `...Object.fromEntries(keep.filter((k) => ${PE}[k] !== undefined).map((k) => [k, ${PE}[k]]))`;
const NOSYS = "GIT_CONFIG_NOSYSTEM: '1'";
const allowObj = (parts) => `{ ${parts.join(', ')} }`;
const GOOD_PARTS = [FROM_ENTRIES, NOSYS, "GIT_TERMINAL_PROMPT: '0'"];
const censusOne = (text) => censusGitSpawns([{ rel: 'scripts/x.mjs', text }], { exemptions: [], carriers: {} });
// the same env object in the three spellings a call site can give it: inline, a named variable, and the `env` shorthand
const asInline = (obj) => KEEP + `${SS}('git', ['status'], { cwd: dir, env: ${obj} });\n`;
const asNamed = (obj) => KEEP + `const gitEnvAllow = ${obj};\n${SS}('git', ['status'], { cwd: dir, env: gitEnvAllow });\n`;
const asShorthand = (obj) => KEEP + `const env = ${obj};\n${SS}('git', ['status'], { cwd: dir, env });\n`;
const SPELLINGS = { inline: asInline, named: asNamed, shorthand: asShorthand };

test('allowlist env (witness 1): the canon release-notes.mjs, read from the tree with NO pin, passes', () => {
  const text = fs.readFileSync(path.join(repo, 'scripts', 'release-notes.mjs'), 'utf8');
  assert.ok(text.includes('GIT_CONFIG_NOSYSTEM'), 'control: this is the file that builds the allowlist env');
  assert.deepEqual(censusGitSpawns([{ rel: 'scripts/release-notes.mjs', text }], { exemptions: [], carriers: {} }), []);
});

test('allowlist env: a well-formed allowlist passes in all three spellings (inline, named variable, shorthand)', () => {
  for (const [name, spell] of Object.entries(SPELLINGS)) {
    assert.deepEqual(censusOne(spell(allowObj(GOOD_PARTS))), [], name);
  }
});

test('allowlist env (witness 2): a spread of the whole process env FAILS, inline, as a named variable and as the shorthand, even with GIT_CONFIG_NOSYSTEM', () => {
  const obj = allowObj([`...${PE}`, NOSYS]);
  for (const [name, spell] of Object.entries(SPELLINGS)) {
    const findings = censusOne(spell(obj));
    assert.equal(findings.length, 1, name);
    assert.match(findings[0], /process\.env/, name);
  }
});

test('allowlist env (witness 3): Object.assign({}, process.env, ...) FAILS, inline and as a named variable', () => {
  const obj = `Object.assign({}, ${PE}, { ${NOSYS} })`;
  for (const name of ['inline', 'named', 'shorthand']) {
    const findings = censusOne(SPELLINGS[name](obj));
    assert.equal(findings.length, 1, name);
  }
});

test('allowlist env (witness 4): an allowlist that adds a GIT_* key beyond the three FAILS, as a property and as a name in the keep list', () => {
  for (const [name, spell] of Object.entries(SPELLINGS)) {
    const prop = censusOne(spell(allowObj([...GOOD_PARTS, "GIT_DIR: '/x'"])));
    assert.equal(prop.length, 1, name + ' (property)');
    assert.match(prop[0], /GIT_DIR/, name);
  }
  const listed = censusOne("const keep = ['PATH', 'GIT_WORK_TREE'];\n" + `const env = ${allowObj(GOOD_PARTS)};\n${SS}('git', ['status'], { cwd: dir, env });\n`);
  assert.equal(listed.length, 1, 'keep list');
  assert.match(listed[0], /GIT_WORK_TREE/);
});

test('allowlist env (witness 5): an allowlist missing GIT_CONFIG_NOSYSTEM, or setting it to anything but 1, FAILS', () => {
  for (const [name, spell] of Object.entries(SPELLINGS)) {
    const missing = censusOne(spell(allowObj([FROM_ENTRIES, "GIT_TERMINAL_PROMPT: '0'"])));
    assert.equal(missing.length, 1, name + ' (missing)');
    assert.match(missing[0], /GIT_CONFIG_NOSYSTEM/, name);
    const zero = censusOne(spell(allowObj([FROM_ENTRIES, "GIT_CONFIG_NOSYSTEM: '0'"])));
    assert.equal(zero.length, 1, name + ' (zero)');
  }
});

test('allowlist env: any spread other than Object.fromEntries(...) FAILS, so an unknown object cannot smuggle a GIT_* key in', () => {
  const findings = censusOne(asInline(allowObj([FROM_ENTRIES, NOSYS, '...extra'])));
  assert.equal(findings.length, 1);
  assert.match(findings[0], /spread/);
});

test('allowlist env: an allowlist object mutated after its declaration FAILS (a GIT_DIR assigned later is the same hole)', () => {
  const text = asNamed(allowObj(GOOD_PARTS)) + "gitEnvAllow.GIT_DIR = process.cwd();\n";
  const findings = censusOne(text);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /mutated after its declaration/);
});

test('allowlist env: process.env read through a key variable is allowed only as an indexed read; a bare mention inside the object FAILS', () => {
  const findings = censusOne(asInline(allowObj([`...Object.fromEntries(Object.entries(${PE}))`, NOSYS])));
  assert.equal(findings.length, 1);
  assert.match(findings[0], /process\.env/);
});

test('allowlist env: a comment that names GIT_DIR inside the allowlist (as the canon release-notes.mjs does) is not a GIT_* key', () => {
  const obj = allowObj([FROM_ENTRIES, NOSYS, '// a GIT_DIR a hook leaves is why this is an allowlist\n GIT_TERMINAL_PROMPT: \'0\'']);
  assert.deepEqual(censusOne(asInline(obj)), []);
});

test('allowlist env: the census still runs over every file, and this room\'s real tree is clean with only the pins that still need to exist', () => {
  const files = collectScriptsMjs(repo);
  const findings = censusGitSpawns(files);
  assert.deepEqual(findings, []);
  assert.ok(files.some((f) => f.rel === 'scripts/release-notes.mjs'), 'the canon file is in the walk, and (no pin) is judged by the rule');
  assert.ok(!Object.hasOwn(EXEMPT_CARRIERS, 'scripts/release-notes.mjs'), 'its blob pin is gone');
  for (const rel of ['scripts/release-notes.test.mjs', 'scripts/secret-scan.test.mjs', 'scripts/secret-gate.mjs']) {
    assert.ok(files.some((f) => f.rel === rel), rel + ' is in the walk');
    assert.ok(!Object.hasOwn(EXEMPT_CARRIERS, rel), rel + ' is judged by the rule, with no pin');
  }
});

test('allowlist env: GIT_TERMINAL_PROMPT is allowed only as \'0\'; any other value FAILS', () => {
  const findings = censusOne(asInline(allowObj([FROM_ENTRIES, NOSYS, "GIT_TERMINAL_PROMPT: '1'"])));
  assert.equal(findings.length, 1);
  assert.match(findings[0], /GIT_TERMINAL_PROMPT/);
});

test('allowlist env: a name declared as an allowlist in one place and as anything else in another FAILS (the census cannot tell which one a call uses)', () => {
  const text = KEEP + `const env = ${allowObj(GOOD_PARTS)};\nfunction other() {\n  let env = makeEnv();\n  ${SS}('git', ['status'], { cwd: dir, env });\n}\n`;
  const findings = censusOne(text);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /not declared/);
});

test('allowlist env: a name declared twice, both as safe allowlists, passes; one of the two unsafe FAILS', () => {
  const two = (second) => KEEP + `const env = ${allowObj(GOOD_PARTS)};\nfunction other() {\n  const env = ${second};\n  ${SS}('git', ['status'], { cwd: dir, env });\n}\n`;
  assert.deepEqual(censusOne(two(allowObj(GOOD_PARTS))), []);
  assert.equal(censusOne(two(allowObj([`...${PE}`, NOSYS]))).length, 1);
});

// ---- 08d: the census WITNESS LIST (the chief's 08d-census-witness-list.md): 34 MUST-FAIL vectors (F1-F34) and the MUST-PASS controls
// (P1-P6), each a minimal module that spawns git with the vector's env, fed to censusGitSpawns. A vector that declares a `const env`
// runs in BOTH call forms, the shorthand `{ env }` and `env: env`. X-rows are bypasses found beyond the list (candidate rows).
const W_HDR = `import { ${SS} } from 'node:child_process';\n`;
const W_CALL = (o) => `${SS}('git', ['status'], ${o});\n`;
const W_FORMS = [['shorthand', '{ cwd: d, env }'], ['env: env', '{ cwd: d, env: env }']];
const W_KEEP = "const keep = ['PATH', 'HOME'];\n";
const W_PICK = 'Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]))';
const W_PICK_IN = 'Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]]))';
const W_CLEAN = `{ ...${W_PICK}, GIT_CONFIG_NOSYSTEM: '1' }`;
// a const-env vector: `decl` declares `const env`; run in both call forms
const cst = (decl) => ({ forms: W_FORMS, src: (o) => W_HDR + decl + W_CALL(o) });
// an inline vector: `expr` is written as the env value; `pre` precedes the call
const inl = (expr, pre = '') => ({ forms: [['inline', null]], src: () => W_HDR + pre + W_CALL(`{ cwd: d, env: ${expr} }`) });
// a custom vector: the whole body, given the options text
const raw = (fn, forms = W_FORMS) => ({ forms, src: (o) => W_HDR + fn(o) });
const wverdict = (text) => censusGitSpawns([{ rel: 'scripts/w.mjs', text }], { exemptions: [], carriers: {} });

const MUST_FAIL = {
  F1: cst(`const base = { ...process.env };\nconst env = { ...base, GIT_CONFIG_NOSYSTEM: '1' };\n`),
  F1b: cst(`const extra = process.env;\nconst env = { ...extra, GIT_CONFIG_NOSYSTEM: '1' };\n`),
  F1c: cst(`const e = process.env;\nconst env = { ...Object.fromEntries(Object.entries(e)), GIT_CONFIG_NOSYSTEM: '1' };\n`),
  F2: inl("{ ...Object.fromEntries(Object.entries(process.env)), GIT_CONFIG_NOSYSTEM: '1' }"),
  F3: inl("{ ...Object.fromEntries(Object.entries(process.env).filter(() => true)), GIT_CONFIG_NOSYSTEM: '1' }"),
  F4: inl("{ ...process['env'], GIT_CONFIG_NOSYSTEM: '1' }"),
  F5: inl("{ ...penv, GIT_CONFIG_NOSYSTEM: '1' }", "import { env as penv } from 'node:process';\n"),
  F5b: inl("{ ...Object.fromEntries(Object.entries(penv)), GIT_CONFIG_NOSYSTEM: '1' }", "import { env as penv } from 'node:process';\n"),
  F6: inl('{ ...gitEnv(d), ...process.env }'),
  F7: inl('{ ...gitEnv(d), ...base }', 'const base = { ...process.env };\n'),
  F8: inl("{ GIT_CONFIG_NOSYSTEM: '1', extra: { ...process.env } }"),
  F9: inl("{ ...Object.fromEntries(keep.filter(Boolean).map((k) => [k, process.env[k]]).concat(Object.entries(process.env))), GIT_CONFIG_NOSYSTEM: '1' }", W_KEEP),
  F10: inl("{ ...Object.fromEntries(keep.filter(Boolean).flatMap(() => Object.entries(process.env))), GIT_CONFIG_NOSYSTEM: '1' }", W_KEEP),
  F11: inl("{ GIT_CONFIG_NOSYSTEM: '1', all: process.env }"),
  F12: cst("function all() { return process.env; }\nconst env = { ...Object.fromEntries(Object.entries(all())), GIT_CONFIG_NOSYSTEM: '1' };\n"),
  F13: inl('mk(d)', "function mk(x) { if (x) return { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1' }; return process.env; }\n"),
  F14: inl('sandboxEnv(cwd)'),
  F15: cst(`${W_KEEP}const env = ${W_CLEAN};\nObject.assign(env, process.env);\n`),
  F16: cst("const env = { GIT_CONFIG_NOSYSTEM: '1' };\nfor (const k of Object.keys(process.env)) env[k] = process.env[k];\n"),
  F17: cst(`${W_KEEP}const env = ${W_CLEAN};\nenv.GIT_DIR = '/elsewhere/.git';\n`),
  F18: cst("const KEYS = ['PATH'];\nKEYS.push('GIT_DIR');\nconst env = { ...Object.fromEntries(KEYS.map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\n"),
  F19: cst(`const keep = ['PATH', 'GIT_DIR'];\nconst env = ${W_CLEAN};\n`),
  F20: cst(`const k2 = ['GIT_DIR'];\nconst keep = ['PATH', ...k2];\nconst env = ${W_CLEAN};\n`),
  F21: cst(`const keep = ['PATH', 'GIT_' + 'DIR'];\nconst env = ${W_CLEAN};\n`),
  F22: inl("{ GIT_CONFIG_NOSYSTEM: '1', ['GIT' + '_DIR']: process.env['GIT' + '_DIR'] }"),
  F23: inl(`{ ...${W_PICK}, GIT_CONFIG_NOSYSTEM: '0' }`, W_KEEP),
  F24: inl(`{ ...${W_PICK}, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_NOSYSTEM: '0' }`, W_KEEP),
  F25: inl(`{ GIT_CONFIG_NOSYSTEM: '1', ...${W_PICK}, ...over }`, `${W_KEEP}const over = { GIT_CONFIG_NOSYSTEM: '0' };\n`),
  F26: inl(`{ ...${W_PICK} }`, W_KEEP),
  F27: inl(`{ ...${W_PICK}, GIT_CONFIG_NOSYSTEM: flag }`, `${W_KEEP}const flag = '1';\n`),
  F28: inl(`{\n  // GIT_CONFIG_NOSYSTEM: '1'\n  ...${W_PICK}\n}`, W_KEEP),
  F28b: inl(`{ /* GIT_CONFIG_NOSYSTEM: '1' */ ...${W_PICK} }`, W_KEEP),
  F29: inl(`{ ...${W_PICK}, GIT_CONFIG_NOSYSTEM: '1', git_dir: d }`, W_KEEP),
  F30: inl(`{ ...${W_PICK}, GIT_CONFIG_NOSYSTEM: '1', GIT_DIR: x }`, W_KEEP),
  F31: raw((o) => `${W_KEEP}function a(d) {\n  const env = ${W_CLEAN};\n  return env;\n}\nfunction b(d) {\n  const env = { ...process.env };\n  ${W_CALL(o)}}\n`),
  F32: raw((o) => `${W_KEEP}const env = ${W_CLEAN};\nfunction f(d) {\n  let env = { ...process.env };\n  ${W_CALL(o)}}\n`),
  F33: raw((o) => `${W_KEEP}const env = ${W_CLEAN};\nfunction f(d, env) {\n  ${W_CALL(o)}}\n`),
  F34: raw((o) => `${W_KEEP}function a() {\n  const e2 = ${W_CLEAN};\n  return e2;\n}\nfunction b(d) {\n  const e2 = { ...process.env };\n  ${W_CALL(o)}}\n`, [['env: e2', '{ cwd: d, env: e2 }']]),
  // ---- found beyond the list (candidate rows for the chief) ----
  X1: inl(`{ ...${W_PICK}, GIT_CONFIG_NOSYSTEM: '1', URL: 'a//b', GIT_DIR: '/x' }`, W_KEEP),
  X2: raw(() => `const u = 'http://x'; ${SS}('git', ['status'], { cwd: d, env: process.env });\n`, [['one line', null]]),
  X3: raw(() => `${SS}('git', ['status'], { cwd: d, env: gitEnv(d), ...opts });\n`, [['spread after env', null]]),
  X5: raw((o) => `${W_KEEP}let env = ${W_CLEAN};\nenv = { ...process.env };\n${W_CALL(o)}`),
  X6: raw((o) => `${W_KEEP}const env = ${W_CLEAN};\naddAll(env);\n${W_CALL(o)}`),
  X7: raw((o) => `${W_KEEP}const env = ${W_CLEAN};\nconst e2 = env;\nObject.assign(e2, process.env);\n${W_CALL(o)}`),
  F11b: inl("{ GIT_CONFIG_NOSYSTEM: '1', all: penv }", "import { env as penv } from 'node:process';\n"),
  X8: cst("const env = gitEnv(d);\nenv.GIT_DIR = '/elsewhere/.git';\n"),
  X9: inl(`{ ...${W_PICK}, extra: { GIT_CONFIG_NOSYSTEM: '1' } }`, W_KEEP),
  X10: inl(`{ ...${W_PICK} ?? base, GIT_CONFIG_NOSYSTEM: '1' }`, `${W_KEEP}const base = { ...process.env };\n`),
  X11: inl("{ ...Object.fromEntries(keep.map((k) => [pickName(k), process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' }", W_KEEP),
  X12: inl(`{ ...${W_PICK}, GIT_CONFIG_NOSYSTEM: '1', [k]: 'x' }`, W_KEEP),
  F28c: inl(`{ /* GIT_CONFIG_NOSYSTEM: '1', */ ...${W_PICK} }`, W_KEEP),
  X13: inl("{ ...Object.fromEntries(keep.map((k) => [k + 'x', process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' }", W_KEEP),
  X14: inl("{ ...Object.fromEntries(keep.map((k) => [k.toLowerCase(), process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' }", W_KEEP),
  X15: inl("{ ...Object.fromEntries(keep.map((k) => [Object.values, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' }", W_KEEP),
  F36: inl('mk(d)', "function mk(x) { foo(); return { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1' }; }\n"),
  F37: inl('mk(d)', "const mk = (x) => ({ ...process.env, GIT_CONFIG_NOSYSTEM: '1' });\n"),
  F38: inl('mk(d)', "function mk(x) { return { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1' }; }\nconst mk = (x) => process.env;\n"),
  F40: inl('mk(d)', "const mk = (x) => ({ PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1' });\nfunction mk(x) { foo(); return process.env; }\n"),
  F39: inl('mk(d)', "function mk(x) { return { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1' }; }\nmk = () => process.env;\n"),
};

const MUST_PASS = {
  P3a: inl('gitEnv(d)'),
  P8: inl('mk(d)', "const mk = (x) => ({ PATH: process.env.PATH, HOME: x, GIT_CONFIG_NOSYSTEM: '1' });\n"),
  P9: inl('mk(d)', "function mk(x) { return { PATH: process.env.PATH, HOME: x, GIT_CONFIG_NOSYSTEM: '1' }; }\n"),
  P10: inl("{ PATH: sanitize(process.env.PATH), HOME: path.dirname(d), TMP: 'a' + 'b', GIT_CONFIG_NOSYSTEM: '1' }"),
  P3b: cst('const env = gitEnv(d);\n'),
  P4: inl("{ PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: '1' }"),
  P5: inl(`{ ...${W_PICK}, GIT_CONFIG_NOSYSTEM: '1' }`, W_KEEP),
  P5c: inl(`{ ...${W_PICK_IN}, GIT_CONFIG_NOSYSTEM: '1' }`, W_KEEP),
  P5b: cst(`${W_KEEP}const env = ${W_CLEAN};\n`),
  P6: inl(`{ ...${W_PICK}, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_CEILING_DIRECTORIES: d }`, W_KEEP),
  P6b: cst(`${W_KEEP}const env = { ...${W_PICK}, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_CEILING_DIRECTORIES: d };\n`),
  P7: raw((o) => `const keep = ['PATH', 'GIT_CEILING_DIRECTORIES'];\nconst env = ${W_CLEAN};\n${W_CALL(o)}`),
};

for (const [id, v] of Object.entries(MUST_FAIL)) {
  for (const [label, o] of v.forms) {
    test(`witness ${id} [${label}]: MUST FAIL (a finding, never a silent pass)`, () => {
      const findings = wverdict(v.src(o));
      assert.ok(findings.length >= 1, `${id} [${label}] was wrongly PASSED:\n${v.src(o)}`);
    });
  }
}

for (const [id, v] of Object.entries(MUST_PASS)) {
  for (const [label, o] of v.forms) {
    test(`witness ${id} [${label}]: MUST PASS (no finding, no pin)`, () => {
      assert.deepEqual(wverdict(v.src(o)), [], `${id} [${label}] was wrongly refused:\n${v.src(o)}`);
    });
  }
}

test('witness P2: the canon release-notes.test.mjs (blob 7e779ef8), whose sandboxEnv is one returned literal of named keys, passes with NO pin', () => {
  const text = fs.readFileSync(path.join(repo, 'scripts', 'release-notes.test.mjs'), 'utf8');
  assert.ok(blobId(text).startsWith('7e779ef8'), 'the file is not the canon blob 7e779ef8');
  assert.deepEqual(censusGitSpawns([{ rel: 'scripts/release-notes.test.mjs', text }], { exemptions: [], carriers: {} }), []);
});

test('witness P1: the canon release-notes.mjs (blob f8d998d8) passes with NO pin', () => {
  const text = fs.readFileSync(path.join(repo, 'scripts', 'release-notes.mjs'), 'utf8');
  assert.ok(blobId(text).startsWith('f8d998d8'), 'the file is not the canon blob f8d998d8');
  assert.deepEqual(censusGitSpawns([{ rel: 'scripts/release-notes.mjs', text }], { exemptions: [], carriers: {} }), []);
});

// ---- 08d BOUNCE (INSPECT HIGH-1, r-08d.md): eight spawns the census wrongly passed, in three classes, plus the other spellings of each class.
// (a) a duplicate or decoy `env` key in the options object (JavaScript keeps the LAST); (b) a GIT_* name spelled with an escape; (c) a __proto__ key.
// Every backslash is built from a code point (an escape can land as the real character in transit).
const BS = String.fromCharCode(92);
const ESC_G = BS + 'u0047'; // the six characters that spell G in source text
const B_PICK = 'Object.fromEntries(KEEP.filter((k) => k in process.env).map((k) => [k, process.env[k]]))';
const B_KEEP = "const KEEP = ['PATH', 'HOME'];\n";
const B_CLEAN = `{ ...${B_PICK}, GIT_CONFIG_NOSYSTEM: '1' }`;
const bcall = (opts) => `${SS}('git', ['status'], ${opts});\n`;
const bone = (src) => ({ forms: [['one form', null]], src: () => W_HDR + src });

const BOUNCE_FAIL = {
  B1: bone(bcall('{ cwd: d, env: gitEnv(d), env: process.env }')),
  B1b: bone(bcall("{ cwd: d, env: gitEnv(d), 'env': process.env }")),
  B1c: bone(`${SS}('git', ['log', String({ env: gitEnv(d) })], { cwd: d, env: process.env });\n`),
  B2: bone(`const KEEP = ['PATH', '${ESC_G}IT_DIR'];\n` + bcall(`{ cwd: d, env: ${B_CLEAN} }`)),
  B3: bone(bcall(`{ cwd: d, env: { GIT_CONFIG_NOSYSTEM: '1', ${ESC_G}IT_DIR: '/x/.git' } }`)),
  B3b: bone(bcall(`{ cwd: d, env: { GIT_CONFIG_NOSYSTEM: '1', '${ESC_G}IT_DIR': process.env.HOME } }`)),
  B4: bone(bcall("{ cwd: d, env: { GIT_CONFIG_NOSYSTEM: '1', __proto__: globalThis['process']['env'] } }")),
  B5: bone(`const mk = (x) => ({ GIT_CONFIG_NOSYSTEM: '1', ${ESC_G}IT_DIR: x });\n` + bcall("{ cwd: d, env: mk('/x/.git') }")),
  // ---- the other spellings of each class
  // (a) duplicate / decoy env
  C1: bone(bcall("{ cwd: d, env: gitEnv(d), ['env']: process.env }")),
  C2: bone(bcall('{ cwd: d, env: gitEnv(d), env }') + 'const env = process.env;\n'),
  C3: bone(bcall("{ cwd: d, env: gitEnv(d), env: gitEnv(d) }")),
  C4: bone(bcall('{ cwd: d, env: gitEnv(d), __proto__: { env: process.env } }')),
  C5: bone(bcall(`{ cwd: d, ${BS}u0065nv: process.env }`)),
  // (b) escapes in names
  C6: bone(`const KEEP = ['PATH', '${BS}x47IT_DIR'];\n` + bcall(`{ cwd: d, env: ${B_CLEAN} }`)),
  C7: bone(bcall(`{ cwd: d, env: { GIT_CONFIG_NOSYSTEM: '1', ${BS}u{47}IT_DIR: '/x/.git' } }`)),
  C8: bone(bcall(`{ cwd: d, env: { GIT_CONFIG_NOSYSTEM: '1', '${BS}x47IT_DIR': '/x/.git' } }`)),
  C9: bone(bcall(`{ cwd: d, env: { GIT_CONFIG_NOSYSTEM: '1', __pr${BS}u006fto__: process.env } }`)),
  // (c) __proto__ and other prototype paths
  C10: bone(bcall("{ cwd: d, env: { GIT_CONFIG_NOSYSTEM: '1', '__proto__': process.env } }")),
  C11: bone(bcall("{ cwd: d, env: { GIT_CONFIG_NOSYSTEM: '1', ['__proto__']: process.env } }")),
  C12: bone(`const env = { GIT_CONFIG_NOSYSTEM: '1' };\nObject.setPrototypeOf(env, process.env);\n` + bcall('{ cwd: d, env }')),
  C13: bone(`const env = { GIT_CONFIG_NOSYSTEM: '1' };\nenv['__proto__'] = process.env;\n` + bcall('{ cwd: d, env: env }')),
  C14: bone(`const mk = (x) => ({ GIT_CONFIG_NOSYSTEM: '1', __proto__: x });\n` + bcall('{ cwd: d, env: mk(process.env) }')),
  // an allowlist object followed by more text (a member read, a call on the literal)
  C16: bone(bcall(`{ cwd: d, env: ${B_CLEAN}.valueOf() }`)),
  // `{ ... } && allEnv` evaluates to allEnv: the whole environment, behind an allowlist-looking literal (allEnv is not an alias the census knows)
  C16b: bone("const allEnv = globalThis['process']['env'];\n" + bcall("{ cwd: d, env: { GIT_CONFIG_NOSYSTEM: '1' } && allEnv }")),
  // each guard needs a vector only IT refuses: an escaped options key beside a plain clean env (the escaped one spells env and wins), and a
  // __proto__ in a NAMED env object whose options text shows no __proto__
  C5b: bone(bcall(`{ cwd: d, env: gitEnv(d), ${BS}u0065nv: process.env }`)),
  C14b: bone("const allEnv = globalThis['process']['env'];\nconst env = { GIT_CONFIG_NOSYSTEM: '1', __proto__: allEnv };\n" + bcall('{ cwd: d, env }')),
  // an escape inside the pairs a spread builds, where key names are made
  C15: bone(`const KEEP = ['PATH'];\n` + bcall(`{ cwd: d, env: { ...Object.fromEntries(KEEP.map((k) => [k, proc${BS}u0065ss.env[k]])), GIT_CONFIG_NOSYSTEM: '1' } }`)),
};

const BOUNCE_PASS = {
  // a backslash in a property VALUE is fine (a Windows path); only KEYS and name lists are judged for escapes
  P11: bone(bcall(`{ cwd: 'C:${BS}${BS}work', env: { PATH: process.env.PATH, HOME: 'C:${BS}${BS}home', GIT_CONFIG_NOSYSTEM: '1' } }`)),
  P12: bone(B_KEEP + bcall(`{ cwd: d, encoding: 'utf8', env: ${B_CLEAN} }`)),
  P13: bone(bcall("{ cwd: d, env: gitEnv(d), encoding: 'utf8', timeout: 30000 }")),
  P14: bone(bcall("{ ...base, cwd: d, env: gitEnv(d) }")),
};

for (const [id, v] of Object.entries(BOUNCE_FAIL)) {
  test(`witness ${id} [bounce]: MUST FAIL (a finding, never a silent pass)`, () => {
    const findings = wverdict(v.src(null));
    assert.ok(findings.length >= 1, `${id} was wrongly PASSED:\n${v.src(null)}`);
  });
}

for (const [id, v] of Object.entries(BOUNCE_PASS)) {
  test(`witness ${id} [bounce]: MUST PASS (no finding, no pin)`, () => {
    assert.deepEqual(wverdict(v.src(null)), [], `${id} was wrongly refused:\n${v.src(null)}`);
  });
}
