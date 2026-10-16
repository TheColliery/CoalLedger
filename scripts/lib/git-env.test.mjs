import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitEnv } from './git-env.mjs';

function scratch(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

test('gitEnv: strips every GIT_-prefixed key, whatever the name', () => {
  const saved = { ...process.env };
  process.env.GIT_DIR = '/somewhere/.git';
  process.env.GIT_INDEX_FILE = '/somewhere/.git/index';
  process.env.GIT_WORK_TREE = '/somewhere';
  process.env.GIT_SOME_FUTURE_KEY_NOBODY_HAS_WRITTEN_YET = 'x';
  try {
    const env = gitEnv('/some/ceiling');
    for (const key of Object.keys(env)) {
      assert.ok(!key.startsWith('GIT_') || key === 'GIT_CEILING_DIRECTORIES',
        `${key} is a GIT_* key that survived the strip`);
    }
  } finally {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GIT_') && !(key in saved)) delete process.env[key];
    }
  }
});

test('gitEnv: sets GIT_CEILING_DIRECTORIES to the given ceiling, and only that one GIT_ key', () => {
  const env = gitEnv('/tmp/some-parent');
  assert.equal(env.GIT_CEILING_DIRECTORIES, '/tmp/some-parent');
  const gitKeys = Object.keys(env).filter((k) => k.startsWith('GIT_'));
  assert.deepEqual(gitKeys, ['GIT_CEILING_DIRECTORIES']);
});

// R12 bounce 3 (CI, windows node 22 only): PATH is the WRONG probe for this property --
// node/runtime.md §4's own doctrine ("never key case-folding on process.platform; probe
// the capability") applies one level up here: a Windows runner's PATH env var is enumerated
// under whatever literal casing that host's OS/shell session happened to set (`PATH` on
// this box, `Path` on at least one CI windows-node-22 runner, measured by the failure
// itself), and `{ ...process.env }` carries forward the ACTUAL enumerated casing, not
// Node's case-insensitive accessor behaviour. The property under test (gitEnv passes
// non-GIT_ keys through byte-for-byte) is real; PATH was simply the wrong, host-dependent
// key to probe it with. A self-controlled key removes the host variable entirely.
test('gitEnv: non-GIT_ keys pass through unchanged (a plain copy, not a wipe)', () => {
  const saved = process.env.CL_GITENV_PROBE;
  process.env.CL_GITENV_PROBE = 'probe-value';
  try {
    const env = gitEnv('/x');
    assert.equal(env.CL_GITENV_PROBE, 'probe-value');
  } finally {
    if (saved === undefined) delete process.env.CL_GITENV_PROBE; else process.env.CL_GITENV_PROBE = saved;
  }
});

test('gitEnv: never mutates the real process.env (the caller passes a copy to the child)', () => {
  const before = process.env.GIT_DIR;
  const env = gitEnv('/x');
  env.GIT_DIR = '/poisoned';
  assert.equal(process.env.GIT_DIR, before);
});

// THE HAZARD, reproduced, and the cure proven against it on THIS tree (build order
// item 2, red-first): plant an absolute GIT_DIR at a sandbox "victim" repo -- the shape
// a linked worktree's own hook exports -- and show (a) an UNGUARDED fixture git spawn
// corrupts the victim, then (b) the SAME spawn wrapped in gitEnv() leaves it untouched.
//
// R12 bounce 3 (CI, ubuntu + macos node 22/24): split in its own named step (testing.md's
// own rule -- a test proven wrong is changed and the commit states why). The ORIGINAL
// single test asserted TWO properties and only one is universal: "the fixture gets NO
// .git of its own" held everywhere (the real redirect -- GIT_DIR, once set, is where any
// unguarded `git init` actually targets, on every platform); "the victim's `bare` flag
// flips to true" is a PROPERTY OF GIT'S OWN auto-bare heuristic, which this unit measured
// as git-VERSION/platform-dependent, not a Windows-vs-POSIX split (node/runtime.md §4's
// own doctrine -- probe the capability, never the platform): reproduced live on THIS box
// (git 2.55.0.windows.5: bare flips true, measured just now) but NOT on CI's ubuntu/macos
// runners (CI run 36913904354: bare stays false). Per the order ("a hazard test that
// cannot reproduce must skip VISIBLY with its reason ... never assert"), the bare-flip
// half is now its OWN test, gated on a probe against throwaway scratch dirs -- never
// process.platform -- so it skips visibly wherever this host's git does not exhibit the
// heuristic, and still runs (and still proves the real incident) wherever it does.
test('THE HAZARD (unguarded), fixture half: an ambient GIT_DIR pointing at a victim repo makes a fixture `git init` create NO .git of its own', (t) => {
  const bare = spawnSync('git', ['--version'], { encoding: 'utf8', env: gitEnv(os.tmpdir()), timeout: 30_000 });
  if (bare.status !== 0) { t.skip('git is not on PATH in this environment'); return; }

  const victim = scratch('cl-git-env-victim-');
  const fixture = scratch('cl-git-env-fixture-');
  const victimGitDir = path.join(victim, '.git');
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: victim, env: gitEnv(path.dirname(victim)), timeout: 30_000 }).status, 0,
      'the victim must be a real repo before the hazard can corrupt it');

    // UNGUARDED: the ambient env (what a linked worktree's hook would export) carries an
    // absolute GIT_DIR pointing at the victim. No gitEnv() wraps this spawn.
    const poisoned = { ...process.env, GIT_DIR: victimGitDir };
    spawnSync('git', ['init', '-q'], { cwd: fixture, env: poisoned, timeout: 30_000 });

    assert.equal(fs.existsSync(path.join(fixture, '.git')), false,
      'the fixture dir must get NO .git of its own -- the hazard redirected the init elsewhere, universal across git versions/platforms');
  } finally {
    fs.rmSync(victim, { recursive: true, force: true });
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

// Probed once: does THIS git/platform's init-bare heuristic flip `bare = true` when
// GIT_DIR points at an ambient, already-non-bare repo whose basename IS '.git'? Measured
// 2026-10-02: Windows git 2.55.0.windows.5 does; CI's ubuntu/macos runners' git does not.
// Probed empirically against throwaway scratch dirs, exactly like the HAZARD test itself
// -- never inferred from process.platform or a git --version string.
function canFlipBareViaAmbientGitDir() {
  const victim = scratch('cl-bareprobe-victim-');
  const fixture = scratch('cl-bareprobe-fixture-');
  try {
    if (spawnSync('git', ['init', '-q'], { cwd: victim, env: gitEnv(path.dirname(victim)), timeout: 30_000 }).status !== 0) return false;
    const poisoned = { ...process.env, GIT_DIR: path.join(victim, '.git') };
    spawnSync('git', ['init', '-q'], { cwd: fixture, env: poisoned, timeout: 30_000 });
    const cfg = fs.readFileSync(path.join(victim, '.git', 'config'), 'utf8');
    return /bare\s*=\s*true/.test(cfg);
  } catch { return false; }
  finally {
    fs.rmSync(victim, { recursive: true, force: true });
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}
const CAN_FLIP_BARE = canFlipBareViaAmbientGitDir();

test('THE HAZARD (unguarded), victim half: the UNGUARDED spawn flips the victim repo bare (probed: this git/platform exhibits the auto-bare heuristic)', (t) => {
  if (!CAN_FLIP_BARE) { t.skip("this git version/platform's init-bare heuristic does not flip bare on an ambient GIT_DIR whose basename is '.git' -- probed empirically against throwaway dirs, not assumed from process.platform"); return; }

  const victim = scratch('cl-git-env-victim3-');
  const fixture = scratch('cl-git-env-fixture3-');
  const victimGitDir = path.join(victim, '.git');
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: victim, env: gitEnv(path.dirname(victim)), timeout: 30_000 }).status, 0,
      'the victim must be a real repo before the hazard can corrupt it');
    const before = fs.readFileSync(path.join(victimGitDir, 'config'), 'utf8');
    assert.doesNotMatch(before, /bare\s*=\s*true/, 'the victim repo must start non-bare');

    const poisoned = { ...process.env, GIT_DIR: victimGitDir };
    spawnSync('git', ['init', '-q'], { cwd: fixture, env: poisoned, timeout: 30_000 });

    const after = fs.readFileSync(path.join(victimGitDir, 'config'), 'utf8');
    assert.match(after, /bare\s*=\s*true/,
      'the UNGUARDED spawn must flip the victim repo bare -- this reproduces the real incident, it does not merely assert a hypothesis');
  } finally {
    fs.rmSync(victim, { recursive: true, force: true });
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('THE CURE: the identical poisoned GIT_DIR, with the fixture spawn wrapped in gitEnv(), leaves the victim repo config byte-unchanged', (t) => {
  const bare = spawnSync('git', ['--version'], { encoding: 'utf8', env: gitEnv(os.tmpdir()), timeout: 30_000 });
  if (bare.status !== 0) { t.skip('git is not on PATH in this environment'); return; }

  const victim = scratch('cl-git-env-victim2-');
  const fixture = scratch('cl-git-env-fixture2-');
  const victimGitDir = path.join(victim, '.git');
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: victim, env: gitEnv(path.dirname(victim)), timeout: 30_000 }).status, 0);
    const before = fs.readFileSync(path.join(victimGitDir, 'config'), 'utf8');
    assert.doesNotMatch(before, /bare\s*=\s*true/);

    // Same poisoning, read through process.env this time (what gitEnv() actually strips),
    // then the GUARDED spawn: cwd + env: gitEnv(path.dirname(fixture)).
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = victimGitDir;
    try {
      const r = spawnSync('git', ['init', '-q'], { cwd: fixture, env: gitEnv(path.dirname(fixture)), timeout: 30_000 });
      assert.equal(r.status, 0, `guarded init must succeed in the fixture, got: ${r.stderr}`);
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = saved;
    }

    assert.equal(fs.existsSync(path.join(fixture, '.git')), true,
      'the GUARDED spawn must create the fixture\'s OWN .git -- the stripped env no longer redirects it');
    const after = fs.readFileSync(path.join(victimGitDir, 'config'), 'utf8');
    assert.equal(after, before, 'the victim repo\'s config must be BYTE-IDENTICAL -- gitEnv() closes the hazard the unguarded test above reproduced');
  } finally {
    fs.rmSync(victim, { recursive: true, force: true });
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

// ---- 16f unit B (CWK2-043): the GIT_* strip is CASE-INSENSITIVE ----
// `key.startsWith('GIT_')` missed `git_dir`, which Windows treats as the SAME variable as GIT_DIR (environment names there are case-insensitive, and the copy of
// process.env keeps the spelling it was set with). A lower-case or mixed-case ambient GIT_* therefore reached every git child that took its env from gitEnv().
// The fix is one line: `/^GIT_/i.test(key)`, the very shape the sibling CoalFace git-test-env.mjs line 29 already carries.
function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined; process.env[k] = vars[k]; }
  try { return fn(); } finally { for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
const gitLike = (env) => Object.keys(env).filter((k) => /^git_/i.test(k) && k !== 'GIT_CEILING_DIRECTORIES');
for (const name of ['git_dir', 'Git_Dir', 'git_index_file', 'GIT_dir']) {
  test(`gitEnv 16f B: an ambient ${name} is stripped from the env a git child gets`, () => {
    withEnv({ [name]: path.join(os.tmpdir(), 'poisoned-git-dir') }, () => {
      assert.deepStrictEqual(gitLike(gitEnv(os.tmpdir())), [], `${name} survived the strip`);
    });
  });
}
test('gitEnv 16f B: the poisoned lower-case name reaches a REAL child process on the old strip (the witness), and does not now', () => {
  withEnv({ git_dir: path.join(os.tmpdir(), 'poisoned-git-dir') }, () => {
    const r = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(Object.keys(process.env).filter((k) => /^git_/i.test(k) && k !== "GIT_CEILING_DIRECTORIES")))'],
      { env: gitEnv(os.tmpdir()), encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout), [], 'a lower-case git_dir must not reach the child');
  });
});
test('gitEnv 16f B: the ceiling is still set and ordinary variables survive (the strip is the GIT_ family only)', () => {
  withEnv({ coalledger_keep_me: 'yes' }, () => {
    const env = gitEnv(os.tmpdir());
    assert.strictEqual(env.GIT_CEILING_DIRECTORIES, os.tmpdir());
    assert.strictEqual(env.coalledger_keep_me, 'yes');
  });
});
