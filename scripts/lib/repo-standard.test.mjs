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
import { CRITERIA } from './repo-standard.mjs';
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
