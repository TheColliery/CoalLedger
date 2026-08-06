import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDist, checkDist, DIST_ITEMS } from './build-plugin.mjs';

function scratchDist() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clg-dist-')));
}

test('buildDist produces a clean, in-sync dist: manifest + commands + hooks + skills + engine; tests and fixtures never ship', () => {
  const dist = scratchDist();
  try {
    buildDist(dist);
    assert.deepStrictEqual(checkDist(dist), [], 'freshly built dist is in sync');
    assert.ok(fs.existsSync(path.join(dist, '.claude-plugin', 'plugin.json')));
    assert.ok(fs.existsSync(path.join(dist, 'commands', 'stats.md')));
    assert.ok(fs.existsSync(path.join(dist, 'commands', 'update.md')));
    assert.ok(fs.existsSync(path.join(dist, 'hooks', 'coalledger-conductor.js')));
    assert.ok(fs.existsSync(path.join(dist, 'hooks', 'hooks.json')));
    for (const s of ['doc-structure', 'doc-grounding', 'doc-standard', 'doc-rot', 'doc-consistency', 'doc-quality', 'doc-leak']) {
      assert.ok(fs.existsSync(path.join(dist, 'skills', s, 'SKILL.md')), `${s} ships`);
    }
    assert.ok(fs.existsSync(path.join(dist, 'scripts', 'lib', 'md-ast.mjs')));
    assert.ok(fs.existsSync(path.join(dist, 'scripts', 'lib', 'md-checks.mjs')));
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const all = walk(dist);
    assert.strictEqual(all.some((f) => /\.test\.[cm]?js$/.test(f)), false, 'no test files ship');
    assert.strictEqual(all.some((f) => f.includes('fixtures')), false, 'no fixtures ship');
    assert.ok(DIST_ITEMS.length >= 4, 'dist item set stays explicit');
  } finally { fs.rmSync(dist, { recursive: true, force: true }); }
});

test('checkDist fails loud in both directions: stale file and orphan', () => {
  const dist = scratchDist();
  try {
    buildDist(dist);
    fs.appendFileSync(path.join(dist, 'hooks', 'hooks.json'), '\n// tampered');
    let drift = checkDist(dist);
    assert.ok(drift.some((d) => d.includes('stale in plugin/')), drift.join('; '));
    buildDist(dist);
    fs.writeFileSync(path.join(dist, 'hooks', 'orphan.js'), '// no source');
    drift = checkDist(dist);
    assert.ok(drift.some((d) => d.includes('orphan in plugin/')), drift.join('; '));
    fs.mkdirSync(path.join(dist, 'unexpected-top'), { recursive: true });
    drift = checkDist(dist);
    assert.ok(drift.some((d) => d.includes('orphan top-level')), drift.join('; '));
  } finally { fs.rmSync(dist, { recursive: true, force: true }); }
});

test('checkDist is EOL-agnostic on TEXT_EXTS: a CRLF-only dist copy reads as in sync (board #47)', () => {
  const dist = scratchDist();
  try {
    buildDist(dist);
    const target = path.join(dist, 'commands', 'stats.md');
    const lf = fs.readFileSync(target, 'utf8');
    assert.ok(lf.includes('\n'), 'fixture must have multiple lines for a meaningful CRLF test');
    fs.writeFileSync(target, lf.replace(/\n/g, '\r\n'));
    const drift = checkDist(dist);
    assert.ok(!drift.some((d) => d.includes('commands/stats.md') || d.includes('commands\\stats.md')), drift.join('; '));
  } finally { fs.rmSync(dist, { recursive: true, force: true }); }
});

test('checkDist negative control: a LONE bare \\r (not followed by \\n) still causes a mismatch, never blanket-stripped', () => {
  // Discriminating construction: INSERT a lone \r (never replace/delete a
  // char) so that a WRONG blanket \r-strip would remove exactly that byte and
  // reconstruct the untouched repo text -- a false MATCH. Only a strip scoped
  // to \r\n PAIRS correctly leaves this lone \r in place and still sees a
  // mismatch. A same-length replace (space -> \r) cannot discriminate the two
  // algorithms: either strip strategy shortens the tampered side relative to
  // the untouched original, so both would "pass" for the wrong reason.
  const dist = scratchDist();
  try {
    buildDist(dist);
    const target = path.join(dist, 'commands', 'stats.md');
    const orig = fs.readFileSync(target, 'utf8');
    assert.ok(orig.length > 1 && orig[1] !== '\n', 'fixture shape must allow inserting a \\r not followed by \\n');
    const withLoneCr = orig.slice(0, 1) + '\r' + orig.slice(1); // insert, never replace
    fs.writeFileSync(target, withLoneCr);
    const drift = checkDist(dist);
    assert.ok(drift.some((d) => d.includes('stale in plugin/') && (d.includes('commands/stats.md') || d.includes('commands\\stats.md'))), drift.join('; '));
  } finally { fs.rmSync(dist, { recursive: true, force: true }); }
});

test('checkDist negative control: a REAL content edit under CRLF still fails loud, not just line endings', () => {
  const dist = scratchDist();
  try {
    buildDist(dist);
    const target = path.join(dist, 'commands', 'stats.md');
    const lf = fs.readFileSync(target, 'utf8');
    const tampered = lf.replace(/\n/g, '\r\n').replace(/---/, 'XXX');
    assert.notStrictEqual(tampered, lf.replace(/\n/g, '\r\n'), 'the edit must actually change a character, not just line endings');
    fs.writeFileSync(target, tampered);
    const drift = checkDist(dist);
    assert.ok(drift.some((d) => d.includes('stale in plugin/') && (d.includes('commands/stats.md') || d.includes('commands\\stats.md'))), drift.join('; '));
  } finally { fs.rmSync(dist, { recursive: true, force: true }); }
});
