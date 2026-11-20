// T-53: scripts/configure.mjs migrates a legacy project config in three steps: it reads the legacy file once,
// writes the new home, then deletes the legacy file. An edit made to the legacy file between the read and the
// delete was lost (in neither file). These legs spawn the REAL configure.mjs in a sandboxed project; a preload
// (node --import) makes the edit at the first fs.renameSync, which is the point inside writeRepoFile that falls
// after configure's read and before its delete.
// Leg A: the legacy file changes inside that window (append, or a same-size replace). It must be kept, the run
// must exit non-zero and name the legacy file as kept.
// Leg B: nothing changes. The legacy file is removed, the new file holds the setting, exit 0, the Migrated line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(repo, 'scripts', 'configure.mjs');
const TMP_PREFIX = 'configure-migrate-';
const LEGACY_BODY = '{ "language": "en" }\n';
const APPEND_BODY = '{ "language": "en", "userEditMarker": "made-inside-the-window" }\n';
const SAME_LEN_BODY = '{ "language": "fr" }\n'; // equal byte length to LEGACY_BODY, different bytes
const REAL_TMP = fs.realpathSync.native(os.tmpdir());

// One folder under the OS temp root, removed at teardown by name after checking it resolves under that root.
function sandbox(t) {
  const root = fs.mkdtempSync(path.join(REAL_TMP, TMP_PREFIX));
  t.after(() => {
    const real = fs.realpathSync.native(root);
    if (path.dirname(real) === REAL_TMP && path.basename(real).startsWith(TMP_PREFIX)) fs.rmSync(real, { recursive: true, force: true });
  });
  const proj = path.join(root, 'proj');
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const legacy = path.join(proj, '.coalledger.json');
  fs.writeFileSync(legacy, LEGACY_BODY);
  return { root, proj, home, legacy };
}

// The preload patches fs.renameSync: the first call (writeRepoFile's temp-to-final rename, after configure has read
// the legacy file) first changes the legacy file. `replace` removes it and writes a different file in its place.
function preloadFor(root, legacy, body, replace) {
  const file = path.join(root, `preload-${replace ? 'replace' : 'append'}-${body.length}.mjs`);
  fs.writeFileSync(file, [
    "import fs from 'node:fs';",
    `const legacy = ${JSON.stringify(legacy)};`,
    `const body = ${JSON.stringify(body)};`,
    `const replace = ${JSON.stringify(replace)};`,
    'const real = fs.renameSync;',
    'let done = false;',
    'fs.renameSync = function (a, b) {',
    '  if (!done) { done = true; if (replace) fs.unlinkSync(legacy); fs.writeFileSync(legacy, body); }',
    '  return real.call(fs, a, b);',
    '};',
    '',
  ].join('\n'));
  return file;
}

// Runs the real CLI in the sandboxed project. The child env drops every GIT_* and CLAUDE_* key, and HOME/USERPROFILE
// point at the sandbox home.
function runConfigure(sb, preload) {
  const env = { ...process.env, HOME: sb.home, USERPROFILE: sb.home, NODE_OPTIONS: '--max-old-space-size=2048' };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') || k.startsWith('CLAUDE_')) delete env[k];
  const args = [];
  if (preload) args.push('--import', pathToFileURL(preload).href);
  args.push(CLI, '--updateMode', 'off');
  return spawnSync(process.execPath, args, { cwd: sb.proj, env, encoding: 'utf8', timeout: 60000 });
}

// The new config is the one .json file the run wrote under the project's agent dir.
function newConfigFile(proj) {
  const found = fs.readdirSync(path.join(proj, '.claude'), { recursive: true }).map(String)
    .map((f) => path.join(proj, '.claude', f))
    .filter((p) => fs.statSync(p).isFile() && p.endsWith('.json'));
  return found.length === 1 ? found[0] : null;
}

test('T-53 leg A (append): an edit to the legacy file made inside the migration window is kept, the run exits non-zero and names the legacy file as kept', (t) => {
  const sb = sandbox(t);
  const r = runConfigure(sb, preloadFor(sb.root, sb.legacy, APPEND_BODY, false));
  assert.equal(r.error, undefined, `the child did not run: ${r.error && r.error.message}`);
  assert.ok(r.status !== 0, `configure exited ${r.status}; a kept legacy file is a partial failure, so it must exit non-zero`);
  assert.ok(fs.existsSync(sb.legacy), 'the legacy file was DELETED although it changed during the migration (T-53: the user edit is lost)');
  assert.equal(fs.readFileSync(sb.legacy, 'utf8'), APPEND_BODY, 'the legacy file no longer holds the edit made inside the window');
  assert.ok(newConfigFile(sb.proj), 'the new config file was not written');
  const out = `${r.stdout}\n${r.stderr}`;
  assert.ok(out.split(/\r?\n/).some((line) => line.includes('changed while migrating') && line.includes(path.basename(sb.legacy))), `no plain line names ${path.basename(sb.legacy)} as kept:\n${out}`);
});

test('T-53 leg A (same-size replace): a legacy file replaced by a different file of equal byte length is not deleted', (t) => {
  const sb = sandbox(t);
  const r = runConfigure(sb, preloadFor(sb.root, sb.legacy, SAME_LEN_BODY, true));
  assert.equal(r.error, undefined, `the child did not run: ${r.error && r.error.message}`);
  assert.ok(r.status !== 0, `configure exited ${r.status}; a kept legacy file is a partial failure, so it must exit non-zero`);
  assert.ok(fs.existsSync(sb.legacy), 'the replaced legacy file was DELETED (T-53: a same-size replace is not caught)');
  assert.equal(fs.readFileSync(sb.legacy, 'utf8'), SAME_LEN_BODY, 'the legacy file no longer holds the replacement content');
  assert.ok(newConfigFile(sb.proj), 'the new config file was not written');
});

test('T-53 leg B (unchanged): the legacy file is migrated and removed, the new file holds the setting, exit 0 and the Migrated line prints', (t) => {
  const sb = sandbox(t);
  const r = runConfigure(sb, null);
  assert.equal(r.error, undefined, `the child did not run: ${r.error && r.error.message}`);
  assert.equal(r.status, 0, `configure exited ${r.status}:\n${r.stdout}\n${r.stderr}`);
  assert.equal(fs.existsSync(sb.legacy), false, 'the legacy file was not removed after a clean migration');
  const written = newConfigFile(sb.proj);
  assert.ok(written, 'the new config file was not written');
  assert.equal(JSON.parse(fs.readFileSync(written, 'utf8')).updateMode, 'off', 'the new config does not hold updateMode off');
  assert.ok(r.stdout.includes('Migrated the project config from'), `the Migrated line did not print:\n${r.stdout}`);
});
