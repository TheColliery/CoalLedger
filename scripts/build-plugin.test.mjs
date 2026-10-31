import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDist, checkDist, DIST_ITEMS, missingDistSources } from './build-plugin.mjs';

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


// ---------------------------------------------------------------------------
// CWK-120 row 3 (CodeRabbit, `build-plugin.mjs:147`): `filesUnder` returns `[]`
// for a path that does not exist, so a DIST_ITEM whose SOURCE is absent
// contributes NOTHING in either direction -- delete `hooks/` from the source
// tree and from `plugin/`, and `checkDist` still reports IN SYNC. The gate's own
// contract ("every source file under DIST_ITEMS must exist in distRoot") is
// silently vacuous for a whole missing item. `missingDistSources` is the
// testable seam: it takes a root, so an absent source can be simulated without
// touching the real tree.
// ---------------------------------------------------------------------------
test('missingDistSources: names every DIST_ITEM whose SOURCE is absent (an empty tree reports all of them)', () => {
  const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clg-nosrc-')));
  try {
    assert.deepStrictEqual(missingDistSources(empty).sort(), [...DIST_ITEMS].sort());
  } finally { fs.rmSync(empty, { recursive: true, force: true }); }
});

test('missingDistSources: the real repo has every DIST_ITEM source present (the liveness control)', () => {
  assert.deepStrictEqual(missingDistSources(), []);
});

test('checkDist REPORTS a missing source DIST_ITEM instead of passing it silently', () => {
  const dist = scratchDist();
  const partial = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clg-partial-')));
  try {
    buildDist(dist);
    // A source root holding only SOME of the DIST_ITEMS: the gate must name the rest.
    fs.mkdirSync(path.join(partial, 'hooks'), { recursive: true });
    const out = checkDist(dist, partial);
    assert.ok(out.some((l) => /missing source DIST_ITEM/.test(l)),
      `checkDist must report the absent source items; got: ${JSON.stringify(out)}`);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
    fs.rmSync(partial, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 29d CWK2-079: the builder never copies, follows or writes through a link. Each witness runs on a scratch copy of the DIST_ITEM sources,
// so a planted link never touches the room. A leg whose link kind this volume cannot make skips visibly (probed, never decided by platform).
// ---------------------------------------------------------------------------
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function scratchSources(prefix) {
  const src = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  for (const rel of DIST_ITEMS) {
    fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true });
    fs.cpSync(path.join(repoRoot, rel), path.join(src, rel), { recursive: true });
  }
  return src;
}
// true when this volume can make the link kind; the probe runs inside the named scratch folder only.
function canLink(dir, kind) {
  try {
    const target = path.join(dir, `probe-target-${kind}`);
    if (kind === 'junction') fs.mkdirSync(target); else fs.writeFileSync(target, '');
    fs.symlinkSync(target, path.join(dir, `probe-link-${kind}`), kind);
    return true;
  } catch { return false; }
}
function allFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? allFiles(p) : [p];
  });
}
function anyFileHolds(dir, marker) {
  return allFiles(dir).some((f) => { try { return fs.readFileSync(f, 'utf8').includes(marker); } catch { return false; } });
}

test('buildDist refuses a folder link inside a source it copies, and names it', (t) => {
  const src = scratchSources('clg-src-dirlink-');
  const dist = scratchDist();
  const outside = scratchDist();
  t.after(() => { for (const d of [src, dist, outside]) fs.rmSync(d, { recursive: true, force: true }); });
  if (!canLink(src, 'junction')) { t.skip('this volume cannot make a junction (probe: junction failed)'); return; }
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'OUTSIDE-FOLDER-BYTES');
  fs.symlinkSync(outside, path.join(src, 'skills', 'linked-out'), 'junction');
  assert.throws(() => buildDist(dist, src), /link or junction/, 'a folder link in a source is refused, and the refusal names it');
  assert.equal(anyFileHolds(dist, 'OUTSIDE-FOLDER-BYTES'), false, 'the linked folder content reaches no dist file');
});

test('buildDist refuses a file link where a generated engine file is written, and never writes through it', (t) => {
  const src = scratchSources('clg-src-filelink-');
  const dist = scratchDist();
  const outside = scratchDist();
  t.after(() => { for (const d of [src, dist, outside]) fs.rmSync(d, { recursive: true, force: true }); });
  if (!canLink(src, 'file')) { t.skip('this volume refuses file symlinks without privilege (probe: symlink EPERM)'); return; }
  const target = path.join(outside, 'md-ast.mjs');
  fs.writeFileSync(target, 'OUTSIDE-ORIGINAL');
  const libDir = path.join(src, 'skills', 'doc-structure', 'lib');
  fs.mkdirSync(libDir, { recursive: true });
  fs.symlinkSync(target, path.join(libDir, 'md-ast.mjs'));
  assert.throws(() => buildDist(dist, src), /link or junction/, 'a file link at a generated path is refused, and the refusal names it');
  assert.equal(fs.readFileSync(target, 'utf8'), 'OUTSIDE-ORIGINAL', 'the file the link points at is untouched');
});

test('buildDist refuses a folder link where a generated engine folder is written, and never writes into the folder it points at', (t) => {
  const src = scratchSources('clg-src-parentlink-');
  const dist = scratchDist();
  const outside = scratchDist();
  t.after(() => { for (const d of [src, dist, outside]) fs.rmSync(d, { recursive: true, force: true }); });
  if (!canLink(src, 'junction')) { t.skip('this volume cannot make a junction (probe: junction failed)'); return; }
  const target = path.join(outside, 'md-ast.mjs');
  fs.writeFileSync(target, 'OUTSIDE-ORIGINAL');
  fs.mkdirSync(path.join(src, 'skills', 'doc-structure'), { recursive: true });
  fs.symlinkSync(outside, path.join(src, 'skills', 'doc-structure', 'lib'), 'junction');
  assert.throws(() => buildDist(dist, src), /link or junction/, 'a folder link on the generated path is refused, and the refusal names it');
  assert.equal(fs.readFileSync(target, 'utf8'), 'OUTSIDE-ORIGINAL', 'the generated engine was not written through the link');
});

test('buildDist refuses a link that points inside its own source tree', (t) => {
  const src = scratchSources('clg-src-insidelink-');
  const dist = scratchDist();
  t.after(() => { for (const d of [src, dist]) fs.rmSync(d, { recursive: true, force: true }); });
  if (!canLink(src, 'junction')) { t.skip('this volume cannot make a junction (probe: junction failed)'); return; }
  const sub = path.join(src, 'skills', 'doc-structure', 'sub');
  fs.mkdirSync(sub, { recursive: true });
  fs.symlinkSync(sub, path.join(src, 'skills', 'doc-structure', 'inner'), 'junction');
  assert.throws(() => buildDist(dist, src), /link or junction/, 'a link into the tree is refused, not copied as a second copy');
});

test('checkDist names a dangling link in a DIST_ITEM instead of passing it', (t) => {
  const src = scratchSources('clg-src-dangle-');
  const dist = scratchDist();
  t.after(() => { for (const d of [src, dist]) fs.rmSync(d, { recursive: true, force: true }); });
  if (!canLink(src, 'junction')) { t.skip('this volume cannot make a junction (probe: junction failed)'); return; }
  buildDist(dist, src);
  const gone = path.join(src, 'gone-target');
  fs.mkdirSync(gone);
  fs.symlinkSync(gone, path.join(src, 'skills', 'dangling-link'), 'junction');
  fs.rmSync(gone, { recursive: true, force: true });
  const out = checkDist(dist, src);
  assert.ok(out.some((l) => /symlink/.test(l) && l.includes('dangling-link')),
    `checkDist must name the dangling link; got: ${JSON.stringify(out)}`);
});

test('checkDist names a folder link that points at its own parent, and does not descend into it', (t) => {
  const src = scratchSources('clg-src-loop-');
  const dist = scratchDist();
  t.after(() => { for (const d of [src, dist]) fs.rmSync(d, { recursive: true, force: true }); });
  if (!canLink(src, 'junction')) { t.skip('this volume cannot make a junction (probe: junction failed)'); return; }
  buildDist(dist, src);
  const parent = path.join(src, 'skills', 'doc-structure');
  fs.symlinkSync(parent, path.join(parent, 'loop'), 'junction');
  const out = checkDist(dist, src);
  assert.ok(out.some((l) => /symlink/.test(l) && l.includes('loop')),
    `checkDist must name the looping link; got: ${JSON.stringify(out)}`);
});
