// Whole-process negative-path proof for scripts/verify.mjs (scripts-quality.md §2:
// "the verify gate must have at least one automated negative-path test"). No
// existing test file in this room spawns the real verify.mjs end-to-end — this
// one does, on a full scratch copy of the repo, so the check runs against the
// same entry point a human/CI would invoke, not an extracted internal function.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every top-level dir/file verify.mjs's checks touch (hooks/.github for the
// files+version-pin scan, scripts for the entry itself + libs + fixtures,
// plugin for the dist-parity check).
const COPY = ['hooks', 'platform-configs', 'skills', 'commands', '.claude-plugin', 'scripts', 'plugin', '.github'];
const COPY_FILES = ['LICENSE', 'NOTICE'];

function scratchRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clg-verify-')));
  for (const d of COPY) fs.cpSync(path.join(repo, d), path.join(dir, d), { recursive: true });
  for (const f of COPY_FILES) fs.cpSync(path.join(repo, f), path.join(dir, f));
  return dir;
}
function run(dir) {
  return spawnSync(process.execPath, [path.join(dir, 'scripts', 'verify.mjs')], { cwd: dir, encoding: 'utf8' });
}
function writePluginDescription(dir, value) {
  const p = path.join(dir, '.claude-plugin', 'plugin.json');
  const pj = JSON.parse(fs.readFileSync(p, 'utf8'));
  pj.description = value;
  fs.writeFileSync(p, JSON.stringify(pj, null, 2) + '\n', 'utf8');
}

test('verify.mjs negative path: an over-cap .claude-plugin/plugin.json description FAILs the gate (board #64)', () => {
  const dir = scratchRepo();
  try {
    const clean = run(dir);
    assert.strictEqual(clean.status, 0, `pristine copy must PASS, got:\n${clean.stdout}${clean.stderr}`);

    writePluginDescription(dir, 'x'.repeat(1025));
    const over = run(dir);
    assert.strictEqual(over.status, 1, 'a plugin.json description over 1024 chars must FAIL with exit 1');
    assert.match(over.stdout, /\.claude-plugin\/plugin\.json: description 1025 chars exceeds the 1024-char cap/,
      'the FAIL line names the file, the exact length, and the cap');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('verify.mjs negative path: a truthy NON-STRING plugin.json description fails loud, never silently reads as 0 chars', () => {
  const dir = scratchRepo();
  try {
    for (const bad of [123, {}, ['a']]) {
      writePluginDescription(dir, bad);
      const r = run(dir);
      assert.strictEqual(r.status, 1, `a ${typeof bad} description must FAIL, got:\n${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /\.claude-plugin\/plugin\.json: description is not a string \(got \w+\)/,
        `expected the non-string FAIL line for ${JSON.stringify(bad)}, got:\n${r.stdout}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('verify.mjs negative path: a missing plugin.json description FAILs, does not pass as empty', () => {
  const dir = scratchRepo();
  try {
    writePluginDescription(dir, '');
    const r = run(dir);
    assert.strictEqual(r.status, 1, 'an empty description must FAIL');
    assert.match(r.stdout, /\.claude-plugin\/plugin\.json: description missing/, r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// CWK-078 findings-back LOW-1: block 2.12 (the pointer gate) had ZERO automated
// coverage -- scratchRepo() above carries no `.git` and no root docs, so the block
// SKIPs there every time; both reds this unit's own INSPECT ran were by hand. This
// gives the block a real git repo, a gitignored top-level entry, and a planted
// citation into it.
const POINTER_ROOT_DOCS = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'PRIVACY.md', 'CHANGELOG.md', '.gitignore'];
function pointerScratchRepo() {
  const dir = scratchRepo();
  for (const f of POINTER_ROOT_DOCS) fs.cpSync(path.join(repo, f), path.join(dir, f));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

test('verify.mjs block 2.12: a citation into a NEW gitignored top-level entry FAILs the gate, with NO directory ever created on disk -- the CLEAN-CLONE proof (CWK-078 LOW-1, re-proven pattern-based at CWK-079)', () => {
  const dir = pointerScratchRepo();
  try {
    const clean = run(dir);
    assert.strictEqual(clean.status, 0, `pristine copy must PASS, got:\n${clean.stdout}${clean.stderr}`);
    assert.match(clean.stdout, /gitignored-root citations:/, 'block 2.12 must actually run here, not SKIP');

    // CWK-079: existence-independent by design -- the planted top-level dir (named in
    // the literal strings below, NOT backticked HERE since this comment is itself a
    // WALKED surface and a backticked mention would manufacture the exact citation it
    // describes) is cited and gitignored but NEVER CREATED on disk. A clean clone/CI
    // runner has exactly this property (a gitignored path that is real in the doc but
    // absent from the checkout); the OLD disk-derived ignoredRoots (CWK-078) could only
    // ever probe a name that physically existed, so this exact scenario read as a
    // silent PASS there. Not creating the directory here is the proof, not an oversight.
    fs.appendFileSync(path.join(dir, '.gitignore'), '\nscratch-out/\n');
    fs.appendFileSync(path.join(dir, 'README.md'), '\nSee `scratch-out/notes.md`.\n');
    assert.equal(fs.existsSync(path.join(dir, 'scratch-out')), false, 'the directory must stay ABSENT -- that absence is the whole point of this test');
    const red = run(dir);
    assert.strictEqual(red.status, 1, 'a citation into a NEW gitignored top-level dir must FAIL even though the dir never existed on disk');
    assert.match(red.stdout, /README\.md cites `scratch-out\/notes\.md`, which lives under the gitignored `scratch-out\/`/, red.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// CWK-079 F2: looksPathShaped's own comment (pointer-check.mjs) claims the non-local
// property is "PROVEN LIVE in verify.test.mjs with a two-plant pair" -- this is that
// proof. A shape-rejected token (extensionless, no trailing slash) planted ALONE under a
// gitignored root never enters candidateRoots, so ignoredRoots never learns that root
// exists, and the citation is silently unresolved (checkPointers still judges it, but
// against an ignoredRoots set that was never told the root is ignored -- it falls through
// to the ordinary resolve() path, which reports it MISSING, not gitignored). Planted a
// SECOND TIME beside a shape-qualified sibling under the SAME root, that same root DOES
// enter candidateRoots via the sibling, ignoredRoots picks it up, and BOTH citations
// FAIL -- proving the shape test gates DISCOVERY only, never judgement. (The two planted
// paths are named only in the literal strings below, never backticked in a comment --
// this comment is itself a WALKED surface.)
test('CWK-079 non-locality: a shape-rejected citation planted ALONE under a gitignored root stays silent; the SAME citation beside a shape-qualified sibling FAILs both', () => {
  const dir = pointerScratchRepo();
  try {
    fs.appendFileSync(path.join(dir, '.gitignore'), '\nscratch-lib/\n');
    // ALONE: the extensionless path below (no trailing slash) is shape-rejected --
    // looksPathShaped drops it, so this root never reaches the ignore-probe at all.
    fs.appendFileSync(path.join(dir, 'README.md'), '\nSee `scratch-lib/lib` for the internals.\n');
    const alone = run(dir);
    assert.strictEqual(alone.status, 0, `a lone shape-rejected citation under a gitignored root must stay SILENT (discovery-excluded), got:\n${alone.stdout}${alone.stderr}`);
    assert.doesNotMatch(alone.stdout, /scratch-lib/, 'no finding should name scratch-lib while it is the only citation under that root');

    // BESIDE A SIBLING: the `.md`-suffixed path below IS shape-qualified -- now the root
    // enters candidateRoots, ignoredRoots picks it up, and the FIRST (shape-rejected)
    // citation is checked too, non-locally.
    fs.appendFileSync(path.join(dir, 'README.md'), '\nAlso see `scratch-lib/notes.md`.\n');
    const both = run(dir);
    assert.strictEqual(both.status, 1, 'both citations under the now-discovered root must FAIL');
    assert.match(both.stdout, /README\.md cites `scratch-lib\/lib`, which lives under the gitignored `scratch-lib\/`/, both.stdout);
    assert.match(both.stdout, /README\.md cites `scratch-lib\/notes\.md`, which lives under the gitignored `scratch-lib\/`/, both.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
