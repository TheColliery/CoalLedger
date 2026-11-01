// T-19: one sandboxed environment per test file for the CLI children its tests spawn. The room's .coderabbit.yaml path
// instruction says a test that spawns a hook or a CLI sandboxes HOME and TEMP and never touches the real ~/.claude,
// whatever the child reads today. The folders are made under the resolved temp folder at import, and the test runner's
// `after` removes them once the file's tests have run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';

const BASE = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cl-sandbox-'));
after(() => fs.rmSync(BASE, { recursive: true, force: true, maxRetries: 5 }));
const HOME = path.join(BASE, 'home');
const TMP = path.join(BASE, 'tmp');
fs.mkdirSync(HOME);
fs.mkdirSync(TMP);

export const SANDBOX_DIR = BASE;
export const SANDBOX_ENV = Object.freeze({ ...process.env, HOME, USERPROFILE: HOME, TEMP: TMP, TMP, TMPDIR: TMP, CLAUDE_CONFIG_DIR: '' });
