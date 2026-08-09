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
