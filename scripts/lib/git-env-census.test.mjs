import { test } from 'node:test';
import assert from 'node:assert';
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
  // 05a: the roster is three (release-notes.mjs joined, re-pinned at the canon's explicit-allowlist-env blob; the roster assertion
  // was proven wrong by the adoption, which is its own named step).
  assert.deepEqual(Object.keys(EXEMPT_CARRIERS).sort(), ['scripts/release-notes.mjs', 'scripts/secret-gate.test.mjs', 'scripts/secret-scan.test.mjs']);
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

test('census carriers (F1): the live release-notes.mjs carrier, edited by one line, is told to re-derive from overlay-coal-skill', () => {
  const files = collectScriptsMjs(repo).map((f) => (f.rel === 'scripts/release-notes.mjs' ? { ...f, text: f.text + '// edited\n' } : f));
  const findings = censusGitSpawns(files);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /^scripts\/release-notes\.mjs is an exempt byte-equal org carrier/);
  assert.match(findings[0], /templates\/overlay-coal-skill\/scripts\//);
});
