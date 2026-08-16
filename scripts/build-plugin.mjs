#!/usr/bin/env node
// CoalLedger dist build — assemble a CLEAN `plugin/` from source so the Claude
// Code marketplace serves ONLY the plugin (manifest + hooks + skills + the
// engine under scripts/lib), never the repo's gate scripts, fixtures, docs, or
// design files. Mirrors the CoalWash build-plugin shape; marketplace.json
// `source` points at ./plugin. Run after editing hooks/skills/scripts-lib/
// plugin.json — verify.mjs FAILs on drift. Node built-ins only.
//
// Named divergence from the hook-only siblings (one-flock rule: name it where
// it lives): CoalLedger ships `scripts/lib/` in the dist because the hooks/
// conductor and the Stop drift hook import those modules at runtime, so hook
// and engine can never diverge. The doc-structure SKILL no longer runs the
// engine from there — it runs its OWN self-contained copy at
// `skills/doc-structure/lib/`, generated below (see GENERATED). Tests are
// filtered out of the dist; fixtures live under scripts/fixtures/ (outside
// every DIST_ITEM) so they never ship. Board #40 fixback: build-time-only
// libs (desc-cap.mjs, claude-ai-trim.mjs — consumed only by verify.mjs and
// build-claude-ai-zips.mjs, neither of which ships) are filtered out the
// same way, per-file (BUILD_ONLY_LIB_NAMES below), not by directory.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(repo, 'plugin');

// EXACTLY what a Claude Code plugin loads — nothing the marketplace clone
// carries that a user does not need.
export const DIST_ITEMS = [
  path.join('.claude-plugin', 'plugin.json'),
  'commands',
  'hooks',
  'skills',
  path.join('scripts', 'lib'),
];

// GENERATED engine copy: dist-relative path -> the ONE source it is copied from.
//
// doc-structure's SKILL.md tells the agent to run the AST engine. A skill folder
// must be SELF-CONTAINED, because it travels alone (a claude.ai ZIP upload, any
// standalone consumer) where no plugin root exists and a `<plugin root>/...` or
// `../../scripts/lib/...` instruction points at nothing. So the build copies the
// engine INTO the skill as `./lib/`, and SKILL.md invokes it relatively.
//
// The SOURCE stays single (`scripts/lib/`) — this is build OUTPUT, never
// hand-edited, and checkDist byte-checks it against that source like everything
// else under plugin/. Tracking a second copy as SOURCE was the rejected
// alternative: it forks the engine the day a standalone consumer appears.
// md-checks.mjs imports './md-ast.mjs', so both files must land side by side.
export const SKILL_ENGINE_DIR = path.join('skills', 'doc-structure', 'lib');
export const GENERATED = new Map(
  ['md-ast.mjs', 'md-checks.mjs'].map((f) => [
    path.join(SKILL_ENGINE_DIR, f),
    path.join('scripts', 'lib', f),
  ]),
);

const isTest = (p) => /\.test\.[cm]?js$/.test(p);

// board #40 fixback (INSPECT F2): unlike every other file under scripts/lib/,
// these two exist ONLY for build-time tooling (verify.mjs's own frontmatter
// gate, build-claude-ai-zips.mjs) -- no hook or skill imports them at
// runtime, so the wholesale scripts/lib DIST_ITEM copy (see the header
// comment's own stated reason: "the hooks/conductor and the Stop drift hook
// import those modules at runtime") was shipping dead bytes into every
// install. Matched by basename, not full path, since fs.cpSync's filter
// callback receives absolute paths while checkDist's own filesUnder walk
// uses repo-relative ones -- a basename check is correct either way.
const BUILD_ONLY_LIB_NAMES = new Set(['desc-cap.mjs', 'claude-ai-trim.mjs']);
const isBuildOnlyLib = (p) => BUILD_ONLY_LIB_NAMES.has(path.basename(p));
const isDistExcluded = (p) => isTest(p) || isBuildOnlyLib(p);

// TEXT_EXTS grounded in what actually ships: every extension found under
// DIST_ITEMS today. Non-text/unlisted extensions stay strict byte-compare —
// the mechanism must not silently normalize a future binary asset.
const TEXT_EXTS = new Set(['.js', '.json', '.md', '.mjs']);

// Byte-compare two files, EOL-agnostic on TEXT_EXTS only (board #47's
// `.gitattributes` eol=lf can still leave a stale core.autocrlf checkout with
// CRLF bytes for byte-identical content). Never a blanket \r strip -- a LONE
// bare \r (not followed by \n) is real content, not a line-ending artifact,
// and must still cause a mismatch.
function filesMatch(a, b) {
  const bufA = fs.readFileSync(a);
  const bufB = fs.readFileSync(b);
  if (bufA.compare(bufB) === 0) return true;
  const ext = path.extname(a);
  if (ext !== path.extname(b) || !TEXT_EXTS.has(ext)) return false;
  // latin1, not utf8: utf8 maps every INVALID byte to U+FFFD, so two files
  // differing only in invalid-UTF-8 bytes would decode to the SAME string and
  // report a false match -- exactly the corruption class this gate exists to
  // catch. latin1 is a lossless 1:1 byte<->char mapping (no byte class ever
  // collapses); CRLF bytes normalize identically to utf8 for the ASCII range.
  const crlfToLf = (buf) => buf.toString('latin1').replace(/\r\n/g, '\n');
  return crlfToLf(bufA) === crlfToLf(bufB);
}

export function buildDist(distRoot = dist) {
  fs.rmSync(distRoot, { recursive: true, force: true });
  for (const rel of DIST_ITEMS) {
    const src = path.join(repo, rel);
    const dst = path.join(distRoot, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.cpSync(src, dst, { recursive: true, filter: (s) => !isDistExcluded(s) }); // recursive always; EXCLUDE *.test.* + build-only libs — dev-only tooling never ships (clean-clone)
  }
  for (const [distRel, srcRel] of GENERATED) {
    const dst = path.join(distRoot, distRel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(repo, srcRel), dst);
  }
}

// Every source file under DIST_ITEMS must exist in distRoot AND match
// byte-for-byte, distRoot must hold nothing under those items without a source
// (orphan), and no top-level entry may exist that no DIST_ITEM accounts for.
// Returns [] when in sync.
export function checkDist(distRoot = dist) {
  const out = [];
  const filesUnder = (root, rel) => {
    if (isDistExcluded(rel)) return []; // excluded from the dist -> excluded here too, both directions
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return [];
    if (fs.statSync(abs).isDirectory()) return fs.readdirSync(abs).flatMap((n) => filesUnder(root, path.join(rel, n)));
    return [rel];
  };
  for (const item of DIST_ITEMS) {
    for (const rel of filesUnder(repo, item)) {
      const d = path.join(distRoot, rel);
      if (!fs.existsSync(d)) out.push(`missing in plugin/: ${rel}`);
      else if (!filesMatch(path.join(repo, rel), d)) out.push(`stale in plugin/: ${rel}`);
    }
    for (const rel of filesUnder(distRoot, item)) {
      if (GENERATED.has(rel)) continue; // build output, byte-checked against its own source below
      if (!fs.existsSync(path.join(repo, rel))) out.push(`orphan in plugin/ (no source): ${rel}`);
    }
  }
  // The generated engine copy: present + byte-identical to the ONE source.
  for (const [distRel, srcRel] of GENERATED) {
    const d = path.join(distRoot, distRel);
    if (!fs.existsSync(d)) out.push(`missing in plugin/ (generated from ${srcRel}): ${distRel}`);
    else if (!filesMatch(path.join(repo, srcRel), d)) out.push(`stale in plugin/ (generated from ${srcRel}): ${distRel}`);
  }
  const allowedTops = new Set(DIST_ITEMS.map((rel) => rel.split(path.sep)[0]));
  if (fs.existsSync(distRoot)) {
    for (const name of fs.readdirSync(distRoot)) {
      if (!allowedTops.has(name)) out.push(`orphan top-level in plugin/ (no DIST_ITEM): ${name}`);
    }
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) {
    const f = checkDist();
    if (f.length) { console.error('plugin/ dist OUT OF SYNC:\n' + f.map((x) => '  ' + x).join('\n') + '\n-> run: node scripts/build-plugin.mjs'); process.exit(1); }
    console.log('plugin/ dist in sync with source.');
  } else {
    buildDist();
    console.log('plugin/ dist built (plugin.json + commands + hooks + skills + scripts/lib) from source.');
  }
}
