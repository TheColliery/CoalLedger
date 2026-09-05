#!/usr/bin/env node
// CoalLedger verify gate — fail LOUD if the factory config drifts from the
// schema, required files are missing/malformed, a lib fails to import, the
// pilot skill's frontmatter is wrong, or the plugin/ dist is stale. Wrapped
// per-check so one bad input yields a clean FAIL line, not a stack trace
// (scripts-quality.md: CLI = fail loud).

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIG_SCHEMA, validateConfig } from './lib/config-schema.mjs';
import { stripJsonc } from './lib/jsonc.mjs';
import { DESC_CAP, frontmatterField } from './lib/desc-cap.mjs';
import { checkPointers } from './lib/pointer-check.mjs';
import { checkConfigKeys, checkConfigReadPath } from './lib/config-keys.mjs';

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
    const ourRoots = new Set();
    for (const f of tracked) ourRoots.add(f.split('/')[0]);
    for (const e of fs.readdirSync(repo, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.')) ourRoots.add(e.name);
    }
    // ASKED OF GIT, never parsed out of .gitignore — a re-implementation of gitignore
    // matching would be the second source of truth this gate exists to catch.
    //
    // ROOM-SPECIFIC FINDING, stated because the ported derivation is NARROWER here than
    // it looks: this room gitignores CLAUDE.md, MEMORY*.md, AGENTS.md,
    // COALLEDGER_BLUEPRINT.md (top-level FILES, not dirs) and .claude/ .agents/ (HIDDEN
    // dirs). The loop below adds only non-hidden top-level DIRECTORIES plus tracked
    // roots, so ignoredRoots measures EMPTY today — and a citation into .claude/ falls
    // out of scope silently rather than FAILing, because .claude is not in ourRoots
    // either. For CoalMine that is correct: .claude/ is an agent home in the USER's tree.
    // For us it is BOTH — the agent home AND where this room's own gitignored audit
    // artefacts live. Same path, opposite meaning, and the ported rule cannot tell them
    // apart from the token alone. Named as an uncovered class, not silently inherited.
    const ignoredRoots = new Set();
    for (const name of ourRoots) {
      if (tracked.has(name) || trackedDirs.has(name)) continue;
      const ci = spawnSync('git', ['check-ignore', '-q', '--', name], { cwd: repo, encoding: 'utf8' });
      if (!ci.error && ci.status === 0) ignoredRoots.add(name);
    }
    const walkAny = (dir, re, out = []) => {
      if (!fs.existsSync(dir)) return out;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const q = path.join(dir, e.name);
        if (e.isDirectory()) walkAny(q, re, out);
        else if (re.test(e.name)) out.push(q);
      }
      return out;
    };
    const relp = (q) => path.relative(repo, q).split(path.sep).join('/');
    const read = (q) => { try { return fs.readFileSync(q, 'utf8'); } catch { return null; } };
    const surfaces = [];
    for (const f of [...walkAny(path.join(repo, 'skills'), /\.md$/), ...walkAny(path.join(repo, 'commands'), /\.md$/)]) {
      surfaces.push({ label: relp(f), text: read(f) });
    }
    for (const d of ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'PRIVACY.md']) {
      surfaces.push({ label: d, text: read(path.join(repo, d)) });
    }
    // COMMENT LINES ONLY: a path inside CODE is exercised by the tests; a path inside a
    // COMMENT is exercised by nothing at all.
    for (const f of [...walkAny(path.join(repo, 'scripts'), /\.(mjs|js)$/), ...walkAny(path.join(repo, 'hooks'), /\.(mjs|js)$/)]) {
      const src = read(f);
      surfaces.push({ label: relp(f), text: src === null ? null : src.split('\n').filter((l) => /^\s*(\/\/|\*)/.test(l)).join('\n') });
    }
    surfaces.push({ label: 'CHANGELOG.md', text: read(path.join(repo, 'CHANGELOG.md')), historyOnly: true });

    // AGENT INSTALL HOMES — and this room has NO TARGETS map to derive one from, which is
    // itself the finding rather than a reason to hand-write a list. CoalMine derives its
    // set from scripts/lib/targets.mjs because it ships an installer that WRITES into a
    // user's tree; this room ships no installer at all (no scripts/install.mjs — its
    // cross-agent path is a documented file copy). Its two documented destinations are
    // ~/.gemini/config/skills/ and ~/.claude/, both HOME-anchored, and both are already
    // dropped upstream by the module's OUTSIDE shape test. So the correct value here is
    // the EMPTY SET, derived from the absence of an installer rather than asserted, and
    // the day this room ships one the set must come from that installer's own map.
    const agentHomes = new Set();
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
process.exit(fails ? 1 : 0);
