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
