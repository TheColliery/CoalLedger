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

test('gitEnv: non-GIT_ keys pass through unchanged (a plain copy, not a wipe)', () => {
  const env = gitEnv('/x');
  assert.equal(env.PATH, process.env.PATH);
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
test('THE HAZARD (unguarded): an ambient GIT_DIR pointing at a victim repo makes a fixture `git init` re-touch the victim, not the fixture', (t) => {
  const bare = spawnSync('git', ['--version'], { encoding: 'utf8', env: gitEnv(os.tmpdir()) });
  if (bare.status !== 0) { t.skip('git is not on PATH in this environment'); return; }

  const victim = scratch('cl-git-env-victim-');
  const fixture = scratch('cl-git-env-fixture-');
  const victimGitDir = path.join(victim, '.git');
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: victim, env: gitEnv(path.dirname(victim)) }).status, 0,
      'the victim must be a real repo before the hazard can corrupt it');
    const before = fs.readFileSync(path.join(victimGitDir, 'config'), 'utf8');
    assert.doesNotMatch(before, /bare\s*=\s*true/, 'the victim repo must start non-bare');

    // UNGUARDED: the ambient env (what a linked worktree's hook would export) carries an
    // absolute GIT_DIR pointing at the victim. No gitEnv() wraps this spawn.
    const poisoned = { ...process.env, GIT_DIR: victimGitDir };
    spawnSync('git', ['init', '-q'], { cwd: fixture, env: poisoned });

    assert.equal(fs.existsSync(path.join(fixture, '.git')), false,
      'the fixture dir must get NO .git of its own -- the hazard redirected the init elsewhere');
    const after = fs.readFileSync(path.join(victimGitDir, 'config'), 'utf8');
    assert.match(after, /bare\s*=\s*true/,
      'the UNGUARDED spawn must flip the victim repo bare -- this reproduces the real incident, it does not merely assert a hypothesis');
  } finally {
    fs.rmSync(victim, { recursive: true, force: true });
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('THE CURE: the identical poisoned GIT_DIR, with the fixture spawn wrapped in gitEnv(), leaves the victim repo config byte-unchanged', (t) => {
  const bare = spawnSync('git', ['--version'], { encoding: 'utf8', env: gitEnv(os.tmpdir()) });
  if (bare.status !== 0) { t.skip('git is not on PATH in this environment'); return; }

  const victim = scratch('cl-git-env-victim2-');
  const fixture = scratch('cl-git-env-fixture2-');
  const victimGitDir = path.join(victim, '.git');
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: victim, env: gitEnv(path.dirname(victim)) }).status, 0);
    const before = fs.readFileSync(path.join(victimGitDir, 'config'), 'utf8');
    assert.doesNotMatch(before, /bare\s*=\s*true/);

    // Same poisoning, read through process.env this time (what gitEnv() actually strips),
    // then the GUARDED spawn: cwd + env: gitEnv(path.dirname(fixture)).
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = victimGitDir;
    try {
      const r = spawnSync('git', ['init', '-q'], { cwd: fixture, env: gitEnv(path.dirname(fixture)) });
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
