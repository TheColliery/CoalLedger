// BB-533 (29mh item C): scripts/configure.mjs migrates a legacy project config by ONE rename of the legacy file to
// `<legacy>.bak`, beside it, after the new home is written. No rm, no unlink, no copy-then-delete anywhere in the
// migration. The backup is read back and compared with the bytes the migration read (the seed snapshot); a difference
// warns and exits 1. These legs spawn the REAL configure.mjs in a sandboxed project; a preload (node --import) makes
// the event each leg tests at the point the migration reaches the legacy file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gitEnv } from './git-env.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(repo, 'scripts', 'configure.mjs');
const TMP_PREFIX = 'configure-migrate-';
const LEGACY_BODY = '{ "language": "en" }\n';
const APPEND_BODY = '{ "language": "en", "userEditMarker": "made-inside-the-window" }\n';
const SAME_LEN_BODY = '{ "language": "fr" }\n'; // equal byte length to LEGACY_BODY, different bytes
const EARLIER_BACKUP = '{ "language": "de" }\n';
const WRITER_MARK = '\n"written-after-the-move": true\n';
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
  const bak = `${legacy}.bak`;
  fs.writeFileSync(legacy, LEGACY_BODY);
  return { root, proj, home, legacy, bak };
}

// The preload file: a small module the child loads with --import. `body` is the JS that runs before configure.mjs.
// `same(p)` is true when a path names the legacy file (resolved, so a spelling difference cannot hide it).
function preloadFile(root, name, legacy, body) {
  const file = path.join(root, `preload-${name}.mjs`);
  fs.writeFileSync(file, [
    "import fs from 'node:fs';",
    'import path from \'node:path\';',
    `const legacy = ${JSON.stringify(legacy)};`,
    'const same = (p) => typeof p === \'string\' && path.resolve(p) === legacy;',
    'const realRename = fs.renameSync;',
    'const realRm = fs.rmSync;',
    'let done = false;',
    body,
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

function lines(r) {
  return `${r.stdout}\n${r.stderr}`.split(/\r?\n/);
}

// W-c1 (the study's antibody, 29lg): an edit lands in the window between the migration's last look at the legacy file
// and its removal or move. The edit must survive in the backup, and the compare must warn. On the old two-step form the
// removal took the edit with the file, exit 0.
test('W-c1: bytes appended to the legacy file inside the migration window are kept in the backup and the run warns (exit 1)', (t) => {
  const sb = sandbox(t);
  const pre = preloadFile(sb.root, 'window', sb.legacy, `
const WRITER_MARK = ${JSON.stringify(WRITER_MARK)};
fs.renameSync = function (a, b) { if (!done && same(a)) { done = true; fs.appendFileSync(legacy, WRITER_MARK); } return realRename.call(fs, a, b); };
fs.rmSync = function (p, o) { if (!done && same(p)) { done = true; fs.appendFileSync(legacy, WRITER_MARK); } return realRm.call(fs, p, o); };
`);
  const r = runConfigure(sb, pre);
  assert.equal(r.error, undefined, `the child did not run: ${r.error && r.error.message}`);
  assert.ok(fs.existsSync(sb.bak), 'no backup was written: the edit made inside the window was DELETED with the legacy file (W-c1)');
  assert.ok(fs.readFileSync(sb.bak, 'utf8').includes('written-after-the-move'), 'the backup does not hold the edit made inside the window');
  assert.ok(r.status !== 0, `configure exited ${r.status}; a backup that differs from the migrated bytes is a partial failure`);
  assert.ok(lines(r).some((l) => l.includes('changed while migrating') && l.includes(path.basename(sb.bak))), `no plain line names ${path.basename(sb.bak)} as the place the change went:\n${lines(r).join('\n')}`);
});

// W-b1 (29lg study): a writer holds the file open across the rename and writes after it. The bytes land in the backup,
// the compare with the migrated bytes differs, and the run warns naming both files (the backup, and the new config).
test('W-b1: a writer that lands after the move lands in the backup, and the run warns naming the backup and the new config', (t) => {
  const sb = sandbox(t);
  const pre = preloadFile(sb.root, 'writer', sb.legacy, `
const WRITER_MARK = ${JSON.stringify(WRITER_MARK)};
fs.renameSync = function (a, b) {
  const r = realRename.call(fs, a, b);
  if (!done && same(a)) { done = true; fs.appendFileSync(b, WRITER_MARK); }
  return r;
};
`);
  const r = runConfigure(sb, pre);
  assert.equal(r.error, undefined, `the child did not run: ${r.error && r.error.message}`);
  assert.ok(r.status !== 0, `configure exited ${r.status}; a backup that differs from the migrated bytes is a partial failure`);
  assert.ok(fs.readFileSync(sb.bak, 'utf8').includes('written-after-the-move'), 'the writer\'s bytes are not in the backup');
  assert.ok(lines(r).some((l) => l.includes('changed while migrating') && l.includes(path.basename(sb.bak)) && l.includes('new config')), `the warning does not name the backup and the new config:\n${lines(r).join('\n')}`);
});

// Leg A, same-size replace: the legacy file is replaced by a different file of equal length before the migration moves
// it. The replacement is what the move carries into the backup; the compare with the migrated bytes warns.
test('T-53 leg A (same-size replace): a legacy file replaced by a different file of equal byte length is moved aside, its replacement kept, and the run warns', (t) => {
  const sb = sandbox(t);
  const pre = preloadFile(sb.root, 'replace', sb.legacy, `
fs.renameSync = function (a, b) {
  if (!done) { done = true; realRm.call(fs, legacy, { force: true }); fs.writeFileSync(legacy, ${JSON.stringify(SAME_LEN_BODY)}); }
  return realRename.call(fs, a, b);
};
`);
  const r = runConfigure(sb, pre);
  assert.equal(r.error, undefined, `the child did not run: ${r.error && r.error.message}`);
  assert.ok(r.status !== 0, `configure exited ${r.status}; a backup that differs from the migrated bytes is a partial failure`);
  assert.equal(fs.existsSync(sb.legacy), false, 'the legacy name still holds a file: the migration did not move it aside');
  assert.equal(fs.readFileSync(sb.bak, 'utf8'), SAME_LEN_BODY, 'the backup does not hold the replacement content (a same-size replace is not hidden)');
  assert.ok(newConfigFile(sb.proj), 'the new config file was not written');
});

// Refused move (W-b2): the rename answers EBUSY. The legacy file stays where it is, no backup is made, the run exits 1,
// and the report says the file is kept (the name is there, by lstat). No success line for the migration.
test('a refused move (EBUSY): the legacy file is kept, no backup is made, the run exits 1 and never prints a migration success', (t) => {
  const sb = sandbox(t);
  const pre = preloadFile(sb.root, 'busy', sb.legacy, `
fs.renameSync = function (a, b) {
  if (same(a)) { const e = new Error('EBUSY: resource busy or locked (preload)'); e.code = 'EBUSY'; throw e; }
  return realRename.call(fs, a, b);
};
`);
  const r = runConfigure(sb, pre);
  assert.equal(r.error, undefined, `the child did not run: ${r.error && r.error.message}`);
  assert.ok(r.status !== 0, `configure exited ${r.status}; a refused move is a failed step, so it must exit non-zero`);
  assert.equal(fs.readFileSync(sb.legacy, 'utf8'), LEGACY_BODY, 'the legacy file was changed or removed by a refused move');
  assert.equal(fs.existsSync(sb.bak), false, 'a backup was made by a refused move');
  assert.ok(lines(r).some((l) => l.includes(path.basename(sb.legacy)) && l.includes('kept') && l.includes('EBUSY')), `no line says the legacy file was kept after EBUSY:\n${lines(r).join('\n')}`);
  assert.ok(!lines(r).some((l) => l.startsWith('Migrated the project config')), 'the run printed a migration success for a move that did not happen');
});

// F1: the legacy file is gone by the time the rename runs (a failed rename does not prove the source is there). The run
// says the file was not where it was read, never a success, exit 1, and it makes no backup.
test('F1: a legacy file that is gone when the move runs is reported as not moved (never a success), exit 1, no backup', (t) => {
  const sb = sandbox(t);
  const pre = preloadFile(sb.root, 'gone', sb.legacy, `
fs.renameSync = function (a, b) {
  if (!done && same(a)) { done = true; realRm.call(fs, legacy, { force: true }); const e = new Error('ENOENT: no such file or directory (preload)'); e.code = 'ENOENT'; throw e; }
  return realRename.call(fs, a, b);
};
`);
  const r = runConfigure(sb, pre);
  assert.equal(r.error, undefined, `the child did not run: ${r.error && r.error.message}`);
  assert.ok(r.status !== 0, `configure exited ${r.status}; a move that did not happen is a failed step`);
  assert.equal(fs.existsSync(sb.bak), false, 'a backup was made for a legacy file that was not there');
  assert.ok(lines(r).some((l) => l.includes(path.basename(sb.legacy)) && l.includes('was not moved')), `no line says the legacy file was not moved:\n${lines(r).join('\n')}`);
  assert.ok(!lines(r).some((l) => l.startsWith('Migrated the project config')), 'the run printed a migration success for a move that did not happen');
});

// Unreadable backup: after the rename the backup name is a folder, so it cannot be read back. The compare is UNCHECKED,
// the run says so, exits 1, and the old settings are still in the backup's place (a folder is never read as content).
test('an unreadable backup after the move is reported as unchecked (exit 1), never a clean migration', (t) => {
  const sb = sandbox(t);
  const pre = preloadFile(sb.root, 'unreadable', sb.legacy, `
fs.renameSync = function (a, b) {
  const r = realRename.call(fs, a, b);
  if (!done && same(a)) { done = true; realRm.call(fs, b, { force: true }); fs.mkdirSync(b); }
  return r;
};
`);
  const r = runConfigure(sb, pre);
  assert.equal(r.error, undefined, `the child did not run: ${r.error && r.error.message}`);
  assert.ok(r.status !== 0, `configure exited ${r.status}; a backup that could not be checked is a partial failure`);
  assert.ok(lines(r).some((l) => l.includes(path.basename(sb.bak)) && l.includes('could not be read back')), `no line says the backup could not be read back:\n${lines(r).join('\n')}`);
  assert.ok(!lines(r).some((l) => l.startsWith('Migrated the project config')), 'the run printed a clean migration over an unchecked backup');
});

// The run's one line: a clean migration names the backup and says whether it replaced an earlier one.
test('a clean migration prints one line naming the backup, and says there was no earlier backup', (t) => {
  const sb = sandbox(t);
  const r = runConfigure(sb, null);
  assert.equal(r.error, undefined, `the child did not run: ${r.error && r.error.message}`);
  assert.equal(r.status, 0, `configure exited ${r.status}:\n${r.stdout}\n${r.stderr}`);
  assert.equal(fs.existsSync(sb.legacy), false, 'the legacy file is still at its name after a clean migration');
  assert.equal(fs.readFileSync(sb.bak, 'utf8'), LEGACY_BODY, 'the backup does not hold the migrated bytes');
  assert.ok(lines(r).includes(`Migrated the project config to ${newConfigFile(sb.proj)}; the old file is kept as ${sb.bak} (no earlier backup).`), `the one line is not as the form states:\n${r.stdout}`);
});

// An earlier backup is replaced, and the run's one line says so (W-b3: a rename onto an existing name replaces it).
test('an earlier .bak is replaced by the move, and the run says it replaced one', (t) => {
  const sb = sandbox(t);
  fs.writeFileSync(sb.bak, EARLIER_BACKUP);
  const r = runConfigure(sb, null);
  assert.equal(r.error, undefined, `the child did not run: ${r.error && r.error.message}`);
  assert.equal(r.status, 0, `configure exited ${r.status}:\n${r.stdout}\n${r.stderr}`);
  assert.equal(fs.readFileSync(sb.bak, 'utf8'), LEGACY_BODY, 'the backup does not hold the migrated bytes');
  assert.ok(lines(r).includes(`Migrated the project config to ${newConfigFile(sb.proj)}; the old file is kept as ${sb.bak} (replaced an earlier backup).`), `the one line does not say it replaced an earlier backup:\n${r.stdout}`);
});

// A legacy file at the name that is a link is not a file the migration moves: it is kept, the target is untouched, and
// the run exits 1 (T-59, unchanged by this form). The probe decides whether this platform may make a file link.
function canMakeFileLink(root) {
  const probe = path.join(root, 'probe-target');
  const link = path.join(root, 'probe-link');
  fs.writeFileSync(probe, 'x');
  try {
    fs.symlinkSync(probe, link, 'file');
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(probe, { force: true });
  }
}

test('T-59 leg C (link at the legacy name): a link planted where the legacy file was is kept, its target is untouched, the run exits 1', (t) => {
  const sb = sandbox(t);
  if (!canMakeFileLink(sb.root)) {
    t.skip('this account cannot make a file link (capability probe): the link leg needs the privilege to run');
    return;
  }
  const target = path.join(sb.proj, 'legacy-target.json');
  fs.writeFileSync(target, LEGACY_BODY);
  fs.rmSync(sb.legacy);
  fs.symlinkSync(target, sb.legacy, 'file');
  const r = runConfigure(sb, null);
  assert.equal(r.error, undefined, `the child did not run: ${r.error && r.error.message}`);
  assert.ok(r.status !== 0, `configure exited ${r.status}; a kept legacy link is a partial failure, so it must exit non-zero`);
  assert.ok(fs.lstatSync(sb.legacy).isSymbolicLink(), 'the link at the legacy name was moved or removed');
  assert.equal(fs.readFileSync(target, 'utf8'), LEGACY_BODY, 'the link target was changed or removed');
  assert.equal(fs.existsSync(sb.bak), false, 'a backup was made of a link');
  assert.ok(newConfigFile(sb.proj), 'the new config file was not written');
});

// A legacy file the seed read cannot take in full (over the bound) is moved by nothing: the run says so, exits 1, and
// the file stays where it is.
test('an unreadable legacy file (over the read bound) moves nothing, says so, and exits 1', (t) => {
  const sb = sandbox(t);
  fs.writeFileSync(sb.legacy, `{ "pad": "${'x'.repeat(1024 * 1024 + 16)}" }\n`);
  const r = runConfigure(sb, null);
  assert.equal(r.error, undefined, `the child did not run: ${r.error && r.error.message}`);
  assert.ok(r.status !== 0, `configure exited ${r.status}; a legacy file that was not read is a failed step`);
  assert.ok(fs.existsSync(sb.legacy), 'the unread legacy file was moved');
  assert.equal(fs.existsSync(sb.bak), false, 'a backup was made of a file that was not read');
  assert.ok(lines(r).some((l) => l.includes(path.basename(sb.legacy)) && l.includes('was not moved')), `no line says the unread legacy file was not moved:\n${lines(r).join('\n')}`);
});

// A git-tracked legacy file: its removal is a tracked change the user must commit, and the backup is theirs to keep. The
// run's extra line says so. Skipped visibly where git is not on this machine.
test('a git-tracked legacy file gets the tracked line: commit its removal; the backup is untracked and the user\'s', (t) => {
  const sb = sandbox(t);
  const probe = spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 10000, env: gitEnv(sb.root) });
  if (probe.error || probe.status !== 0) {
    t.skip('git is not on this machine (capability probe): the tracked line needs git to name the file as tracked');
    return;
  }
  fs.rmSync(path.join(sb.proj, '.git'), { recursive: true, force: true });
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: sb.proj, env: gitEnv(sb.root), encoding: 'utf8', timeout: 20000 }).status, 0, 'git init failed in the sandbox');
  assert.equal(spawnSync('git', ['add', '--', sb.legacy], { cwd: sb.proj, env: gitEnv(sb.root), encoding: 'utf8', timeout: 20000 }).status, 0, 'git add failed in the sandbox');
  const r = runConfigure(sb, null);
  assert.equal(r.error, undefined, `the child did not run: ${r.error && r.error.message}`);
  assert.equal(r.status, 0, `configure exited ${r.status}:\n${r.stdout}\n${r.stderr}`);
  assert.ok(lines(r).includes(`${sb.legacy} is tracked by git: commit its removal (git add -A -- ${sb.legacy}). ${sb.bak} is untracked and yours to keep or delete.`), `the tracked line is not as the form states:\n${r.stdout}\n${r.stderr}`);
});
