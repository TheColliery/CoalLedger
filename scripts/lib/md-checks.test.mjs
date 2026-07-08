// md-checks fixture tests — the anti-cry-wolf gate. Two properties, both hard:
//   (1) every PLANTED defect in the defect fixtures is found (exact check id +
//       exact line — recall);
//   (2) ZERO findings on the decoy fixtures, which are stuffed with things
//       that LOOK broken to a regex but render fine (precision = the product).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkDocument } from './md-checks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, '..', 'fixtures');
const CLI = path.join(here, 'md-checks.mjs');

function run(name) {
  const p = path.join(FIX, name);
  return checkDocument(fs.readFileSync(p, 'utf8'), { filePath: p });
}
const pairs = (f) => f.map((x) => `${x.check}@${x.line}`).sort();

test('defects-structure.md: every planted defect found — exact check ids and lines', () => {
  const findings = run('defects-structure.md');
  assert.deepStrictEqual(pairs(findings), [
    'anchor-missing@15', // cross-file: defects-target.md#not-there
    'anchor-missing@7', // #no-such-heading
    'anchor-missing@9', // case mismatch
    'bare-url@25',
    'def-orphan@27',
    'file-missing@11', // ./no-such-file.md
    'file-missing@13', // dead image
    'heading-multiple-h1@5',
    'heading-skip@3',
    'ref-undefined@23',
    'table-ragged@21',
  ].sort());
});

test('defects-structure.md: the case-mismatch finding says so', () => {
  const f = run('defects-structure.md').find((x) => x.line === 9);
  assert.ok(/case mismatch|lowercase/.test(f.message), f.message);
});

test('defects-thai.md: broken Thai anchors found (raw + percent-encoded), good Thai anchor silent', () => {
  const findings = run('defects-thai.md');
  assert.deepStrictEqual(pairs(findings), ['anchor-missing@3', 'anchor-missing@7']);
});

test('decoy-clean.md: ZERO findings (the anti-cry-wolf property)', () => {
  const findings = run('decoy-clean.md');
  assert.deepStrictEqual(findings, [], JSON.stringify(findings, null, 2));
});

test('decoy-thai.md: ZERO findings on Thai/CJK content', () => {
  const findings = run('decoy-thai.md');
  assert.deepStrictEqual(findings, [], JSON.stringify(findings, null, 2));
});

test('without filePath: relative-target checks are skipped, anchor checks still run', () => {
  const findings = checkDocument('# T\n\n[dead](./gone.md) [bad](#nope)\n');
  assert.deepStrictEqual(findings.map((f) => f.check), ['anchor-missing']);
});

test('fileExists is injectable (hermetic file checks)', () => {
  const seen = [];
  const findings = checkDocument('[x](./a.md) [y](./b.md)\n', {
    filePath: path.join(FIX, 'virtual.md'),
    fileExists: (p) => { seen.push(p); return p.endsWith('a.md'); },
  });
  assert.strictEqual(findings.length, 1);
  assert.ok(findings[0].message.includes('b.md'));
  assert.strictEqual(seen.length, 2);
});

test('cross-file anchors read the target through the injectable readFile', () => {
  const findings = checkDocument('[ok](./t.md#real) [bad](./t.md#fake)\n', {
    filePath: path.join(FIX, 'virtual.md'),
    fileExists: () => true,
    readFile: () => '# Real\n',
  });
  assert.strictEqual(findings.length, 1);
  assert.ok(findings[0].message.includes('#fake'));
});

test('table-ragged flags ONLY rows with extra cells (fewer cells pad and render fine)', () => {
  const findings = checkDocument('| a | b |\n| --- | --- |\n| 1 |\n| 1 | 2 | 3 |\n');
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].check, 'table-ragged');
  assert.strictEqual(findings[0].line, 4);
});

test('bare-url is line-accurate inside a wrapped paragraph', () => {
  const findings = checkDocument('start of paragraph\nwraps to https://example.com/here now\n');
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].line, 2);
});

test('duplicate headings resolve through GitHub dedupe suffixes, and one-past fails', () => {
  const src = '## Dup\n\n## Dup\n\n[a](#dup) [b](#dup-1) [c](#dup-2)\n';
  const findings = checkDocument(src);
  assert.strictEqual(findings.length, 1);
  assert.ok(findings[0].message.includes('#dup-2'));
});

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

test('CLI --json: exit 0, parseable JSON, counts match the library', () => {
  const r = spawnSync(process.execPath, [CLI, '--json', path.join(FIX, 'defects-structure.md')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].findings.length, run('defects-structure.md').length);
});

test('CLI human output: one line per finding + a summary line', () => {
  const r = spawnSync(process.execPath, [CLI, path.join(FIX, 'decoy-clean.md')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('0 finding(s) across 1 file(s)'));
});

test('CLI fails loud on an unreadable file (exit 1) but still checks the rest', () => {
  const r = spawnSync(process.execPath, [CLI, path.join(FIX, 'does-not-exist.md'), path.join(FIX, 'decoy-thai.md')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
  assert.ok(r.stderr.includes('FAIL'));
  assert.ok(r.stdout.includes('0 finding(s)'), 'the readable file was still checked');
});
