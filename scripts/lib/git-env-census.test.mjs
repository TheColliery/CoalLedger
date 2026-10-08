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
  // 08c: the roster is three (release-notes.mjs left it: rung (3) accepts its allowlist env; release-notes.test.mjs joined at the canon 8cf7e5fd; the 05a roster assertion
  // was proven wrong by the adoption, which is its own named step).
  assert.deepEqual(Object.keys(EXEMPT_CARRIERS).sort(), ['scripts/release-notes.test.mjs', 'scripts/secret-gate.test.mjs', 'scripts/secret-scan.test.mjs']);
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

test('census carriers (F1): the live release-notes.test.mjs carrier, edited by one line, is told to re-derive from overlay-coal-skill', () => {
  const files = collectScriptsMjs(repo).map((f) => (f.rel === 'scripts/release-notes.test.mjs' ? { ...f, text: f.text + '// edited\n' } : f));
  const findings = censusGitSpawns(files);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /^scripts\/release-notes\.test\.mjs is an exempt byte-equal org carrier/);
  assert.match(findings[0], /templates\/overlay-coal-skill\/scripts\//);
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
