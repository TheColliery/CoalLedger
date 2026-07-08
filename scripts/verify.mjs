#!/usr/bin/env node
// CoalLedger verify gate — fail LOUD if the factory config drifts from the
// schema, required files are missing/malformed, a lib fails to import, the
// pilot skill's frontmatter is wrong, or the plugin/ dist is stale. Wrapped
// per-check so one bad input yields a clean FAIL line, not a stack trace
// (scripts-quality.md: CLI = fail loud).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIG_SCHEMA, validateConfig } from './lib/config-schema.mjs';
import { stripJsonc } from './lib/jsonc.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { console.log(`  FAIL ${m}`); fails++; };

const LIBS = [
  'md-ast.mjs', 'md-checks.mjs',
  'config-schema.mjs', 'config-load.mjs', 'jsonc.mjs',
];

// The full 6+1 canary set (blueprint §1 + §8) — every entry must ship a SKILL.md.
const SKILLS = ['doc-structure', 'doc-grounding', 'doc-standard', 'doc-rot', 'doc-consistency', 'doc-quality', 'doc-leak'];

console.log('files:');
for (const [label, p] of [
  ['hooks/coalledger-conductor.js', path.join(repo, 'hooks', 'coalledger-conductor.js')],
  ['hooks/hooks.json', path.join(repo, 'hooks', 'hooks.json')],
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
} catch (e) { fail(`plugin manifest: ${e.message}`); }

console.log('marketplace.json:');
try {
  const mj = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'marketplace.json'), 'utf8'));
  if (mj.plugins?.[0]?.source === './plugin') ok('marketplace.json points at ./plugin');
  else fail(`marketplace.json plugins[0].source = '${mj.plugins?.[0]?.source}' (want './plugin')`);
  if (mj.plugins?.[0]?.version === undefined) ok('marketplace entry carries no version (plugin.json is the SSoT)');
  else fail('marketplace entry sets a version — remove it (plugin.json is the only version home)');
} catch (e) { fail(`marketplace.json: ${e.message}`); }

console.log('skills (frontmatter contract, all 6+1):');
for (const name of SKILLS) {
  try {
    const sk = fs.readFileSync(path.join(repo, 'skills', name, 'SKILL.md'), 'utf8');
    const fm = /^---\n([\s\S]*?)\n---/.exec(sk);
    if (!fm) { fail(`${name}: no frontmatter block`); continue; }
    if (new RegExp(`^name:\\s*${name}\\s*$`, 'm').test(fm[1])) ok(`${name}: frontmatter name matches its dir`);
    else fail(`${name}: frontmatter name does not match its dir`);
    const desc = /description:\s*>-?\n([\s\S]*?)(?:\n[a-zA-Z]|$)/.exec(fm[1]);
    const len = desc ? desc[1].length : 0;
    if (len > 0 && len <= 1536) ok(`${name}: description ${len} chars (<= 1536 cap)`);
    else fail(`${name}: description ${len} chars (cap 1536, must be > 0)`);
    if (sk.includes('github.com/TheColliery/CoalLedger/issues')) ok(`${name}: carries the problem-report offer`);
    else fail(`${name}: missing the problem-report offer (standard system #4)`);
  } catch (e) { fail(`${name}: ${e.message}`); }
}
try {
  const sk = fs.readFileSync(path.join(repo, 'skills', 'doc-structure', 'SKILL.md'), 'utf8');
  if (sk.includes('md-checks.mjs')) ok('doc-structure wires the shipped engine (md-checks.mjs)');
  else fail('doc-structure never mentions the engine it must run');
} catch (e) { fail(`doc-structure engine wiring: ${e.message}`); }

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
