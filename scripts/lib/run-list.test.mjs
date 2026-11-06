import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoFs = () => import('./repo-fs.mjs');

function fixture(t) {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cl-runlist-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }));
  return d;
}

test('a run list with an absolute root and absolute doc paths is read as written', async (t) => {
  const d = fixture(t);
  const file = path.join(d, 'run.json');
  fs.writeFileSync(file, JSON.stringify({ root: d, docs: [path.join(d, 'a.md')] }));
  const { readRunList } = await repoFs();
  assert.deepEqual(readRunList(file), { root: d, docs: [path.join(d, 'a.md')] });
});

test('a byte-order mark before the run list is stripped, never a parse failure', async (t) => {
  const d = fixture(t);
  const file = path.join(d, 'run.json');
  fs.writeFileSync(file, '﻿' + JSON.stringify({ root: d, docs: [] }));
  const { readRunList } = await repoFs();
  assert.deepEqual(readRunList(file), { root: d, docs: [] });
});

test('a relative root is refused, and the message says the root must be an absolute folder path', async (t) => {
  const d = fixture(t);
  const file = path.join(d, 'run.json');
  fs.writeFileSync(file, JSON.stringify({ root: 'relative/dir', docs: [] }));
  const { readRunList } = await repoFs();
  assert.throws(() => readRunList(file), /absolute/);
});

test('docs that are not a list of absolute paths are refused, whether a string or a relative entry', async (t) => {
  const d = fixture(t);
  const file = path.join(d, 'run.json');
  const { readRunList } = await repoFs();
  fs.writeFileSync(file, JSON.stringify({ root: d, docs: 'a.md' }));
  assert.throws(() => readRunList(file), /docs/);
  fs.writeFileSync(file, JSON.stringify({ root: d, docs: ['a.md'] }));
  assert.throws(() => readRunList(file), /docs/);
});

test('a missing run list names the file and asks for it to be written first', async (t) => {
  const d = fixture(t);
  const file = path.join(d, 'run.json');
  const { readRunList } = await repoFs();
  assert.throws(() => readRunList(file), (e) => /write it first/.test(e.message) && e.message.includes(file));
});

test('the missing-run-list message names --list-path as the way to get the exact path', async (t) => {
  const d = fixture(t);
  const file = path.join(d, 'run.json');
  const { readRunList } = await repoFs();
  assert.throws(() => readRunList(file), (e) => /--list-path/.test(e.message));
});

test('a run list over the config bound is refused, never truncated', async (t) => {
  const d = fixture(t);
  const file = path.join(d, 'run.json');
  fs.writeFileSync(file, JSON.stringify({ root: d, docs: [], pad: 'x'.repeat(1024 * 1024 + 16) }));
  const { readRunList } = await repoFs();
  assert.throws(() => readRunList(file), /write it first/);
});

test('a folder at the run-list path is refused as not a plain file', async (t) => {
  const d = fixture(t);
  const file = path.join(d, 'run.json');
  fs.mkdirSync(file);
  const { readRunList } = await repoFs();
  assert.throws(() => readRunList(file), /write it first/);
});

test('the default run list lives in the system temp folder, where the agent\'s own Write reaches it', async () => {
  const { runListPath } = await repoFs();
  assert.equal(runListPath(), path.join(os.tmpdir(), 'coalledger', 'run.json'));
});

test('a run list whose owner is another user is refused, judged by the uid it is given', async () => {
  const { refusesOwner } = await repoFs();
  assert.equal(refusesOwner({ uid: 1000 }, 999), true);
  assert.equal(refusesOwner({ uid: 999 }, 999), false);
  assert.equal(refusesOwner({ uid: 1000 }, undefined), false, 'a platform with no uid refuses nothing');
});

test('the current user owns a run list they just wrote (skipped visibly where the platform reports no uid)', { skip: typeof process.getuid !== 'function' ? 'this platform reports no uid (Windows)' : false }, async () => {
  const { refusesOwner } = await repoFs();
  assert.equal(refusesOwner({ uid: process.getuid() }, process.getuid()), false);
});
