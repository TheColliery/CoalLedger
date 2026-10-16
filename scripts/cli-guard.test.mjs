// LOW-3 (r33 INSPECT, bounced to the coder -- record: commit 4c8940a's own
// findings-back round): configure.mjs and build-claude-ai-zips.mjs ran their
// entry point BARE at
// module top level (`main();` / `main().catch(...)`) -- unlike
// build-plugin.mjs / md-checks.mjs / emdash.mjs, which all gate their CLI
// block on `process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href`.
//
// Before CWK-071 (r33) an `import` of configure.mjs instead of a spawn hit
// process.exit(1) and killed the IMPORTER outright -- loud and unmissable.
// After r33's exitCode conversion, the same import silently sets the
// IMPORTER's own process.exitCode and the importer keeps running -- a
// fully-green run can now finish non-zero with no failing test naming why.
//
// These tests spawn a THROWAWAY importer as a child process -- never
// `await import()` inline in this file, which would poison whatever spawned
// `node --test` itself -- and assert the importer's own exit code is
// untouched by the import.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// process.argv[2] (read from INSIDE the imported module, not this script) is
// the target's own file:// URL -- the exact shape the r33 reviewer measured:
// importing configure.mjs poisoned the importer via that very argv[2] value,
// read by configure.mjs's own bare `main()` as an "unrecognized option".
// The 400ms wait lets build-claude-ai-zips.mjs's fire-and-forget async
// `main().catch(...)` (never itself awaited at module scope) finish before
// this importer reads process.exitCode -- generous for the few sync fs
// calls its early-exit branch makes.
const IMPORTER = `
await import(process.argv[2]);
await new Promise((r) => setTimeout(r, 400));
console.log('after import, exitCode=' + process.exitCode);
`;

function runImporter(tmp, target) {
  const importerPath = path.join(tmp, 'importer.mjs');
  fs.writeFileSync(importerPath, IMPORTER);
  return spawnSync(process.execPath, [importerPath, target], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
}

test('configure.mjs: importing it (not spawning it) must not touch the importer exit code', () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clg-guard-cfg-')));
  try {
    const target = pathToFileURL(path.join(repo, 'scripts', 'configure.mjs')).href;
    const r = runImporter(tmp, target);
    assert.equal(r.status, 0, `import must not poison the importer's exit code -- stdout: ${r.stdout} stderr: ${r.stderr}`);
    assert.doesNotMatch(r.stdout, /exitCode=1/, 'the CLI guard must keep main() from running on import');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('build-claude-ai-zips.mjs: importing it (not spawning it) must not touch the importer exit code', () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clg-guard-zip-')));
  try {
    // Copied into an isolated tree with NO plugin/ dir, so even the pre-fix
    // unguarded shape cannot touch anything under the real repo -- its own
    // "plugin/ does not exist" branch is what previously fired on import.
    fs.mkdirSync(path.join(tmp, 'scripts', 'lib'), { recursive: true });
    const scriptCopy = path.join(tmp, 'scripts', 'build-claude-ai-zips.mjs');
    fs.cpSync(path.join(repo, 'scripts', 'build-claude-ai-zips.mjs'), scriptCopy);
    fs.cpSync(path.join(repo, 'scripts', 'lib', 'desc-cap.mjs'), path.join(tmp, 'scripts', 'lib', 'desc-cap.mjs'));
    fs.cpSync(path.join(repo, 'scripts', 'lib', 'claude-ai-trim.mjs'), path.join(tmp, 'scripts', 'lib', 'claude-ai-trim.mjs'));
    const target = pathToFileURL(scriptCopy).href;
    const r = runImporter(tmp, target);
    assert.equal(r.status, 0, `import must not poison the importer's exit code -- stdout: ${r.stdout} stderr: ${r.stderr}`);
    assert.doesNotMatch(r.stdout, /exitCode=1/, 'the CLI guard must keep main() from running on import');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
