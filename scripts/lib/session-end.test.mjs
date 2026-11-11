// 29ea Unit B witness: the SessionEnd hook removes THIS session's own temp markers, and a staleness sweep collects the room's old ones.
// Every hook is spawned as the REAL file, hermetic: TEMP/TMP/TMPDIR/HOME/USERPROFILE point at a sandbox under os.tmpdir(), the CLAUDE_*
// host variables are removed, and every child carries the room's heap cap and a kill timeout. The sandbox is removed in a registered teardown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOKS = path.join(ROOM, 'hooks');
const DAY_MS = 24 * 3600 * 1000;
const UID = typeof process.getuid === 'function' ? process.getuid() : undefined;
const RUN_LIST_NAME = UID === undefined ? 'coalledger' : `coalledger-${UID}`;

function sandbox(t) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cl-sessend-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const sb = { base, tmp: path.join(base, 'tmp'), home: path.join(base, 'home'), project: path.join(base, 'project') };
  for (const d of [sb.tmp, sb.home, sb.project]) fs.mkdirSync(d, { recursive: true });
  return sb;
}

function hostEnv(sb) {
  const env = { ...process.env, TEMP: sb.tmp, TMP: sb.tmp, TMPDIR: sb.tmp, HOME: sb.home, USERPROFILE: sb.home, NODE_OPTIONS: '--max-old-space-size=2048' };
  for (const k of Object.keys(env)) if (/^CLAUDE_/.test(k)) delete env[k];
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function runHook(sb, file, stdin) {
  return spawnSync(process.execPath, [path.join(HOOKS, file)], { input: stdin, encoding: 'utf8', env: hostEnv(sb), cwd: sb.project, timeout: 60000, killSignal: 'SIGKILL' });
}

function plant(file, agedMs = 0) {
  fs.writeFileSync(file, '');
  if (agedMs) { const when = new Date(Date.now() - agedMs); fs.utimesSync(file, when, when); }
  return file;
}

test('hooks.json registers the SessionEnd hook with the exact entry (no onFailure field, a 5 s timeout)', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(HOOKS, 'hooks.json'), 'utf8'));
  assert.deepEqual(cfg.hooks.SessionEnd, [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/coalledger-session-end.js'], timeout: 5 }] }]);
});

test('SessionEnd removes THIS session\'s two markers; the Stop hook keeps the satisfier; other sessions, foreign files and young files remain; an old file of ours is swept', (t) => {
  const sb = sandbox(t);
  const memory = plant(path.join(sb.project, 'MEMORY.md'));
  const docsPayload = JSON.stringify({ session_id: 'sessA', cwd: sb.project, tool_input: { file_path: memory } });
  const r1 = runHook(sb, 'coalledger-doctrack.js', docsPayload);
  assert.equal(r1.status, 0, r1.stderr);
  const satisfierA = path.join(sb.tmp, 'coalledger-sessA.docmemmoved');
  assert.ok(fs.existsSync(satisfierA), 'doctrack recorded the MEMORY.md satisfier for session A');

  const r2 = runHook(sb, 'coalledger-drift-stop.js', JSON.stringify({ session_id: 'sessA', cwd: sb.project, hook_event_name: 'Stop' }));
  assert.equal(r2.status, 0, r2.stderr);
  assert.ok(fs.existsSync(satisfierA), 'the Stop hook keeps the satisfier by design (Stop fires per response)');

  const docsA = plant(path.join(sb.tmp, 'coalledger-sessA.docs'));
  const satisfierB = plant(path.join(sb.tmp, 'coalledger-sessB.docmemmoved'));
  const foreign = plant(path.join(sb.tmp, 'other-tool.marker'));
  const young = plant(path.join(sb.tmp, 'coalledger-young.docs'));
  const old = plant(path.join(sb.tmp, 'coalledger-old.docmemmoved'), 8 * DAY_MS);

  const r3 = runHook(sb, 'coalledger-session-end.js', JSON.stringify({ session_id: 'sessA', cwd: sb.project, hook_event_name: 'SessionEnd' }));
  assert.equal(r3.status, 0, r3.stderr);
  assert.equal(r3.stdout, '', 'SessionEnd is silent on stdout');
  assert.equal(r3.stderr, '', 'SessionEnd is silent on stderr');
  assert.equal(fs.existsSync(satisfierA), false, 'session A\'s satisfier is removed');
  assert.equal(fs.existsSync(docsA), false, 'session A\'s .docs is removed');
  assert.ok(fs.existsSync(satisfierB), 'session B\'s satisfier is left alone');
  assert.ok(fs.existsSync(foreign), 'a foreign file is left alone');
  assert.ok(fs.existsSync(young), 'a file of ours younger than seven days is left alone');
  assert.equal(fs.existsSync(old), false, 'a file of ours older than seven days is swept by the staleness sweep');
});

test('SessionEnd is fail-silent on every malformed or traversal-shaped payload: exit 0, empty stdout and stderr, and nothing outside the temp folder is touched', (t) => {
  const sb = sandbox(t);
  const canary = plant(path.join(sb.base, 'outside.docmemmoved'));
  const payloads = ['not json', '', JSON.stringify({}), JSON.stringify({ session_id: ['x'] }), JSON.stringify({ session_id: '../../outside' }), JSON.stringify({ session_id: '..' })];
  for (const p of payloads) {
    const r = runHook(sb, 'coalledger-session-end.js', p);
    assert.equal(r.status, 0, `exit 0 for payload ${JSON.stringify(p)}: ${r.stderr}`);
    assert.equal(r.stdout, '', `silent stdout for payload ${JSON.stringify(p)}`);
    assert.equal(r.stderr, '', `silent stderr for payload ${JSON.stringify(p)}`);
  }
  assert.ok(fs.existsSync(canary), 'a traversal-shaped session_id does not reach a file outside the temp folder');
});

test('the staleness sweep deletes at most 200 files per run, so a huge temp folder cannot blow the SessionEnd budget', (t) => {
  const sb = sandbox(t);
  for (let i = 0; i < 210; i++) plant(path.join(sb.tmp, `coalledger-stale${i}.docs`), 8 * DAY_MS);
  const r = runHook(sb, 'coalledger-session-end.js', JSON.stringify({ session_id: 'sessZ', cwd: sb.project }));
  assert.equal(r.status, 0, r.stderr);
  const left = fs.readdirSync(sb.tmp).filter((n) => /^coalledger-stale\d+\.docs$/.test(n));
  assert.equal(left.length, 10, `210 stale files, 200 deletions per run: ${left.length} remain`);
});

test('the staleness sweep never touches a link: a stale link named like ours is left as a link, and its target is untouched (skipped visibly where this volume cannot make a link)', (t) => {
  const sb = sandbox(t);
  const target = path.join(sb.base, 'link-target.txt');
  fs.writeFileSync(target, 'keep me');
  const link = path.join(sb.tmp, 'coalledger-linked.docs');
  try { fs.symlinkSync(target, link, 'file'); } catch (e) { t.skip(`this volume cannot make a file link (${e.code})`); return; }
  const when = new Date(Date.now() - 8 * DAY_MS);
  fs.lutimesSync(link, when, when);
  const r = runHook(sb, 'coalledger-session-end.js', JSON.stringify({ session_id: 'sessL', cwd: sb.project }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep me', 'the link target is never read or removed');
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'the link is still a link: the sweep takes only regular files, never a link');
});

test('SessionEnd sweeps the run-list folder\'s stale AG markers and leaves a foreign file and a young marker', (t) => {
  const sb = sandbox(t);
  const folder = path.join(sb.tmp, RUN_LIST_NAME);
  fs.mkdirSync(folder, { mode: 0o700 });
  const stale = plant(path.join(folder, 'ag-conductor-zz9.marker'), 8 * DAY_MS);
  const young = plant(path.join(folder, 'ag-conductor-zz8.marker'));
  const foreign = plant(path.join(folder, 'ag-other.marker'), 8 * DAY_MS);
  const r = runHook(sb, 'coalledger-session-end.js', JSON.stringify({ session_id: 'sessQ', cwd: sb.project }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(stale), false, 'a stale AG marker of ours is swept');
  assert.ok(fs.existsSync(young), 'a young AG marker is left alone');
  assert.ok(fs.existsSync(foreign), 'a foreign file in the run-list folder is left alone');
});

test('the AG conductor sweeps its stale markers on the run that writes its own marker, and not on a run that finds it already written', (t) => {
  const sb = sandbox(t);
  const folder = path.join(sb.tmp, RUN_LIST_NAME);
  fs.mkdirSync(folder, { mode: 0o700 });
  const payload = JSON.stringify({ conversationId: 'C-one', cwd: sb.project, workspacePaths: [sb.project] });
  const staleFirst = plant(path.join(folder, 'ag-conductor-zz9.marker'), 8 * DAY_MS);
  const r1 = runHook(sb, 'ag-conductor.js', payload);
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(fs.existsSync(staleFirst), false, 'the run that writes its marker sweeps the stale AG markers');
  const written = fs.readdirSync(folder).filter((n) => /^ag-conductor-[0-9a-z]+\.marker$/.test(n) && n !== 'ag-conductor-zz9.marker');
  assert.equal(written.length >= 1, true, 'the AG conductor wrote its own marker (the real base-36 name form)');

  const staleSecond = plant(path.join(folder, 'ag-conductor-zz7.marker'), 8 * DAY_MS);
  const r2 = runHook(sb, 'ag-conductor.js', payload);
  assert.equal(r2.status, 0, r2.stderr);
  assert.ok(fs.existsSync(staleSecond), 'a run that finds its marker already written does not sweep');
});
