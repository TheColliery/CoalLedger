// T-19 witness: a child spawned with SANDBOX_ENV sees HOME, USERPROFILE, TEMP, TMP and TMPDIR inside the sandbox
// folder and never the real ones. No room CLI the swept tests spawn reads HOME today, so this checks the
// environment the child receives rather than a behaviour change.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SANDBOX_ENV, SANDBOX_DIR } from './test-sandbox.mjs';

test('a child spawned with SANDBOX_ENV sees its home and temp folders inside the sandbox, never the real ones', () => {
  const r = spawnSync(process.execPath, ['-e', 'const e = process.env, o = require("os"); console.log(JSON.stringify([e.HOME, e.USERPROFILE, e.TEMP, e.TMP, e.TMPDIR, o.homedir(), o.tmpdir()]))'],
    { encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL', env: SANDBOX_ENV });
  assert.equal(r.status, 0, r.stderr);
  const seen = JSON.parse(r.stdout);
  const inside = (p) => !path.relative(SANDBOX_DIR, fs.realpathSync.native(p)).startsWith('..');
  for (const p of seen) assert.ok(inside(p), `${p} is inside the sandbox`);
  assert.notEqual(fs.realpathSync.native(seen[5]), fs.realpathSync.native(os.homedir()), 'the child does not see the real home');
});
