// T-21 witness: doc-standard's repository-scope pass, keyed on OpenSSF Best Practices passing criteria. Fixtures are
// folders under the resolved temp folder; the CLI runs through SANDBOX_ENV (T-19). Every run passes --now, so the
// Expires checks never depend on the clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CRITERIA, checkRepository } from './repo-standard.mjs';
import { SANDBOX_ENV } from '../test-sandbox.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, 'repo-standard.mjs');
const CHECKLIST = path.join(here, '..', '..', '..', 'CoalGob', '.claude', 'standards', 'openssf-badge-passing.md');
const TMP = fs.realpathSync.native(os.tmpdir());
const NOW = '2026-11-02T00:00:00Z';
const FUTURE = '2030-01-01T00:00:00Z';
const PAST = '2020-01-01T00:00:00Z';
const LITERAL_CRITERIA = ['license_location', 'contribution', 'vulnerability_report_process', 'release_notes'];

function fixture(t) {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(TMP, 'cl-rstd-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }));
  return d;
}
function put(d, rel, body) {
  fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
  fs.writeFileSync(path.join(d, rel), body);
}
const SECURITY_TXT = (expires) => `Contact: mailto:security@example.invalid\n${expires === null ? '' : `Expires: ${expires}\n`}`;
const KEEP_A_CHANGELOG = '# Changelog\n\n## [1.0.0] - 2026-01-01\n\n### Added\n\n- The first release, fixed in abc1234 by hand.\n';
const ONELINE = ['abc1234 first change', 'bcd2345 second change', 'cde3456 third change', 'def4567 fourth change', 'efa5678 fifth change'];

// The clean set: every criterion satisfied. A test removes or changes one part to make a single check fail.
function clean(t) {
  const d = fixture(t);
  put(d, 'LICENSE', 'MIT License\n');
  put(d, 'CONTRIBUTING.md', '# Contributing\n');
  put(d, 'SECURITY.md', '# Security\n');
  put(d, '.well-known/security.txt', SECURITY_TXT(FUTURE));
  put(d, 'CHANGELOG.md', KEEP_A_CHANGELOG);
  return d;
}

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL', env: SANDBOX_ENV });
}
function findings(d) {
  const r = run([`--root=${d}`, '--json', `--now=${NOW}`]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).findings;
}
const checks = (f) => f.map((x) => x.check).sort();

test('the clean set has no finding', (t) => {
  assert.deepEqual(findings(clean(t)), []);
});

test('each criterion check fires alone when its file is missing', (t) => {
  const noLicense = clean(t); fs.rmSync(path.join(noLicense, 'LICENSE'));
  assert.deepEqual(checks(findings(noLicense)), ['license-missing']);
  const noContrib = clean(t); fs.rmSync(path.join(noContrib, 'CONTRIBUTING.md'));
  assert.deepEqual(checks(findings(noContrib)), ['contributing-missing']);
  const noSecurity = clean(t); fs.rmSync(path.join(noSecurity, 'SECURITY.md')); fs.rmSync(path.join(noSecurity, '.well-known'), { recursive: true });
  assert.deepEqual(checks(findings(noSecurity)), ['vuln-report-missing']);
});

test('the release-notes check fires alone on a raw git-log changelog', (t) => {
  const d = clean(t);
  put(d, 'CHANGELOG.md', `commit ${'a'.repeat(40)}\nAuthor: t <t@example.invalid>\n\n    change\n`);
  assert.deepEqual(checks(findings(d)), ['release-notes-raw-log']);
});

test('a CONTRIBUTING file found only in .github/ passes', (t) => {
  const d = clean(t); fs.rmSync(path.join(d, 'CONTRIBUTING.md'));
  put(d, '.github/CONTRIBUTING.md', '# Contributing\n');
  assert.deepEqual(findings(d), []);
});

test('a lower-case license file passes', (t) => {
  const d = clean(t); fs.renameSync(path.join(d, 'LICENSE'), path.join(d, 'license'));
  assert.deepEqual(findings(d), []);
});

test('a valid security.txt alone satisfies the vulnerability process: no vuln-report-missing', (t) => {
  const d = clean(t); fs.rmSync(path.join(d, 'SECURITY.md'));
  assert.ok(!checks(findings(d)).includes('vuln-report-missing'));
});

test('an expired security.txt beside a SECURITY.md reports securitytxt-expired only', (t) => {
  const d = clean(t); put(d, '.well-known/security.txt', SECURITY_TXT(PAST));
  assert.deepEqual(checks(findings(d)), ['securitytxt-expired']);
});

test('a security.txt with no Expires field is securitytxt-expired', (t) => {
  const d = clean(t); put(d, '.well-known/security.txt', SECURITY_TXT(null));
  assert.deepEqual(checks(findings(d)), ['securitytxt-expired']);
});

test('CRLF security.txt and CRLF raw-log changelog behave as their LF forms', (t) => {
  const d = clean(t);
  put(d, '.well-known/security.txt', SECURITY_TXT(PAST).replace(/\n/g, '\r\n'));
  assert.deepEqual(checks(findings(d)), ['securitytxt-expired']);
  const raw = clean(t);
  put(raw, 'CHANGELOG.md', `# Changelog\r\n\r\n${ONELINE.join('\r\n')}\r\n`);
  const f = findings(raw).filter((x) => x.check === 'release-notes-raw-log');
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 3, 'the finding is the first matching line');
});

test('a Keep a Changelog file whose prose names a 7-hex SHA once has no finding', (t) => {
  assert.ok(!checks(findings(clean(t))).includes('release-notes-raw-log'));
});

test('four one-line log entries are not a raw log', (t) => {
  const d = clean(t); put(d, 'CHANGELOG.md', `${ONELINE.slice(0, 4).join('\n')}\n`);
  assert.ok(!checks(findings(d)).includes('release-notes-raw-log'));
});

test('five one-line log entries are a raw log, reported at the first line', (t) => {
  const d = clean(t); put(d, 'CHANGELOG.md', `${ONELINE.join('\n')}\n`);
  const f = findings(d).filter((x) => x.check === 'release-notes-raw-log');
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 1);
  assert.equal(f[0].criterion, 'release_notes');
  assert.equal(f[0].verdict, 'SUSPECTED');
});

test('a default git log entry (commit line then Author line) is a raw log', (t) => {
  const d = clean(t); put(d, 'CHANGELOG.md', `commit ${'b'.repeat(40)}\nAuthor: t <t@example.invalid>\n`);
  assert.ok(checks(findings(d)).includes('release-notes-raw-log'));
});

// INSPECT r41 MED-1: the licence check accepts the forms the licence ecosystem uses (one file per licence, REUSE LICENSES/).
test('a per-licence LICENSE-MIT file at the root satisfies the licence check', (t) => {
  const d = clean(t); fs.rmSync(path.join(d, 'LICENSE')); put(d, 'LICENSE-MIT', 'MIT License\n');
  assert.ok(!checks(findings(d)).includes('license-missing'));
});

test('a REUSE LICENSES/ folder holding a plain file satisfies the licence check', (t) => {
  const d = clean(t); fs.rmSync(path.join(d, 'LICENSE')); put(d, 'LICENSES/MIT.txt', 'MIT License\n');
  assert.ok(!checks(findings(d)).includes('license-missing'));
});

test('an empty LICENSES/ folder is not a licence: license-missing still fires', (t) => {
  const d = clean(t); fs.rmSync(path.join(d, 'LICENSE')); fs.mkdirSync(path.join(d, 'LICENSES'));
  assert.deepEqual(checks(findings(d)), ['license-missing']);
});

// INSPECT r42 LOW-A: the licence name takes the same extensions as CONTRIBUTING and SECURITY, so LICENSE.rst passes.
test('a LICENSE.rst at the root satisfies the licence check', (t) => {
  const d = clean(t); fs.renameSync(path.join(d, 'LICENSE'), path.join(d, 'LICENSE.rst'));
  assert.deepEqual(findings(d), []);
});

// INSPECT r41 MED-2: a date between --now and today is judged by --now. A mutant that reads the real clock flips it.
test('an Expires between --now and the real clock is judged by --now: no finding before it, securitytxt-expired after it', (t) => {
  const d = clean(t); put(d, '.well-known/security.txt', SECURITY_TXT('2026-09-01T00:00:00Z'));
  const before = run([`--root=${d}`, '--json', '--now=2026-08-01T00:00:00Z']);
  assert.equal(before.status, 0, before.stderr);
  assert.ok(!checks(JSON.parse(before.stdout).findings).includes('securitytxt-expired'), 'before the date: no finding');
  const after = run([`--root=${d}`, '--json', '--now=2026-10-01T00:00:00Z']);
  assert.equal(after.status, 0, after.stderr);
  assert.deepEqual(checks(JSON.parse(after.stdout).findings), ['securitytxt-expired'], 'after the date: securitytxt-expired');
});

// INSPECT r41 LOW-1: RFC 9116 section 2.5.5 forbids a second Expires line.
test('two Expires lines are securitytxt-expired with the repeat reason', (t) => {
  const d = clean(t);
  put(d, '.well-known/security.txt', `Contact: mailto:security@example.invalid\nExpires: ${FUTURE}\nExpires: 2031-01-01T00:00:00Z\n`);
  const f = findings(d).filter((x) => x.check === 'securitytxt-expired');
  assert.equal(f.length, 1);
  assert.equal(f[0].reason, '.well-known/security.txt: Expires appears more than once (RFC 9116 section 2.5.5)');
});

// INSPECT r41 LOW-1: a release-notes file over the read bound is a finding, never a silent skip.
test('a release-notes file over the read bound gives release-notes-unreadable, SUSPECTED, never silence', (t) => {
  const d = clean(t); put(d, 'CHANGELOG.md', 'x'.repeat(4 * 1024 * 1024 + 1));
  const f = findings(d).filter((x) => x.check === 'release-notes-unreadable');
  assert.equal(f.length, 1);
  assert.equal(f[0].verdict, 'SUSPECTED');
  assert.equal(f[0].file, 'CHANGELOG.md');
});

// T-37 (order 29am). The Expires line is read by a prefix test and a trim, not a backtracking match.
const NOW_MS = Date.parse(NOW);
function stxtReason(t, body) {
  const d = clean(t);
  put(d, '.well-known/security.txt', body);
  const f = checkRepository(d, NOW_MS).filter((x) => x.check === 'securitytxt-expired');
  return f.length ? f[0].reason : null;
}

test('T-37: the Expires line keeps its results: valid in any case and spacing, no field for an empty or CR-holding value', (t) => {
  const CR = String.fromCharCode(13);
  const TAB = String.fromCharCode(9);
  const NOFIELD = '.well-known/security.txt: no Expires field (RFC 9116 section 2.5.5 requires one)';
  assert.strictEqual(stxtReason(t, `Expires: ${FUTURE}   \n`), null);
  assert.strictEqual(stxtReason(t, `expires:${TAB}${FUTURE}${TAB}${TAB}\n`), null);
  assert.strictEqual(stxtReason(t, 'Expires:    \n'), NOFIELD);
  assert.strictEqual(stxtReason(t, 'Expires:\n'), NOFIELD);
  assert.strictEqual(stxtReason(t, `Expires: a${CR}b\n`), NOFIELD);
  assert.strictEqual(stxtReason(t, 'Expires: nope\n'), '.well-known/security.txt: Expires is not a date: "nope"');
});

test('T-37: an Expires line of 64,000 spaces is read in linear time (best of 3 under 250 ms)', (t) => {
  const budgetMs = 250;
  const d = clean(t);
  put(d, '.well-known/security.txt', 'Expires:' + ' '.repeat(64000) + '\n');
  const times = [];
  for (let i = 0; i < 3; i++) {
    const t0 = process.hrtime.bigint();
    checkRepository(d, NOW_MS);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    if (times[i] > 20 * budgetMs) break; // a run this far past the budget is a fail: stop now, so the assert names it
  }
  assert.ok(Math.min(...times) < budgetMs, `best of ${times.length} = ${Math.min(...times).toFixed(1)} ms, budget ${budgetMs} ms`);
});

// T-37: one file reached under two names (a hard link in docs/ to the root CHANGELOG.md) is judged once. A link component
// is refused by the walk, so the second name must be a hard link: a second path to the same file, not a link to a folder.
test('T-37: a release-notes file reached under two names is judged once', (t) => {
  const d = clean(t);
  put(d, 'CHANGELOG.md', ONELINE.join('\n') + '\n');
  fs.mkdirSync(path.join(d, 'docs'));
  try {
    fs.linkSync(path.join(d, 'CHANGELOG.md'), path.join(d, 'docs', 'CHANGELOG.md'));
  } catch {
    t.skip('this volume refuses a hard link (capability probe): the dedupe has no second name to test');
    return;
  }
  const f = checkRepository(d, NOW_MS).filter((x) => x.check === 'release-notes-raw-log');
  assert.strictEqual(f.length, 1, `judged ${f.length} times`);
});

test('--root missing exits 2 with a usage line', () => {
  const r = run([`--now=${NOW}`, '--json']);
  assert.equal(r.status, 2, r.stdout);
});

test('OpenSSF witness: every criterion the engine emits is a heading in the CoalGob checklist (skips when no sibling room)', (t) => {
  assert.deepEqual([...CRITERIA].sort(), [...LITERAL_CRITERIA].sort());
  if (!fs.existsSync(CHECKLIST)) { t.skip('no CoalGob checklist beside this room (CI has no sibling room)'); return; }
  const headings = fs.readFileSync(CHECKLIST, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('### ')).map((l) => l.slice(4).split(' ')[0]);
  for (const id of LITERAL_CRITERIA) assert.ok(headings.includes(id), `${id} is a heading in the checklist`);
});
