import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.join(repo, 'dist-claude-ai');
const script = path.join(repo, 'scripts', 'build-claude-ai-zips.mjs');

test('build-claude-ai-zips: stages every plugin skill with a trimmed, valid description', () => {
  fs.rmSync(outDir, { recursive: true, force: true });
  try {
    const r = spawnSync(process.execPath, [script], { cwd: repo, encoding: 'utf8' });
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /^Done: \d+\/\d+ skill\(s\) staged/m, 'summary line present');
    assert.doesNotMatch(r.stdout, /FAIL/, 'no per-skill failures');

    assert.ok(fs.existsSync(outDir), 'dist-claude-ai/ was created');
    const staged = fs.readdirSync(outDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    const pluginSkillCount = fs.readdirSync(path.join(repo, 'plugin', 'skills'), { withFileTypes: true })
      .filter((e) => e.isDirectory()).length;
    assert.equal(staged.length, 7, 'CoalLedger ships 6+1 canaries, all seven must stage');
    assert.equal(staged.length, pluginSkillCount, 'one staged dir per plugin skill, none missing/extra');

    for (const s of staged) {
      const skillMd = path.join(outDir, s.name, 'SKILL.md');
      assert.ok(fs.existsSync(skillMd), `${s.name}/SKILL.md exists in the staged copy`);
      const text = fs.readFileSync(skillMd, 'utf8');
      const m = text.match(/^description:\s*"((?:[^"\\]|\\.)*)"/m);
      assert.ok(m, `${s.name}: description rewritten as a single-line quoted value`);
      const unescaped = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      assert.ok(unescaped.length <= 200, `${s.name}: staged description (${unescaped.length} chars) must be <= 200`);
      assert.ok(unescaped.length > 0, `${s.name}: staged description is non-empty`);
    }

    // The SOURCE files are never touched by this build — only the staged copy.
    const sourceSkillMd = path.join(repo, 'skills', 'doc-structure', 'SKILL.md');
    const sourceText = fs.readFileSync(sourceSkillMd, 'utf8');
    assert.ok(sourceText.includes('description: >-'), 'source SKILL.md frontmatter shape is untouched (block scalar, not rewritten to a quoted line)');
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('build-claude-ai-zips: fails loud when plugin/ has not been built', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cl-claude-ai-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scripts', 'lib'), { recursive: true });
    fs.cpSync(script, path.join(tmp, 'scripts', 'build-claude-ai-zips.mjs'));
    fs.cpSync(path.join(repo, 'scripts', 'lib', 'desc-cap.mjs'), path.join(tmp, 'scripts', 'lib', 'desc-cap.mjs'));
    fs.cpSync(path.join(repo, 'scripts', 'lib', 'claude-ai-trim.mjs'), path.join(tmp, 'scripts', 'lib', 'claude-ai-trim.mjs'));
    // No plugin/ dir at all under tmp.
    const r = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'build-claude-ai-zips.mjs')], { encoding: 'utf8' });
    assert.notEqual(r.status, 0, 'exits non-zero when plugin/skills is missing');
    assert.match(r.stderr, /does not exist/, 'names the missing dist as the reason');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CWK-120 row 2 (CodeRabbit, `build-claude-ai-zips.mjs:62`): the existing test
// above covers plugin/skills ABSENT. This is the other half -- the directory
// EXISTS and holds ZERO skill directories: `readdirSync(...).filter(isDirectory)`
// returns `[]`, the loop never runs, `failed` stays 0, and the script exits 0
// printing `Done: 0/0 skill(s) staged`. The claude-ai-zips workflow would then
// attach ZERO assets to a Release and report success -- a failure reported as a
// clean bill, the class this room has already fixed twice elsewhere.
// ---------------------------------------------------------------------------
test('build-claude-ai-zips: fails loud when plugin/skills exists but holds NO skill directories', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cl-claude-ai-empty-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scripts', 'lib'), { recursive: true });
    fs.cpSync(script, path.join(tmp, 'scripts', 'build-claude-ai-zips.mjs'));
    fs.cpSync(path.join(repo, 'scripts', 'lib', 'desc-cap.mjs'), path.join(tmp, 'scripts', 'lib', 'desc-cap.mjs'));
    fs.cpSync(path.join(repo, 'scripts', 'lib', 'claude-ai-trim.mjs'), path.join(tmp, 'scripts', 'lib', 'claude-ai-trim.mjs'));
    fs.mkdirSync(path.join(tmp, 'plugin', 'skills'), { recursive: true }); // present, but EMPTY
    const r = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'build-claude-ai-zips.mjs')], { encoding: 'utf8' });
    assert.notEqual(r.status, 0, `exits non-zero when there is nothing to stage; stdout: ${r.stdout}`);
    // CWK2-032 (CodeRabbit, PR #20): a non-zero exit alone also passes on a crash (a module-load error in the scratch copy), so the guard's OWN message is asserted.
    assert.match(r.stderr, /holds no skill directories/, 'names the empty dist as the reason, so a crash cannot pass for the guard');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 29d CWK2-085: the staging copy refuses what it cannot package, and never reads through a link. Each witness runs the real script in a scratch repo.
// Capability legs are probed, never decided by platform: a leg whose link kind this volume cannot make skips visibly with the probe's reason.
// ---------------------------------------------------------------------------
function scratchRepo(prefix) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix)));
  fs.mkdirSync(path.join(tmp, 'scripts', 'lib'), { recursive: true });
  fs.cpSync(script, path.join(tmp, 'scripts', 'build-claude-ai-zips.mjs'));
  fs.cpSync(path.join(repo, 'scripts', 'lib', 'desc-cap.mjs'), path.join(tmp, 'scripts', 'lib', 'desc-cap.mjs'));
  fs.cpSync(path.join(repo, 'scripts', 'lib', 'claude-ai-trim.mjs'), path.join(tmp, 'scripts', 'lib', 'claude-ai-trim.mjs'));
  return tmp;
}
function witnessSkill(tmp, name) {
  const dir = path.join(tmp, 'plugin', 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: A plain description for the witness.\n---\n\nBody.\n`);
  return dir;
}
function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? filesUnder(p) : [p];
  });
}
// true when this volume can make the named link kind and a name with a control character; the probe runs in the scratch folder only.
function canMake(tmp, kind) {
  const target = path.join(tmp, 'probe-target');
  try {
    if (kind === 'control') { fs.writeFileSync(path.join(tmp, 'a\u0001b.md'), ''); return true; }
    if (kind === 'dir') fs.mkdirSync(target);
    else fs.writeFileSync(target, '');
    fs.symlinkSync(target, path.join(tmp, 'probe-link'), kind === 'junction' ? 'junction' : (kind === 'dir' ? 'dir' : 'file'));
    return true;
  } catch { return false; }
}

test('build-claude-ai-zips: refuses a file link inside a skill and never stages the bytes it points at', (t) => {
  const tmp = scratchRepo('cl-claude-ai-filelink-');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  if (!canMake(tmp, 'file')) { t.skip('this volume refuses file symlinks without privilege (probe: symlink EPERM)'); return; }
  const secret = path.join(tmp, 'outside', 'secret.txt');
  fs.mkdirSync(path.dirname(secret), { recursive: true });
  fs.writeFileSync(secret, 'WITNESS-SECRET-BYTES');
  fs.symlinkSync(secret, path.join(witnessSkill(tmp, 'demo'), 'leak.txt'));
  const r = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'build-claude-ai-zips.mjs')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, `a file link must be refused; exit ${r.status}; stdout: ${r.stdout}`);
  assert.match(r.stderr, /neither a regular file nor a folder/, 'names the refusal, so a crash cannot pass for it');
  const staged = filesUnder(path.join(tmp, 'dist-claude-ai'));
  assert.equal(staged.some((f) => fs.readFileSync(f, 'utf8').includes('WITNESS-SECRET-BYTES')), false, 'the link target bytes appear in no staged file');
});

test('build-claude-ai-zips: refuses a folder link inside a skill and never stages the folder it points at', (t) => {
  const tmp = scratchRepo('cl-claude-ai-dirlink-');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  if (!canMake(tmp, 'junction')) { t.skip('this volume cannot make a junction (probe: junction failed)'); return; }
  const outside = path.join(tmp, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'WITNESS-FOLDER-BYTES');
  fs.symlinkSync(outside, path.join(witnessSkill(tmp, 'demo'), 'linked'), 'junction');
  const r = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'build-claude-ai-zips.mjs')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, `a folder link must be refused; exit ${r.status}; stdout: ${r.stdout}`);
  assert.match(r.stderr, /neither a regular file nor a folder/, 'names the refusal, so a crash cannot pass for it');
  const staged = filesUnder(path.join(tmp, 'dist-claude-ai'));
  assert.equal(staged.some((f) => fs.readFileSync(f, 'utf8').includes('WITNESS-FOLDER-BYTES')), false, 'the linked folder content appears in no staged file');
});

test('build-claude-ai-zips: stages no dotfile or dot-folder, at any depth', (t) => {
  const tmp = scratchRepo('cl-claude-ai-dot-');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const dir = witnessSkill(tmp, 'demo');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sub', '.DS_Store'), 'x');
  fs.writeFileSync(path.join(dir, '.hidden'), 'x');
  const r = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'build-claude-ai-zips.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, `the build succeeds; stderr: ${r.stderr}`);
  const names = filesUnder(path.join(tmp, 'dist-claude-ai')).map((f) => path.basename(f));
  assert.ok(names.includes('SKILL.md'), 'the skill itself is staged');
  assert.equal(names.includes('.DS_Store'), false, 'a nested .DS_Store is not staged');
  assert.equal(names.includes('.hidden'), false, 'a top-level dotfile is not staged');
});

test('build-claude-ai-zips: refuses a file name holding a control character', (t) => {
  const tmp = scratchRepo('cl-claude-ai-control-');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  if (!canMake(tmp, 'control')) { t.skip('this volume refuses control characters in file names (probe: create failed)'); return; }
  const dir = witnessSkill(tmp, 'demo');
  fs.writeFileSync(path.join(dir, 'bad\u0001name.md'), 'x');
  const r = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'build-claude-ai-zips.mjs')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, `a control character in a name must be refused; exit ${r.status}; stdout: ${r.stdout}`);
  assert.match(r.stderr, /control character/, 'names the refusal, so a crash cannot pass for it');
});
