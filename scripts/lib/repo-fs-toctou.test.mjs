// 29nd (T-76): the read walks the folder chain by lstat FIRST, and then compares the handle it opened with the last lstat of the target.
// The name is judged, then opened by name, so a name swapped between the judgement and the open is the window this closes.
// Legs: (1) a name swapped to a file OUTSIDE the root after the judgement and before the open is refused, and no outside byte comes back;
// (2) a name swapped to ANOTHER file inside the root is refused too (the identity of the handle changed); (3) a junction in the folder
// chain is refused with ZERO opens on its path (the reviewer's witness, kept as a regression leg).
// The swap uses a hard link, the unprivileged shim for a name (a file symlink needs a privilege some accounts lack). A leg whose hard link
// cannot be made skips VISIBLY. Every file lives under one temp root this file makes, asserted, and removed by name in an `after` hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { readRepoFileOutcome } = await import(pathToFileURL(path.join(here, 'repo-fs.mjs')).href);
const TMP = fs.realpathSync.native(os.tmpdir());
const PREFIX = 'repofs-toctou-';
const BOUND = 1024 * 1024;
// The outcome carries a bigint identity, which JSON.stringify refuses; a message must still print, never throw.
const show = (g) => JSON.stringify(g, (k, v) => (typeof v === 'bigint' ? v.toString() : v));

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(TMP, PREFIX));
  const real = fs.realpathSync.native(root);
  if (path.dirname(real) !== TMP) throw new Error(`refusing: ${real} is not directly under ${TMP}`);
  t.after(() => {
    if (path.dirname(real) === TMP && path.basename(real).startsWith(PREFIX)) fs.rmSync(real, { recursive: true, force: true });
  });
  const proj = path.join(real, 'proj');
  const outside = path.join(real, 'outside');
  fs.mkdirSync(proj, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  return { real, proj, outside };
}

// Wraps fs.openSync for ONE open of `target`: `beforeOpen` runs just before the real open, so it lands between the judgement and the open.
// Returns the undo. Other opens pass through untouched.
function swapBeforeOpen(target, beforeOpen) {
  const realOpen = fs.openSync;
  let fired = false;
  fs.openSync = function (p, ...rest) {
    if (!fired && path.resolve(String(p)) === path.resolve(target)) { fired = true; beforeOpen(); }
    return realOpen.call(fs, p, ...rest);
  };
  return () => { fs.openSync = realOpen; };
}

// Counts the opens of any path under `dir`. Returns the count reader and the undo.
function countOpensUnder(dir) {
  const realOpen = fs.openSync;
  const hits = [];
  fs.openSync = function (p, ...rest) {
    const abs = path.resolve(String(p));
    if (abs === dir || abs.startsWith(dir + path.sep)) hits.push(abs);
    return realOpen.call(fs, p, ...rest);
  };
  return { hits, undo: () => { fs.openSync = realOpen; } };
}

function canHardLink(dir) {
  const a = path.join(dir, 'link-probe-a');
  const b = path.join(dir, 'link-probe-b');
  fs.writeFileSync(a, 'x');
  try {
    fs.linkSync(a, b);
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(b, { force: true });
    fs.rmSync(a, { force: true });
  }
}

test('T-76: a name swapped to a file OUTSIDE the root after the judgement and before the open is refused, and no outside byte comes back', (t) => {
  const s = sandbox(t);
  if (!canHardLink(s.proj)) { t.skip('this account cannot make a hard link (the name-swap shim): the outside swap is not reproduced here'); return; }
  const inside = path.join(s.proj, 'x.md');
  const victim = path.join(s.outside, 'victim.md');
  fs.writeFileSync(inside, 'INSIDE\n');
  fs.writeFileSync(victim, 'VICTIM\n');
  const restore = swapBeforeOpen(inside, () => { fs.rmSync(inside); fs.linkSync(victim, inside); });
  let got;
  try { got = readRepoFileOutcome(inside, s.proj, BOUND); } finally { restore(); }
  assert.equal(got.status, 'refused', `a name swapped after the judgement must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('VICTIM'), `the outside bytes came back: ${show(got)}`);
});

test('T-76: a name swapped to ANOTHER file inside the root after the judgement is refused too (the handle is not the file that was judged)', (t) => {
  const s = sandbox(t);
  if (!canHardLink(s.proj)) { t.skip('this account cannot make a hard link (the name-swap shim): the inside swap is not reproduced here'); return; }
  const inside = path.join(s.proj, 'x.md');
  const other = path.join(s.proj, 'y.md');
  fs.writeFileSync(inside, 'INSIDE\n');
  fs.writeFileSync(other, 'OTHER\n');
  const restore = swapBeforeOpen(inside, () => { fs.rmSync(inside); fs.linkSync(other, inside); });
  let got;
  try { got = readRepoFileOutcome(inside, s.proj, BOUND); } finally { restore(); }
  assert.equal(got.status, 'refused', `a name swapped to another inside file must be refused, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('OTHER'), `the swapped-in file's bytes came back: ${show(got)}`);
});

test('T-76: a junction in the folder chain is refused with ZERO opens on its path (the reviewer witness, kept as a regression leg)', (t) => {
  const s = sandbox(t);
  const docs = path.join(s.proj, 'docs');
  try {
    fs.symlinkSync(s.outside, docs, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (e) {
    t.skip(`this account cannot make a folder link (${e.code}): the chain witness is not reproduced here`);
    return;
  }
  fs.writeFileSync(path.join(s.outside, 'x.md'), 'OUTSIDE\n');
  const counter = countOpensUnder(docs);
  let got;
  try { got = readRepoFileOutcome(path.join(docs, 'x.md'), s.proj, BOUND); } finally { counter.undo(); }
  assert.equal(counter.hits.length, 0, `a junction in the chain was opened through: ${counter.hits.join(', ')}`);
  assert.equal(got.status, 'refused', `a junction in the chain must refuse, got ${show(got)}`);
  assert.ok(!(got.text ?? '').includes('OUTSIDE'), 'the outside bytes came back through the chain');
});
