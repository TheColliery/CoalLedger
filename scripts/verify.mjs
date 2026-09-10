#!/usr/bin/env node
// CoalLedger verify gate — fail LOUD if the factory config drifts from the
// schema, required files are missing/malformed, a lib fails to import, the
// pilot skill's frontmatter is wrong, or the plugin/ dist is stale. Wrapped
// per-check so one bad input yields a clean FAIL line, not a stack trace
// (scripts-quality.md: CLI = fail loud).

import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIG_SCHEMA, validateConfig } from './lib/config-schema.mjs';
import { stripJsonc } from './lib/jsonc.mjs';
import { DESC_CAP, frontmatterField } from './lib/desc-cap.mjs';
import { checkPointers, pointerCandidates, looksPathShaped, DEFAULT_SURFACE_PLAN, collectSurfaces, applyCheckIgnoreProbe } from './lib/pointer-check.mjs';
import { checkConfigKeys, checkConfigReadPath } from './lib/config-keys.mjs';
import { projectConfigCandidates, physicalDir } from './lib/config-load.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { console.log(`  FAIL ${m}`); fails++; };

const LIBS = [
  'md-ast.mjs', 'md-checks.mjs',
  'config-schema.mjs', 'config-load.mjs', 'jsonc.mjs',
  'desc-cap.mjs', 'claude-ai-trim.mjs', // board #40
];

// The full 6+1 canary set (blueprint §1 + §8) — every entry must ship a SKILL.md.
const SKILLS = ['doc-structure', 'doc-grounding', 'doc-standard', 'doc-rot', 'doc-consistency', 'doc-quality', 'doc-leak'];

console.log('files:');
for (const [label, p] of [
  ['hooks/coalledger-conductor.js', path.join(repo, 'hooks', 'coalledger-conductor.js')],
  ['hooks/ag-conductor.js', path.join(repo, 'hooks', 'ag-conductor.js')],
  ['hooks/coalledger-doctrack.js', path.join(repo, 'hooks', 'coalledger-doctrack.js')],
  ['hooks/coalledger-drift-stop.js', path.join(repo, 'hooks', 'coalledger-drift-stop.js')],
  ['hooks/hooks.json', path.join(repo, 'hooks', 'hooks.json')],
  ['platform-configs/hooks.json', path.join(repo, 'platform-configs', 'hooks.json')],
  ...SKILLS.map((s) => [`skills/${s}/SKILL.md`, path.join(repo, 'skills', s, 'SKILL.md')]),
  ['commands/stats.md', path.join(repo, 'commands', 'stats.md')],
  ['commands/update.md', path.join(repo, 'commands', 'update.md')],
  ['.claude-plugin/plugin.json', path.join(repo, '.claude-plugin', 'plugin.json')],
  ['.claude-plugin/marketplace.json', path.join(repo, '.claude-plugin', 'marketplace.json')],
  ['platform-configs/.coalledger.json', path.join(repo, 'platform-configs', '.coalledger.json')],
  ['LICENSE', path.join(repo, 'LICENSE')],
  ['NOTICE', path.join(repo, 'NOTICE')],
  ...LIBS.map((l) => [`scripts/lib/${l}`, path.join(repo, 'scripts', 'lib', l)]),
]) { try { fs.existsSync(p) ? ok(label) : fail(`${label} missing`); } catch (e) { fail(`${label}: ${e.message}`); } }

console.log('plugin manifest:');
try {
  const pj = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8'));
  if (pj.name === 'coalledger') ok("plugin.json name = 'coalledger'"); else fail(`plugin.json name = '${pj.name}' (want 'coalledger')`);
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(pj.version || '')) ok(`plugin.json version '${pj.version}' is semver (pre-release accepted)`);
  else fail(`plugin.json version '${pj.version}' not semver`);
  if (pj.license === 'Apache-2.0') ok('plugin.json license = Apache-2.0'); else fail(`plugin.json license = '${pj.license}' (series license is Apache-2.0)`);
  const hj = fs.readFileSync(path.join(repo, 'hooks', 'hooks.json'), 'utf8');
  if (hj.includes('${CLAUDE_PLUGIN_ROOT}/hooks/coalledger-conductor.js')) ok('hooks.json wires SessionStart via ${CLAUDE_PLUGIN_ROOT}/hooks');
  else fail('hooks.json does not wire SessionStart under ${CLAUDE_PLUGIN_ROOT}/hooks');
  if (hj.includes('${CLAUDE_PLUGIN_ROOT}/hooks/coalledger-doctrack.js')) ok('hooks.json wires PostToolUse (docs-drift tracker)');
  else fail('hooks.json does not wire the docs-drift tracker (coalledger-doctrack.js)');
  if (hj.includes('${CLAUDE_PLUGIN_ROOT}/hooks/coalledger-drift-stop.js')) ok('hooks.json wires Stop (docs-drift nudge)');
  else fail('hooks.json does not wire the docs-drift Stop nudge (coalledger-drift-stop.js)');
} catch (e) { fail(`plugin manifest: ${e.message}`); }

console.log('marketplace.json:');
try {
  const mj = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'marketplace.json'), 'utf8'));
  if (mj.plugins?.[0]?.source === './plugin') ok('marketplace.json points at ./plugin');
  else fail(`marketplace.json plugins[0].source = '${mj.plugins?.[0]?.source}' (want './plugin')`);
  if (mj.plugins?.[0]?.version === undefined) ok('marketplace entry carries no version (plugin.json is the SSoT)');
  else fail('marketplace entry sets a version — remove it (plugin.json is the only version home)');
} catch (e) { fail(`marketplace.json: ${e.message}`); }

// Skill-listing description cap + frontmatterField: shared with build-claude-ai-zips.mjs,
// board #40 — see scripts/lib/desc-cap.mjs for the cap rationale and parser detail.

console.log('skills (frontmatter contract, all 6+1):');
for (const name of SKILLS) {
  try {
    // \r?-tolerant: the Windows CI runner checks out with autocrlf=true, so the
    // same committed LF file arrives CRLF there — the contract must not care.
    const sk = fs.readFileSync(path.join(repo, 'skills', name, 'SKILL.md'), 'utf8');
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(sk);
    if (!fm) { fail(`${name}: no frontmatter block`); continue; }
    if (new RegExp(`^name:\\s*${name}\\s*$`, 'm').test(fm[1])) ok(`${name}: frontmatter name matches its dir`);
    else fail(`${name}: frontmatter name does not match its dir`);
    const len = (frontmatterField(sk, 'description') || '').length + (frontmatterField(sk, 'when_to_use') || '').length;
    if (len === 0) fail(`${name}: frontmatter description missing/unparsed`);
    else if (len > DESC_CAP) fail(`${name}: description+when_to_use ${len} chars exceeds the ${DESC_CAP}-char cap`);
    else ok(`${name}: description ${len} chars (cap ${DESC_CAP})`);
    if (sk.includes('github.com/TheColliery/CoalLedger/issues')) ok(`${name}: carries the problem-report offer`);
    else fail(`${name}: missing the problem-report offer (standard system #4)`);
  } catch (e) { fail(`${name}: ${e.message}`); }
}

console.log('description length cap (commands):');
try {
  const commandsDir = path.join(repo, 'commands');
  for (const f of fs.readdirSync(commandsDir).filter((n) => n.endsWith('.md'))) {
    try {
      const text = fs.readFileSync(path.join(commandsDir, f), 'utf8');
      const len = (frontmatterField(text, 'description') || '').length + (frontmatterField(text, 'when_to_use') || '').length;
      if (len > DESC_CAP) fail(`commands/${f}: description+when_to_use ${len} chars exceeds the ${DESC_CAP}-char cap`);
      else ok(`commands/${f}: ${len} chars (cap ${DESC_CAP})`);
    } catch (e) { fail(`commands/${f} description check: ${e.message}`); }
  }
} catch (e) { fail(`commands/ listing: ${e.message}`); }
try {
  const sk = fs.readFileSync(path.join(repo, 'skills', 'doc-structure', 'SKILL.md'), 'utf8');
  // Assert the SELF-CONTAINED relative contract, not merely the filename: the old
  // `<plugin root>/scripts/lib/md-checks.mjs` form also contained 'md-checks.mjs'
  // and passed, so the loose check protected nothing. The skill folder travels
  // alone (claude.ai ZIP / standalone consumer) where no plugin root exists.
  if (sk.includes('./lib/md-checks.mjs')) ok('doc-structure invokes the engine by its self-contained relative path (./lib/md-checks.mjs)');
  else fail('doc-structure must invoke ./lib/md-checks.mjs — a <plugin root>/ or ../ path breaks the skill when the folder travels alone');
} catch (e) { fail(`doc-structure engine wiring: ${e.message}`); }

// board #64: this cap lived in the skills/commands FRONTMATTER checks only, so
// .claude-plugin/plugin.json's own description field could silently exceed 1024 —
// CoalLedger shipped one at 1067 chars before a human eye caught it (since
// tightened to 1019/1024 by hand at board #59, but that fix predated any
// automated check). plugin.json is plain JSON, not YAML frontmatter, so this
// reads the field directly rather than through frontmatterField; DESC_CAP is
// the same constant defined above, never redefined. A truthy NON-STRING
// description (a number, an object, an array) fails loud instead of silently
// stringifying to length 0 and passing.
console.log('description length cap (plugin.json):');
{
  const pluginJsonPath = path.join(repo, '.claude-plugin', 'plugin.json');
  try {
    let raw = fs.readFileSync(pluginJsonPath, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // BOM-strip, same idiom as the factory-config read below
    const pj = JSON.parse(raw);
    if (pj.description === undefined || pj.description === null || pj.description === '') {
      fail('.claude-plugin/plugin.json: description missing');
    } else if (typeof pj.description !== 'string') {
      fail(`.claude-plugin/plugin.json: description is not a string (got ${typeof pj.description})`);
    } else if (pj.description.length > DESC_CAP) {
      fail(`.claude-plugin/plugin.json: description ${pj.description.length} chars exceeds the ${DESC_CAP}-char cap`);
    } else {
      ok(`.claude-plugin/plugin.json: ${pj.description.length} chars (cap ${DESC_CAP})`);
    }
  } catch (e) { fail(`.claude-plugin/plugin.json description check: ${e.message}`); }
}

console.log('version pins (.github issue templates):');
try {
  const pj = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8'));
  const tplDir = path.join(repo, '.github', 'ISSUE_TEMPLATE');
  let pins = 0;
  for (const name of fs.readdirSync(tplDir)) {
    const text = fs.readFileSync(path.join(tplDir, name), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.includes('version-pin:')) continue;
      pins++;
      if (line.includes(`v${pj.version}`)) ok(`${name} version-pin quotes v${pj.version}`);
      else fail(`${name} version-pin line does not quote current v${pj.version}`);
    }
  }
  if (!pins) fail('no version-pin marker found in .github/ISSUE_TEMPLATE (expected in bug-report.yml)');
} catch (e) { fail(`version pins: ${e.message}`); }

console.log('config (factory vs schema):');
try {
  let c = fs.readFileSync(path.join(repo, 'platform-configs', '.coalledger.json'), 'utf8');
  if (c.charCodeAt(0) === 0xFEFF) c = c.slice(1);
  const cfg = JSON.parse(stripJsonc(c));
  const errors = validateConfig(cfg);
  if (!errors.length) ok('factory .coalledger.json valid against schema');
  else errors.forEach(fail);
  // Layer 3: the factory template carries EVERY key at its default.
  for (const spec of CONFIG_SCHEMA) {
    if (!(spec.key in cfg)) fail(`factory template missing key '${spec.key}'`);
    else if (JSON.stringify(cfg[spec.key]) !== JSON.stringify(spec.def)) fail(`factory '${spec.key}' = ${JSON.stringify(cfg[spec.key])} but schema default is ${JSON.stringify(spec.def)}`);
  }
  if (CONFIG_SCHEMA.every((s) => s.key in cfg && JSON.stringify(cfg[s.key]) === JSON.stringify(s.def))) ok('factory template carries every schema key at its default');
} catch (e) { fail(`factory config: ${e.message}`); }

// config-key drift (CWK-060, ported from CoalMine's CWK-059): every config
// key NAMED on a user-facing surface must RESOLVE in config-schema.mjs, or
// be declared in PENDING_KEYS / NOT_CONFIG / BLIND_KEYS (config-keys.mjs).
// Born from CoalMine's own CWK-054 MEDIUM and this room's own CWK-057
// residue (scanEverything landed correctly-clamped while nothing yet read
// it) -- the same drift class from opposite directions.
//
// SCOPE DERIVATION, stated rather than implied (AGENTS.md, THE
// MEASUREMENT'S OWN FOURTH TENSE): mdFiles is SKILLS + README.md, both
// already this file's own existing rosters (SKILLS above; this room has no
// listSkills() walk the way CoalMine does, so a new skill dir joins SKILLS
// at the top of this file the same way it already must for every other
// check here -- not a new roster this gate invents). hookFiles is WALKED
// via readdirSync, so a new hook is covered the day it lands with no
// roster to keep complete. What neither reaches is stated in
// config-keys.mjs's own surface list, with the measurement behind each
// exclusion. Source only; plugin/ twins are byte-identical by the dist
// check below, so scanning them would double every finding.
console.log('config keys:');
try {
  const skillMd = SKILLS.map((s) => path.join('skills', s, 'SKILL.md'));
  skillMd.push('README.md');
  const hooksDir = path.join(repo, 'hooks');
  const hookJs = (fs.existsSync(hooksDir) ? fs.readdirSync(hooksDir) : [])
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join('hooks', f));
  const findings = checkConfigKeys({
    schemaKeys: CONFIG_SCHEMA.map((e) => e.key),
    mdFiles: skillMd,
    hookFiles: hookJs,
    read: (f) => fs.readFileSync(path.join(repo, f), 'utf8'),
    // This room's own key table: a first cell there is a key CLAIM
    // regardless of shape. Region-bounded on the '## 🔧 Configure' heading
    // (a substring match, emoji-agnostic) — measured: 11/11 rows resolve,
    // zero false positives, the Commands table (which precedes Configure
    // in this README) falls outside by construction.
    keyTables: [{ file: 'README.md', heading: 'Configure' }],
  });
  const hard = findings.filter((f) => f.level !== 'SKIP');
  // The pass line is QUALIFIED when the gate has declared blind spots: an
  // unqualified "every config key ... resolves" is false while a declared
  // key is being read and discarded.
  const blindSkips = findings.filter((f) => f.level === 'SKIP' && f.msg.startsWith('blind to'));
  const scope = blindSkips.length ? 'every DETECTABLE config key' : 'every config key';
  if (hard.length === 0) ok(`${scope} named across ${skillMd.length} doc + ${hookJs.length} hook surfaces resolves in the schema`);
  for (const f of findings) {
    if (f.level === 'SKIP') console.log('  --   ' + f.msg);
    else fail(f.msg);
  }
} catch (e) { fail(`config-key check crashed: ${e.message}`); }

// config read-path (CWK-064): ONE CONFIG-READ PATH PER ROOM -- no key is
// read from a BARE project config file, by hook or by agent instruction;
// every read goes through the global+project merge. Owner-authorised as
// flock convention without a sheet press. SCOPE, deliberately WIDER than
// the config-key check above: skills/*/SKILL.md + README.md +
// commands/*.md -- see config-keys.mjs's own header for the full
// surface-set reasoning (hooks/*.js is OUT here, unlike above -- a hook's
// notice text is read by the USER, never consulted by the AGENT as an
// instruction).
console.log('config read-path (one path per room):');
try {
  const mdFiles = SKILLS.map((s) => path.join('skills', s, 'SKILL.md'));
  mdFiles.push('README.md');
  const commandsDir = path.join(repo, 'commands');
  for (const f of fs.readdirSync(commandsDir).filter((n) => n.endsWith('.md'))) {
    mdFiles.push(path.join('commands', f));
  }
  const findings = checkConfigReadPath({
    schemaKeys: CONFIG_SCHEMA.map((e) => e.key),
    mdFiles,
    read: (f) => fs.readFileSync(path.join(repo, f), 'utf8'),
  });
  const hard = findings.filter((f) => f.level !== 'SKIP');
  if (hard.length === 0) ok(`every config-key mention beside .coalledger.json across ${mdFiles.length} surfaces names the global+project cascade, or is a declared exception`);
  for (const f of findings) {
    if (f.level === 'SKIP') console.log('  --   ' + f.msg);
    else fail(f.msg);
  }
} catch (e) { fail(`config read-path check crashed: ${e.message}`); }

// 2.12 POINTER gate (CWK-075) — ship-text naming something unreachable from a clone.
// DATA, never logic: every input below is derived from THIS tree. The module itself is
// CoalMine's, ported unchanged; what differs per room is exactly these derivations.
console.log('pointers (reachable from a clone):');
try {
  const lsAll = spawnSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' });
  if (lsAll.error || lsAll.status !== 0) {
    // SKIP, NOT FAIL — and this is a PORT DEFECT found by this room's own fixture
    // tests, not by reading. The exemplar FAILs here; its wiring assumes git is always
    // reachable. This room's verify.test.mjs copies part of the tree into a temp dir
    // that is NOT a git repo, so the gate could not answer and CONVICTED a pristine
    // fixture — a gate that cannot run must never convict, which is the same rule the
    // module already applies to an unreadable surface and to declaration-pruning on a
    // partial scan. The SKIP is VISIBLE, so a genuinely broken git in CI shows as a
    // gate that did not run rather than as a silent pass.
    console.log('  --   pointer check SKIPPED: git ls-files unavailable, so reachability cannot be answered here (not a pass)');
  } else {
    const tracked = new Set(lsAll.stdout.split('\n').filter(Boolean));
    const trackedDirs = new Set();
    for (const f of tracked) {
      const parts = f.split('/');
      for (let i = 1; i < parts.length; i++) trackedDirs.add(parts.slice(0, i).join('/'));
    }

    // AGENT-HOME ROOTS (CWK-078) — DERIVED from this room's own cascade candidate
    // order, never hand-written, so the set cannot rot the day that order changes.
    // Held out of the ignored-roots question BELOW, before it is asked — same
    // shape as CoalWash's and CoalHearth's own verify.mjs (read-only references).
    //
    // THE AXIS CORRECTION: this used to be an empty set derived from "this room
    // ships no installer" — the WRONG AXIS. Gitignored HERE says nothing about
    // the USER's tree; an installer WRITES into a user's tree, but this gate is
    // asking what the tool READS a key FROM in one, which needs no installer at
    // all. `.claude/` `.agents/` `.gemini/` are gitignored HERE (this room's own
    // scratch/audit homes) AND are the exact project-config paths README.md's own
    // Configure section names for the CASCADE (`.claude/coal/coalledger.json`,
    // config-load.mjs's own AGENT_DIR_ORDER) — one path, two meanings, and the
    // empty set could not tell them apart. Confirmed live: with agentHomes empty
    // and the feed widened to all top-level entries (below), README.md:103's
    // `.claude/coal/coalledger.json` citation FAILs as unreachable — a correct
    // ship-text sentence convicted by a gate that had never been asked to hold
    // its own agent homes out.
    // REALPATH THE COMPARE (CWK-078 findings-back MED-1): `projectConfigCandidates`
    // resolves its root through `findProjectRoot` -> `physicalDir` -> `fs.realpathSync`
    // (config-load.mjs's own header: "compares PHYSICAL paths on both sides ... a
    // lexical compare never matches and the walk escapes"). `repo` above is LEXICAL
    // (`path.resolve`, never realpathed) — comparing it against a realpathed candidate
    // via `path.relative` disagrees the moment the repo is REACHED through a symlink or
    // Windows junction: every candidate then relatives to a `..`-prefixed path, the
    // `startsWith('..')` filter drops all four, and agentHomes comes back EMPTY --
    // which is red (a), the gate FAILing nine correct ship-text sentences it exists to
    // protect. Realpath `repo` here so both sides of the compare are physical, the same
    // discipline this room's own config-load.mjs header already states for exactly this
    // shape one file over.
    const physRepo = physicalDir(repo);
    const agentHomes = new Set();
    for (const c of projectConfigCandidates(repo, os.homedir())) {
      const r = path.relative(physRepo, c).split(path.sep).join('/');
      if (!r || r.startsWith('..') || path.isAbsolute(r) || !r.includes('/')) continue;
      const first = r.split('/')[0];
      // FIFTH FILTER, NAMED (CWK-078 findings-back LOW-2): AGENT_DIR_ORDER entries are
      // dot-dirs today (.claude/.agents/.gemini), so this additionally drops any FUTURE
      // non-dot agent-dir name from agentHomes -- safe direction (a false FAIL surfaces
      // it, never a silent pass), but stated here so it is a DECLARED fifth filter, not
      // an undocumented one riding along with the four above it.
      if (first.startsWith('.') && first.length > 1) agentHomes.add(first);
    }

    // THE FULL TOP-LEVEL ENUMERATION (CWK-078 half 1) — FILES AND HIDDEN DIRS
    // INCLUDED, filtered only on '.git'. WHAT THIS WIDENING ACTUALLY BUYS,
    // corrected (CWK-078 findings-back MED-4): the prior shape (tracked roots plus
    // non-hidden top-level DIRECTORIES) missed this room's gitignored DOT-DIRS
    // (.claude, .agents, .gemini) — a real citation into one, README.md:103's
    // `.claude/coal/coalledger.json`, was silently unreachable by the ignoredRoots
    // question because a dot-dir was never even fed to `git check-ignore`. A bare
    // gitignored top-level FILE (CLAUDE.md, MEMORY*.md, AGENTS.md,
    // COALLEDGER_BLUEPRINT.md) was never actually at risk either way, before or
    // after this widening: `pointerCandidates`' own shape rule drops every token
    // with no `/` LONG before `ignoredRoots` is ever consulted
    // (pointer-check.mjs:335 — "a bare filename is the USER's repo's"), so a
    // citation shaped like a bare file can never reach this branch. The dot-dir
    // reach is real and load-bearing; the file half was never reachable to begin
    // with. Read-only reference for the shape: CoalWash/scripts/verify.mjs's own
    // `topAll`.
    const topAll = fs.readdirSync(repo, { withFileTypes: true }).map((e) => e.name).filter((n) => n !== '.git');
    const ourRoots = new Set(topAll);
    for (const f of tracked) ourRoots.add(f.split('/')[0]);
    // `ignoredRoots` no longer derives from `topAll` (CWK-079, below, after `surfaces`
    // exists) -- `ourRoots` above is a SEPARATE SCOPE test (does this first segment
    // belong to our own tree at all) and stays disk-derived; only the IGNORE question
    // moved to pattern-based.

    // SURFACE PLAN, DECLARED (CWK-090 fix 3) -- what this block used to hard-code as two
    // walkAny-and-concatenate loops (skills+commands, scripts+hooks) is now DATA
    // (`DEFAULT_SURFACE_PLAN`, pointer-check.mjs), driven here with THIS room's own fs
    // IO. Behaviour is BYTE-IDENTICAL to the loops it replaces: same surfaces, same
    // order, same labels, same comment-line filter -- proven by a before/after
    // fingerprint diff at commit time, not merely asserted here (see the commit message
    // this ships in).
    const rel = (q) => path.relative(repo, q).split(path.sep).join('/');
    const read = (q) => { try { return fs.readFileSync(q, 'utf8'); } catch { return null; } };
    const walkMd = (dir, out = []) => {
      if (!fs.existsSync(dir)) return out;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walkMd(p, out);
        else if (e.name.endsWith('.md')) out.push(p);
      }
      return out;
    };
    const walkSrc = (dir, keep = (n) => /\.(mjs|js)$/.test(n), out = []) => {
      if (!fs.existsSync(dir)) return out;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walkSrc(p, keep, out);
        else if (keep(e.name)) out.push(p);
      }
      return out;
    };
    const commentLines = (src) => src.split('\n').filter((l) => /^\s*(\/\/|\*)/.test(l)).join('\n');
    const hashComments = (src) => src.split('\n').filter((l) => /^\s*#/.test(l)).join('\n');
    const surfaces = collectSurfaces(repo, DEFAULT_SURFACE_PLAN, {
      join: path.join, walkMd, walkSrc, read, rel, commentLines, hashComments,
    });

    // SURFACE ACCOUNTING (CWK-078) — walked (the surfaces array above) plus
    // DECLARED-OUT (named classes this gate deliberately never reads) must
    // reconcile against `git ls-files`'s own tracked count, or a class of file
    // is silently uncovered on BOTH sides — CoalMine's own find was 28 tracked
    // files in neither list. Every class below is named with why it is out, not
    // merely counted; each predicate runs over `tracked` at run time, so the
    // count can never drift from what the tree actually holds.
    const declaredOutClasses = [
      ['plugin/** (generated dist, byte-identical to source per the header above)', (f) => f.startsWith('plugin/')],
      ['.github/** (CI/workflow YAML, not ship-text)', (f) => f.startsWith('.github/')],
      ['.githooks/** (git hook scripts, not ship-text)', (f) => f.startsWith('.githooks/')],
      // LOW-3 (CWK-078 findings-back): plugin.json's own `description` field IS
      // 1,019 chars of user-facing prose -- "not prose" overclaimed. The true
      // reason it is out here: verify.mjs's own DESC_CAP check already gates that
      // field elsewhere in this file (0 pointer candidates in it today, so no live
      // gap either way), not that the surface is non-prose.
      ['.claude-plugin/** (JSON manifest -- its own description field is gated separately by this file\'s DESC_CAP check, not by this gate)', (f) => f.startsWith('.claude-plugin/')],
      ['platform-configs/** (config JSON, not prose)', (f) => f.startsWith('platform-configs/')],
      ['hooks/hooks.json (JSON manifest, not prose)', (f) => f === 'hooks/hooks.json'],
      ['scripts/fixtures/*.md (planted-defect test fixtures, not real ship-text)', (f) => f.startsWith('scripts/fixtures/')],
      ['root non-doc files (LICENSE, NOTICE, lint/git config)', (f) => ['LICENSE', 'NOTICE', '.markdownlint.json', '.gitignore', '.gitattributes'].includes(f)],
    ];
    let declaredOutCount = 0;
    const residueFiles = [];
    for (const f of tracked) {
      if (declaredOutClasses.some(([, test]) => test(f))) { declaredOutCount++; continue; }
      if (!surfaces.some((s) => s.label === f)) residueFiles.push(f);
    }
    console.log(`  --   surfaces: ${surfaces.length} walked + ${declaredOutCount} declared-out = ${surfaces.length + declaredOutCount} of ${tracked.size} tracked, residue ${residueFiles.length}${residueFiles.length ? ' (' + residueFiles.join(', ') + ')' : ''}`);
    // LOW-4 (CWK-078 findings-back): the accounting above DETECTED but did not
    // ENFORCE -- residueFiles was computed and printed with nothing calling
    // fail(), so a new tracked file landing in neither `surfaces` nor a declared
    // class (CoalMine's own motivating find: 28 such files) would print on one
    // line and still exit 0. Enforce it: a nonzero residue is a gap in this
    // gate's own coverage bookkeeping, not merely a diagnostic.
    if (residueFiles.length) fail(`pointer-gate surface accounting: ${residueFiles.length} tracked file(s) covered by neither a walked surface nor a declared-out class — ${residueFiles.join(', ')}`);

    // IGNORED ROOTS, PATTERN-BASED (CWK-079, ported from CoalMine's own CWK-079) —
    // asked of the CANDIDATES actually cited in ship-text, never of what EXISTS on this
    // disk. THE DEFECT THIS CLOSES, and it is CWK-078's own admission made to actually
    // work: the prior `topAll`-derived `ignoredRoots` could only ever probe a name that
    // physically existed as a top-level entry on THIS box, so it read structurally 0 on
    // every fresh clone and every CI leg — CoalBoard measured this directly (28 fed / 7
    // ignored on a maintainer box against 21 fed / 0 ignored in CI) and this room hit it
    // too: `.gitignore` lists a gitignored claude.ai ZIP-staging directory that does not
    // exist on this box right now, so the old disk-derived probe could never see a real
    // citation into it. `.gitignore` is TRACKED, so `git check-ignore` answers for an
    // ABSENT path exactly as it would for a present one — the PATTERN is what matters,
    // never the directory listing.
    //
    // MUST run AFTER `surfaces` exists — the candidates this probe needs are not
    // assembled until here.
    //
    // SHAPE-FILTERED AT DISCOVERY, never at judgement (`looksPathShaped`,
    // pointer-check.mjs — read that function's own comment for the NON-LOCAL residue
    // this narrowing carries; `checkPointers` below judges every token that DOES reach
    // it regardless of shape, so narrowing here only decides which roots ENTER the set).
    //
    // INJECTION-SITE PROBE (CWK-090 fix 2, ported from CoalFace's finding, main-ruled the
    // ONE shape, box-independent) — RETIRES the bare `first + '/'` feed this block used
    // to send. Every candidate reaching this probe passed `looksPathShaped`, so its first
    // segment is being treated as a directory, and `git check-ignore` cannot infer that
    // an ABSENT path is meant as a directory without SOME suffix under it — that half of
    // the old TRAILING SLASH reasoning stays true. What changed is WHICH suffix: a bare
    // root plus a trailing slash (deliberately not backticked here — this comment is
    // itself a WALKED surface, and a real slash-terminated example would manufacture a
    // shape-qualified candidate) is exactly the shape a CRLF-corrupted `.gitignore`
    // blank line false-matches against (this room's own CWK-079 findings-back exhibit,
    // below); appending `PROBE_SUFFIX` — a path UNDER the root, not the bare root —
    // carries the identical "is this a directory" information without ever matching
    // that corrupted-blank-line shape.
    //
    // FINDINGS-BACK, self-caught, CWK-079 — THIS ROOM'S OWN EXHIBIT, kept because fix 2
    // does not erase the history, it retires the workaround: this box's working-tree
    // `.gitignore` carried CRLF line endings on a "blank" separator line, which made
    // `git check-ignore --stdin` report EVERY fed name as ignored against that blank
    // line the moment a trailing slash was appended. That checkout was fixed at the time
    // (`git hash-object .gitignore` == `git rev-parse HEAD:.gitignore`, still true today,
    // nothing to commit) and stays fixed — CWK-090 fix 2 does NOT license re-introducing
    // a CR into this working tree, and does not remove the normalization. What fix 2
    // adds is the fix CoalMine's own reviewer measured for the CASE that survives even a
    // clean checkout: a lone-CR blank line that CoalMine independently reproduced still
    // false-matches an ABSENT, unpatterned root under the bare `root/` feed on THEIR
    // tree — this room's fix landed first and closed the local corruption; CoalMine's
    // finding is that the CLASS needed the code-side fix too, not only a clean checkout,
    // so `.pointer-check-probe` closes it structurally rather than depending on every
    // future checkout staying clean.
    //
    // BATCHED, one process for every distinct first segment actually cited, not one per
    // topAll entry — replaces the CWK-078 per-name spawn loop with a single
    // `--stdin` call.
    const candidateRoots = new Set();
    for (const s of surfaces) {
      if (typeof s.text !== 'string') continue;
      for (const tok of pointerCandidates(s.text)) {
        if (!looksPathShaped(tok)) continue;
        candidateRoots.add(tok.split('/')[0]);
      }
    }
    let homesPresent = 0;
    const toProbe = [];
    for (const name of candidateRoots) {
      if (agentHomes.has(name)) { homesPresent++; continue; }
      toProbe.push(name);
    }
    // PROBE SUFFIX (CWK-090 fix 2): a path UNDER the root, not the bare root — see the
    // INJECTION-SITE PROBE comment above for why the bare-root feed is retired. Since
    // CWK-092 flow-back 3 this gate no longer declares or imports the literal —
    // `applyCheckIgnoreProbe`'s own `probeSuffix` parameter DEFAULTS to
    // pointer-check.mjs's exported `PROBE_SUFFIX`, so this call site cannot hold a copy
    // that drifts from what it actually probes with.
    //
    // FAIL-OPEN, CLOSED (CWK-090 fix 1, ported from CoalMine, in substance shipped by us
    // first at `94e994f` and independently found+fixed the same way at CoalMine, with
    // CoalTipple carrying the same shape too). WIRING moved into `applyCheckIgnoreProbe`
    // (pointer-check.mjs, CWK-090's own reason: a unit test now drives this exact branch
    // with an injected `runCheckIgnore`, not a duplicated copy). Exit 0 and exit 1 both
    // SUCCEED (1 = "none of the fed paths are ignored", not an error); any OTHER status
    // (128 included -- a bad pattern, an unreadable `.gitignore`, a broken worktree) or a
    // genuine spawn error means the run answered NOTHING, and silently continuing with an
    // empty ignored-roots set would print a git-derived count over a run that derived no
    // facts at all. PROVEN on this tree, red-first: mutating the pre-DI inline guard to
    // `if (false)` left this room's OWN suite byte-identically green at 266/266 (recorded
    // before this fix landed) — nothing tied the classification to the gate; the same
    // mutation applied to the DI'd call below reddens the suite (see the commit this
    // ships in for the exact assertion and line). The Set is now RETURNED (CWK-092
    // flow-back 3) rather than mutated in place -- this call site consumes it, it does
    // not own it.
    const ignoredRoots = applyCheckIgnoreProbe({
      toProbe, fail,
      runCheckIgnore: (input) => spawnSync('git', ['check-ignore', '--stdin'], { cwd: repo, encoding: 'utf8', input }),
    });
    // NAMED BOUND -- FOREIGN-NAME COLLISION (CWK-079, ported). `candidateRoots` is fed
    // from every CITED first segment, unlike the disk-derived shape it replaces, which
    // could only ever contain a name that physically existed as a top-level entry in
    // OUR OWN repo listing. That bound is gone: a citation describing ANOTHER project's
    // tree (this room's own docs cite CoalMine's directory names in compare/contrast
    // prose — `benchmarks`, `docs`, `fixtures`, `lib`, `references`, `doc-standard`,
    // `doc-structure` all reach `candidateRoots` today) now probes that name against OUR
    // `.gitignore`, and if a future pattern of ours happens to share it, the citation
    // FAILs as "not reachable from a clone" although it was never ours to be wrong
    // about. MEASURED ON THIS TREE (re-derive: partition `candidateRoots` against
    // `topAll ∪ tracked ∪ trackedDirs`): 25 distinct shape-qualified first segments
    // cited, of which 15 are neither an on-disk top-level entry nor a tracked path of
    // ours — a real, nonzero foreign-name-collision population, not a hypothetical. Of
    // those 15, the ones that could ACTUALLY collide are only the ones matching a real
    // `.gitignore` pattern; the live pass line below states how many of THIS run's
    // `toProbe` actually came back gitignored -- MEASURED TODAY: ZERO (0 of 22 probed),
    // after the working-tree `.gitignore` corruption above was fixed. Re-derive, never
    // quote: the pass line prints this every run. No narrowing is added for this
    // population — an existence- or ourRoots-based test would re-open the exact
    // vacuity this ticket was built to close (it would specifically re-exclude the
    // claude.ai staging dir this room already depends on catching).
    console.log(`  --   gitignored-root citations: ${candidateRoots.size} distinct first segment(s) shape-qualified and cited, ${toProbe.length} probed through one git check-ignore call (${homesPresent} of ${agentHomes.size} agent-home roots held out) — ${ignoredRoots.size} gitignored`);

    const findings = checkPointers({
      surfaces,
      ourRoots,
      ignoredRoots,
      agentHomes,
      hasEntry: (relDir, name) => {
        try { return fs.existsSync(path.join(repo, relDir, name)); } catch { return false; }
      },
      resolve: (q) => (tracked.has(q) || trackedDirs.has(q) ? 'tracked'
        : fs.existsSync(path.join(repo, q)) ? 'untracked' : 'missing'),
    });
    const hard = findings.filter((f) => f.level !== 'SKIP');
    if (hard.length === 0) {
      ok(`every path this repo points at from ${surfaces.length} surfaces (${findings.checked} in-scope citations) resolves to a TRACKED file — sections and symbols are NOT checked, see scripts/lib/pointer-check.mjs`);
    }
    for (const f of findings) {
      if (f.level === 'SKIP') console.log('  --   ' + f.msg);
      else fail(f.msg);
    }
  }
} catch (e) { fail(`pointer check crashed: ${e.message}`); }

console.log('libs (import check):');
for (const l of LIBS) {
  try { await import(pathToFileURL(path.join(repo, 'scripts', 'lib', l)).href); ok(`${l} imports`); }
  catch (e) { fail(`${l}: ${e.message}`); }
}

console.log('engine smoke (fixtures ground truth):');
try {
  const { checkDocument } = await import(pathToFileURL(path.join(repo, 'scripts', 'lib', 'md-checks.mjs')).href);
  const decoy = path.join(repo, 'scripts', 'fixtures', 'decoy-clean.md');
  const fp = checkDocument(fs.readFileSync(decoy, 'utf8'), { filePath: decoy }).length;
  if (fp === 0) ok('decoy-clean.md yields 0 findings (anti-cry-wolf holds)');
  else fail(`decoy-clean.md yields ${fp} findings — the engine cry-wolfs`);
  const defects = path.join(repo, 'scripts', 'fixtures', 'defects-structure.md');
  const n = checkDocument(fs.readFileSync(defects, 'utf8'), { filePath: defects }).length;
  if (n >= 11) ok(`defects-structure.md yields ${n} findings (planted defects detected)`);
  else fail(`defects-structure.md yields only ${n} findings (expected >= 11)`);
} catch (e) { fail(`engine smoke: ${e.message}`); }

console.log('plugin/ dist (the clean CC plugin vs source SSoT):');
try {
  const { checkDist } = await import(pathToFileURL(path.join(repo, 'scripts', 'build-plugin.mjs')).href);
  const drift = checkDist();
  if (!drift.length) ok('plugin/ matches source (manifest + commands + hooks + skills + scripts/lib); nothing else leaked');
  else for (const d of drift) fail(d);
} catch (e) { fail(`plugin/ dist check: ${e.message}`); }

console.log(fails ? `\nVERIFY: FAIL (${fails})` : '\nVERIFY: PASS');
// CWK-071: `process.exit()` truncates pending stdout writes (node/runtime.md §7) --
// CoalBoard's own scripts/verify.mjs (READ-ONLY reference) already ships the correct
// shape for a fail-loud CLI gate: set `process.exitCode` and let the process exit
// naturally, never force it. No runtime truncation was ever reproduced from the old
// `process.exit(fails ? 1 : 0)` here -- this is a conformance fix (scripts-quality.md
// §1 fail-loud still holds via the exit CODE; hooks-safety.md §1.0's CLI row was never
// about truncation risk for a CLI, only node/runtime.md §7's own "never call
// process.exit()" rule, which binds every surface, CLI included), not a bug reproduced
// on this tree. SCOPE, named so "binds every surface" is never read as already
// satisfied here: this unit closes ONLY this call site. Eight more `process.exit()`
// sites remain unfixed in this room's own `scripts/` (build-plugin.mjs, configure.mjs
// x4, test.mjs x3 -- re-derive via `grep -rn "process.exit(" scripts/*.mjs`, never
// trust this count forward) and the other 5 flock rooms are untouched -- both out of
// scope for CWK-079, not silently closed.
if (fails) process.exitCode = 1;
