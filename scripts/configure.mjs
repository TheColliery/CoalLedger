// CoalLedger configurator — edit .coalledger.json from the command line.
// Flags, parsing, validation, and help all come from one table
// (scripts/lib/config-schema.mjs, shared with verify.mjs): a key added there
// is automatically settable, validated, and documented here.
//
// Ported from CoalMine's scripts/configure.mjs (CWK-023, owner-signed ใบ D —
// configure.mjs is now a flock standard: config must be CLI-settable, not
// merely documented, per the 5-standard-systems requirement). Same SHAPE,
// not a re-derivation from description. Adaptations from CM's file, named:
//   - root-finding + candidate/fallback resolution import from OUR OWN
//     ./lib/config-load.mjs (findProjectRoot, projectConfigPath,
//     ownDirDefault) instead of a local findGitRoot copy or a separate
//     config-paths.mjs. CM duplicates its root walk locally only because a
//     CJS hook (hooks/_shared/node-config.js) cannot import an ESM lib; this
//     is an ESM script importing an ESM lib, so duplicating it would just be
//     a second source of truth for the same walk, not a real constraint.
//   - global-layer path via globalConfigPath(home) (config-load.mjs), not a
//     hand-built `path.join(home, '.claude', '.coalledger.json')`: CM's
//     literal builds that way and so ignores CLAUDE_CONFIG_DIR entirely;
//     globalConfigPath already honors it (claudeBaseDir), and loadMergedConfig
//     reads through that same function — a --global write must land where
//     the reader actually looks.
//   - parse via OUR parseJsonc(content) (jsonc.mjs), not CM's raw
//     stripJsonc(content)+JSON.parse(...): CM's own jsonc.mjs has no
//     proto-pollution guard at all (checked at source, board CWK-023) so its
//     configure.mjs never had a stronger option to reach for. Ours does
//     (built for loadMergedConfig's project-config read) — using the weaker
//     path here would be a live regression relative to what this room
//     already does for every OTHER read of the same untrusted file class. No
//     import of stripJsonc is needed: parseJsonc calls it internally, and
//     hadComments below is a raw substring check on the untouched content,
//     same as CM's.
//   - no legacy-key migration block: CoalLedger has never renamed or retired
//     a schema key (checked: `git log -p --follow -- scripts/lib/config-
//     schema.mjs`, every removed `key:` line in history is a `help:` text
//     reword of quickVsFull/severityFloor, same key both sides, never a
//     rename or deletion). Porting CM's dead branches (`conductor` ->
//     `enableConductor` etc — names that never existed here) would be
//     migrating retired keys this room never had.
import fs from 'fs';
import path from 'path';
import { CONFIG_SCHEMA, validateValue } from './lib/config-schema.mjs';
import { parseJsonc } from './lib/jsonc.mjs';
import { findProjectRoot, projectConfigPath, ownDirDefault, globalConfigPath } from './lib/config-load.mjs';

function printHelp() {
  const lines = [
    'CoalLedger Configurator Utility',
    'Usage: node scripts/configure.mjs [options]',
    '',
    'Options:',
  ];
  for (const spec of CONFIG_SCHEMA) {
    const flags = [`--${spec.key}`, ...(spec.flags || [])].join(', ');
    lines.push(`  ${flags.padEnd(48)} ${spec.help}`);
  }
  lines.push(`  ${'--global'.padEnd(48)} Write ~/.claude/.coalledger.json (the global layer) instead of the project config`);
  lines.push(`  ${'--help, -h'.padEnd(48)} Show this help message`);
  lines.push('');
  lines.push('Examples:');
  lines.push('  node scripts/configure.mjs --language th --severityFloor high');
  lines.push('  node scripts/configure.mjs --disabledCanaries doc-leak,doc-rot');
  lines.push('  node scripts/configure.mjs --global --updateMode auto');
  console.log(lines.join('\n'));
}

// Parse one raw CLI value against a spec. Returns { value } or { error }.
function parseValue(spec, raw) {
  switch (spec.type) {
    case 'bool': {
      if (raw !== 'true' && raw !== 'false') {
        return { error: `${spec.key} needs true or false` };
      }
      return { value: raw === 'true' };
    }
    case 'int':
    case 'number': {
      // Number() (not parseInt) so a float like "5.9" or a garbage tail like "50abc"
      // is rejected outright rather than silently truncated to 5/50. validateValue
      // then enforces the int-vs-number + min/max contract — the SAME check
      // verify.mjs runs on the JSON value, so the CLI parser and the JSON
      // validator cannot drift apart. 'number' shares this body deliberately:
      // validateValue itself is what tells int and number apart (integer-ness),
      // this parser only needs to produce a JS number either way. No CoalLedger
      // schema key uses 'number' today (all ten are bool/enum/strArr/int) — this
      // case exists so the schema's own declared type space stays fully
      // supported, the same reason config-schema.mjs's validateValue carries it.
      const n = Number(raw);
      const err = validateValue(spec, n);
      if (err) return { error: `${spec.key} ${err}` };
      return { value: n };
    }
    case 'enum': {
      const v = (raw || '').toLowerCase();
      if (!spec.values.includes(v)) {
        return { error: `${spec.key} must be one of: ${spec.values.join(', ')}` };
      }
      // titleCase: no CoalLedger schema key sets this today (all 6 enum keys
      // are stored/compared lowercase — config-schema.mjs's own clampedRead
      // lowercases every enum read). Kept for shape parity with CoalMine
      // (defaultTier there IS titleCase) — a future key can opt in without
      // touching this parser.
      if (spec.titleCase && v !== 'auto') {
        return { value: v.charAt(0).toUpperCase() + v.slice(1) };
      }
      return { value: v };
    }
    case 'strArr': {
      if (raw === undefined) {
        return { error: `${spec.key} needs a comma-separated value (pass "" to clear the list)` };
      }
      if (raw === '' || raw === '""') return { value: [] };
      let items = raw.split(',').map((s) => s.trim()).filter(Boolean);
      // lower: no CoalLedger schema key sets this today (disabledCanaries is
      // deliberately free-form/case-as-typed — config-schema.mjs's own header
      // says membership is not validated). Kept for shape parity with
      // CoalMine, which DOES lower disabledCanaries/watchedExtensions.
      if (spec.lower) items = items.map((s) => s.toLowerCase());
      return { value: items };
    }
    default:
      return { error: `internal: unknown spec type '${spec.type}'` };
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  // --global targets the global layer (~/.claude/.coalledger.json); default targets
  // the project config. Hooks merge the two per key, project wins (mergeSafety).
  //
  // Per-project READ follows projectConfigPath's rail (namespace campaign
  // #69+#39, owner-designated 2026-08-08 — see config-load.mjs's own header
  // for the full precedence): own-dir -> other known agent dirs -> LEGACY
  // root dotfile. WRITE goes back to wherever the config was found, EXCEPT a
  // config found at the LEGACY location migrates on this write (ported from
  // CM's INSPECT MEDIUM 2, 2026-08-08, CWK-023: to ownDirDefault, the first
  // agent dir the project ALREADY HAS on disk, never a bare `.claude` — a
  // project that only uses `.agents`/`.gemini` must not get a foreign
  // `.claude/` planted into it) — move-on-CONFIG-WRITE-only (Phoenix #5, a
  // hook never performs this move on a mere read; configure.mjs is a CLI
  // script the user/agent explicitly runs). A config found at another
  // new-shape candidate (e.g. `.agents/coal/coalledger.json`) is NOT
  // force-migrated between agent dirs — it is written back where it already
  // lives.
  const globalIdx = args.indexOf('--global');
  const isGlobal = globalIdx !== -1;
  if (isGlobal) args.splice(globalIdx, 1);
  const projectRoot = findProjectRoot(process.cwd());
  const legacyPath = path.join(projectRoot, '.coalledger.json');
  const readPath = isGlobal
    ? globalConfigPath()
    : projectConfigPath(process.cwd());
  const writePath = isGlobal
    ? readPath
    : (readPath === legacyPath ? ownDirDefault(projectRoot) : readPath);

  let cfg = {};
  let hadComments = false;
  // Read once via try/catch (no existsSync precheck) so there is no check-to-use gap.
  // BOM strip via charCodeAt (same mechanism as config-load.mjs's readJsonc,
  // this room's own established shape) — never a typed regex escape/literal
  // for U+FEFF: this room's own hard-won lesson is that a raw BOM character
  // pasted into source gets silently converted to a real char by the tool
  // layer, which is exactly what a first draft of this line did.
  let rawConfig = null;
  try {
    let content = fs.readFileSync(readPath, 'utf8');
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
    rawConfig = content;
  } catch {}
  if (rawConfig !== null) {
    try {
      hadComments = rawConfig.includes('//');
      cfg = parseJsonc(rawConfig) || {}; // proto-pollution-guarded parse (jsonc.mjs)
    } catch (e) {
      // Fail loud (scripts-quality §1): a malformed config we silently overwrite is a
      // partial failure the user must notice — flag the non-zero exit even though the
      // run continues from defaults (the old config is backed up where possible).
      process.exitCode = 1;
      try {
        fs.copyFileSync(readPath, readPath + '.bak');
        console.warn(`Warning: existing config is malformed — backed it up to ${readPath}.bak and rebuilding.`);
      } catch {
        console.warn('Warning: existing config is malformed. Overwriting.');
      }
    }
  }

  // Flag lookup: --<key> plus every alias in the table.
  const flagMap = new Map();
  for (const spec of CONFIG_SCHEMA) {
    flagMap.set(`--${spec.key}`, spec);
    for (const f of spec.flags || []) flagMap.set(f, spec);
  }

  for (let i = 0; i < args.length; i++) {
    const spec = flagMap.get(args[i]);
    if (!spec) {
      console.error(`Error: Unrecognized option '${args[i]}'`);
      printHelp();
      process.exit(1);
    }
    const parsed = parseValue(spec, args[++i]);
    if (parsed.error) {
      console.error(`Error: ${parsed.error}`);
      process.exit(1);
    }
    cfg[spec.key] = parsed.value;
  }

  try {
    fs.mkdirSync(path.dirname(writePath), { recursive: true });
    fs.writeFileSync(writePath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    // Move-on-CONFIG-WRITE-only (no-old-version-leftover): the legacy root
    // file is removed only AFTER the new-home write above succeeded, and only
    // when this write actually migrated it (readPath was the legacy file and
    // writePath moved away from it). Best-effort — a failed delete here still
    // leaves a correctly-written new config; the stray legacy file is simply
    // not cleaned up this run.
    if (readPath === legacyPath && writePath !== legacyPath) {
      try { fs.rmSync(legacyPath, { force: true }); } catch {}
      console.log(`Migrated the project config from ${legacyPath} to ${writePath}.`);
    }
    if (hadComments) {
      console.warn('Note: inline comments were stripped (this tool writes plain JSON). Every key stays documented in platform-configs/.coalledger.json.');
    }
    console.log(`Successfully updated configuration in: ${writePath}`);
    console.log(JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error(`Error: Failed to write to config file: ${e.message}`);
    process.exit(1);
  }
}

main();
