// md-checks fixture tests — the anti-cry-wolf gate. Two properties, both hard:
//   (1) every PLANTED defect in the defect fixtures is found (exact check id +
//       exact line — recall);
//   (2) ZERO findings on the decoy fixtures, which are stuffed with things
//       that LOOK broken to a regex but render fine (precision = the product).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
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
    'anchor-missing@17', // cross-file: defects-target.md#not-there
    'anchor-missing@7', // #no-such-heading
    'anchor-missing@9', // case mismatch
    'bare-url@27',
    'def-orphan@29',
    'file-missing@11', // ./no-such-file.md
    'file-missing@13', // dead image
    'heading-duplicate@35', // second "## Setup" — anchor silently points to first
    'heading-multiple-h1@5',
    'heading-skip@3',
    'image-alt-missing@15', // ![](https://example.com/logo.png), empty alt
    'ref-undefined@25',
    'table-ragged@23',
  ].sort());
});

test('defects-structure.md: the planted image-alt-missing finding is SUSPECTED, never CONFIRMED', () => {
  const f = run('defects-structure.md').find((x) => x.check === 'image-alt-missing');
  assert.ok(f, 'image-alt-missing must fire on the planted empty-alt image');
  assert.strictEqual(f.suspected, true);
  assert.ok(/WCAG 1\.1\.1/.test(f.message), f.message);
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
  // heading-duplicate fires on the second "## Dup" + anchor-missing on #dup-2
  assert.strictEqual(findings.length, 2);
  assert.ok(findings.some(f => f.check === 'anchor-missing' && f.message.includes('#dup-2')));
  assert.ok(findings.some(f => f.check === 'heading-duplicate'));
});

// The message names the anchor a reader would type, so it must come from the
// SHIPPED slugger. A hand-rolled `\w`-based one is ASCII-only: it emits a bare
// "#" for Thai/CJK and "#caf-rsum" for "Café résumé" — contradicting the
// language-neutral guarantee (md-checks.mjs header, doc-structure frontmatter)
// in a suite that ships Thai fixtures. Detection is keyed on raw text and is
// unaffected either way, so ONLY the emitted string can catch this.
import { githubSlug } from './md-ast.mjs';

test('heading-duplicate prints the real Unicode anchor, not an ASCII-only slug', () => {
  for (const heading of ['การติดตั้ง', '安装步骤', 'Café résumé', 'Setup Guide']) {
    const f = checkDocument(`## ${heading}\n\n## ${heading}\n`).find((x) => x.check === 'heading-duplicate');
    assert.ok(f, `no heading-duplicate raised for "${heading}"`);
    const printed = /a plain #(\S*) link/.exec(f.message);
    assert.ok(printed, `message shape changed, anchor not locatable: ${f.message}`);
    assert.strictEqual(printed[1], githubSlug(heading), `anchor printed for "${heading}"`);
  }
});

// ---------------------------------------------------------------------------
// image-alt-missing (SUSPECTED-only, always-on, no config toggle — main
// ruling on PR #11/#12: skip-not-important / fill-what-matters, never
// on/off; decorative-vs-content is a human call, so the finding never
// becomes CONFIRMED regardless of how it is configured)
// ---------------------------------------------------------------------------

test('image-alt-missing fires on an empty-alt image', () => {
  const findings = checkDocument('# T\n\n![](./x.png)\n');
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].check, 'image-alt-missing');
  assert.strictEqual(findings[0].suspected, true);
});

test('image-alt-missing is silent when alt text is present', () => {
  const findings = checkDocument('# T\n\n![a logo](./x.png)\n');
  assert.ok(!findings.some((f) => f.check === 'image-alt-missing'));
});

test('image-alt-missing fires on whitespace-only alt (trimmed to empty)', () => {
  const findings = checkDocument('# T\n\n![   ](./x.png)\n');
  assert.strictEqual(findings.filter((f) => f.check === 'image-alt-missing').length, 1);
});

test('image-alt-missing fires on the imageReference node type (full reference form)', () => {
  // Full reference is the one reference form whose alt is independent of its
  // label (![alt][label]) -- alt empty is meaningful here.
  const src = ['# T', '', '![][full-ref]', '', '[full-ref]: ./a.png', ''].join('\n');
  const findings = checkDocument(src).filter((f) => f.check === 'image-alt-missing');
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].suspected, true);
});

test('image-alt-missing is silent on collapsed/shortcut forms, whose alt IS the label text', () => {
  // ![label][] and ![label] use the bracket content as BOTH the reference
  // label and the alt -- structurally never empty when the label resolves.
  const src = [
    '# T', '', '![collapsed-ref][]', '![shortcut-ref]', '',
    '[collapsed-ref]: ./a.png', '[shortcut-ref]: ./b.png', '',
  ].join('\n');
  const findings = checkDocument(src).filter((f) => f.check === 'image-alt-missing');
  assert.strictEqual(findings.length, 0, JSON.stringify(findings, null, 2));
});

test('image-alt-missing is silent on a code span or fenced block (AST-native, not regex)', () => {
  const src = '# T\n\n`![](x.png)` and:\n\n```\n![](x.png)\n```\n';
  const findings = checkDocument(src);
  assert.ok(!findings.some((f) => f.check === 'image-alt-missing'));
});

test('CONFIRMED checks never carry a suspected field (backward compat — old finding shape unchanged)', () => {
  const findings = checkDocument('# T\n\n[dead](./gone.md)\n', { filePath: path.join(FIX, 'virtual.md') });
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].check, 'file-missing');
  assert.ok(!('suspected' in findings[0]));
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

// --- H1 (CoalBoard dogfood): the parser must not go quadratic on crafted docs ---
import { parseMarkdown } from './md-ast.mjs';

test('H1: a pathological inline-link doc parses in bounded (near-linear) time, not O(N^2)', () => {
  // `[a](` repeated N: each `]` used to re-scan the tail to EOS -> O(N^2) hang.
  // Bounded now (MAX_INLINE_DEST): assert a 4000-fragment (16 KB) doc — which the
  // pre-fix code took ~700ms on and ~2.9s at 8000 — finishes comfortably fast.
  const doc = '[a]('.repeat(4000);
  const t0 = process.hrtime.bigint();
  parseMarkdown(doc);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 1500, `pathological parse should be bounded, took ${ms.toFixed(0)}ms`);
});

test('H1: checkDocument flags an over-cap doc and does NOT parse it (SIZE-only transitive vector closed — depth is a SEPARATE guard, see doc-too-nested below, board U13/F1)', () => {
  const over = 'x'.repeat(600 * 1024); // > 512 KB
  const t0 = process.hrtime.bigint();
  const f = checkDocument(over);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].check, 'doc-too-large');
  assert.ok(ms < 100, `an over-cap doc must be flagged instantly, took ${ms.toFixed(0)}ms`);
  // a benign doc just under the cap still parses normally (no false "too large")
  const ok = checkDocument('# Title\n\nnormal content\n');
  assert.ok(!ok.some((x) => x.check === 'doc-too-large'));
});

// --- U13/F1 (CoalBoard audit): parser DoS via blockquote DEPTH, not size ---
// `checkDocument('>'.repeat(8000)+' hi\n')` — an 8,004-byte doc, 0.016x the
// 512 KB cap — threw RangeError pre-fix. RED-FIRST evidence lives in the
// dispatch record + this session's own bisect, not repeated as a live test
// here (re-throwing on purpose in a suite is its own hazard); these tests
// prove the FIXED behavior: the guard fires, degrades safely, and the CLI
// batch survives a crafted doc mixed with real ones.
test('U13/F1: doc-too-nested fires past the container-depth cap, and a benign doc under it is untouched', () => {
  const deep = checkDocument('>'.repeat(8000) + ' hi\n');
  assert.strictEqual(deep.length, 1);
  assert.strictEqual(deep[0].check, 'doc-too-nested');
  // boundary: exactly at the cap is still fine, one past it fires
  assert.ok(!checkDocument('>'.repeat(200) + ' hi\n').some((x) => x.check === 'doc-too-nested'));
  assert.strictEqual(checkDocument('>'.repeat(201) + ' hi\n')[0].check, 'doc-too-nested');
  // pure list INDENTATION (no marker-run) is NOT the vector this guard
  // covers — 200 leading spaces before one single `- item` marker never
  // matches the guard's own {0,3}-leading-space marker recognizer, so it
  // stays silent, correctly (indentation-only depth doesn't hit the
  // super-linear container-matching path this guard exists for)
  const list = '  '.repeat(200) + '- item\n';
  assert.ok(!checkDocument(list).some((x) => x.check === 'doc-too-nested'));
  // LOW-1 (findings-back): the cap's defensibility claim, as a permanent
  // regression — a real 12-level email-quote thread scans clean
  assert.ok(!checkDocument('> '.repeat(12) + 'text\n').some((x) => x.check === 'doc-too-nested'));
});

// --- U13/F1 findings-back (INSPECT-caught): the FIRST guard was anchored to
// a bare leading `>` run only, and was fence-blind. Both are real defects in
// the guard itself, not the parser it protects — H1 (too narrow, the exact
// vector it exists to close was still reachable) and M1 (too broad, cry-
// wolfs on legitimate fenced content and SWALLOWS every other finding in the
// same doc via the early return). RED-FIRST, reproduced against the guard's
// FIRST version before this fix (this session's own measurement, not
// repeated live here — re-triggering a 13s+ hang in a test suite is its own
// hazard): `checkDocument('- ' + '>'.repeat(3000) + ' hi\n')` -> `[]` in
// 278ms; the same shape at 20,000 markers (20,006 bytes, 0.04x MAX_DOC_BYTES)
// -> `[]` in 13,025ms. `checkDocument('```\n' + '>'.repeat(250) + '\n```\n')`
// -> `['doc-too-nested']` on a document that renders perfectly. Both GREEN
// below, against the corrected fence-aware, marker-general guard. ---
test('U13/F1 H1 (findings-back): a list-marker prefix no longer bypasses the container-depth guard', () => {
  const t0 = process.hrtime.bigint();
  const f = checkDocument('- ' + '>'.repeat(20000) + ' hi\n'); // the exact 20,000-marker shape measured at 13s pre-fix
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].check, 'doc-too-nested');
  assert.ok(ms < 200, `the pathological case must now be the FAST case (short-circuits at the cap), took ${ms.toFixed(0)}ms`);
});

test('U13/F1 M1 (findings-back): a `>`-heavy fenced code block does not cry-wolf, and a real finding elsewhere in the same doc survives', () => {
  const fenced = '```\n' + '>'.repeat(250) + '\n```\n';
  assert.ok(!checkDocument(fenced).some((x) => x.check === 'doc-too-nested'), 'literal code content, not container markers');
  // the early-return failure mode named in the finding: a false doc-too-
  // nested would have swallowed this file-missing finding too
  const mixed = '```\n' + '>'.repeat(250) + '\n```\n\n[dead link](./nope.md)\n';
  const findings = checkDocument(mixed, { filePath: path.join(FIX, 'probe.md') });
  assert.ok(!findings.some((x) => x.check === 'doc-too-nested'));
  assert.ok(findings.some((x) => x.check === 'file-missing'), 'the real finding after the fence must not be dropped');
});

test('U13/F1: the CLI batch survives a crafted doc between two real files — no lost findings, no empty stdout', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-f1-'));
  try {
    fs.writeFileSync(path.join(dir, 'good.md'), '[dead link](./nope.md)\n');
    fs.writeFileSync(path.join(dir, 'evil.md'), '>'.repeat(8000) + ' hi\n');
    fs.writeFileSync(path.join(dir, 'good2.md'), '[also dead](./nope2.md)\n');
    const r = spawnSync(process.execPath, [CLI, '--json', path.join(dir, 'good.md'), path.join(dir, 'evil.md'), path.join(dir, 'good2.md')], { encoding: 'utf8' });
    assert.notStrictEqual(r.stdout.trim(), '', 'stdout must not be empty — pre-fix this was 0 bytes');
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.length, 3, 'all three files present in the batch, none lost');
    assert.ok(out[0].findings.some((f) => f.check === 'file-missing'), "good.md's real finding survives");
    assert.ok(out[1].findings.some((f) => f.check === 'doc-too-nested'), 'evil.md degrades to a controlled finding, not a crash');
    assert.ok(out[2].findings.some((f) => f.check === 'file-missing'), "good2.md's real finding survives");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- H11 (CoalBoard nasa audit): processEmphasis / angle-dest / backtick were
// still O(N^2) after the beta.3 parseInlineDest fix — a benign-looking emphasis
// doc hung any scan through checkDocument. Guard the LINEAR behavior. ---
test('H11: a dense-emphasis doc (the processEmphasis O(N^2) vector) scans in bounded time', () => {
  // `a*b_c*d_` repeated: every `*`/`_` pair matched, the old code reset the
  // closer index to 0 and array-spliced per match -> O(N^2). Pre-fix wall times
  // measured through checkDocument: 47 KB ~= 2.5 s, 94 KB ~= 3.9 s, 188 KB ~= 26 s,
  // ~500 KB did not finish in 5 min. Linear now (~0.5 s at 188 KB). A 200 KB doc
  // that took ~30 s pre-fix must finish comfortably under a generous bound (slow
  // CI headroom; a reintroduced quadratic blows straight past it).
  const doc = 'a*b_c*d_'.repeat(25000); // ~200 KB, under MAX_DOC_BYTES
  const t0 = process.hrtime.bigint();
  const f = checkDocument(doc);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(!f.some((x) => x.check === 'doc-too-large'), 'the fixture is under the cap (real parse, not short-circuited)');
  assert.ok(ms < 6000, `dense-emphasis parse must be bounded, took ${ms.toFixed(0)}ms`);
});
// (The angle-dest bound and backtick memo are the other two H11 paths; the angle
// bound is guarded functionally in md-ast.test.mjs — a wall-clock guard there is
// theater: the 512 KB cap already held both under ~2 s even while quadratic, so a
// time bound can't tell the fix from the bug. The backtick memo is output-neutral,
// covered by the existing code-span test.)

// --- L2 (CoalBoard nasa audit): binary/corrupted input must not report a false clean bill ---
test('doc-unreadable: a NUL byte flags binary/corrupted input instead of a false "0 findings" clean bill', () => {
  const f = checkDocument('# Title\n\ntext\0more');
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].check, 'doc-unreadable');
  // benign text with no NUL byte still parses normally
  const ok = checkDocument('# Title\n\nnormal content\n');
  assert.ok(!ok.some((x) => x.check === 'doc-unreadable'));
});
