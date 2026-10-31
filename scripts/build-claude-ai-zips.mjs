#!/usr/bin/env node
// Stages one directory per skill under dist-claude-ai/<name>/, copied from
// plugin/skills/<name>/ with ONLY the SKILL.md frontmatter `description`
// field rewritten to a 200-char skill-listing cap (our own cross-platform cap
// is 1024, desc-cap.mjs). claude.ai's skills page, read 2026-10-02, states a
// 1,024-char limit, so the 200 trim is conservative: a description that is too
// short still uploads, one that is too long may not. It stays until one real
// upload at the longer length is on record (UMB-333). A DERIVED artifact;
// skills/*/SKILL.md and plugin/skills/*/SKILL.md are never touched. The
// claude-ai-zips workflow zips each staged directory and attaches it to
// the GitHub Release as an asset. The workflow zips each staged FOLDER from its
// parent, so an archive holds <name>/SKILL.md (a SKILL.md at the archive root is
// not recognized as a skill) and checks every archive's layout before upload.
// Canonical exemplar: CoalMine (board #40).
//
// NAMED DIVERGENCE from the canon blob b1ecfd36 (ONE FLOCK ONE COLOR, R14): this room keeps
// three fixes the canon copy lacks -- the block-scalar blank-line scan (CWK-120 row 9), the
// empty plugin/skills guard (CWK-120 row 2) and the realpath main-module guard (r33/r34
// INSPECT). Everything else, header included, is the canon text.
//
// REPRODUCIBLE, AND REFUSING WHAT IT CANNOT PACKAGE (09g, CoalMine issue 42 M1-M3). A symlink or any entry that is neither a regular file nor a folder is REFUSED, never
// followed (copyFileSync would read the link's target into a public asset); an entry whose name starts with a dot is not staged at any depth (a nested .DS_Store); a name with a
// control character is refused. When SOURCE_DATE_EPOCH is set (whole seconds, 1980 or later: the reproducible-builds variable, which the workflow sets to the tag commit's time) every
// staged file and folder gets that mtime, because zip stores mtimes and a time of the build would make every rebuild a different archive. The zip step then zips a sorted list.
//
// Entry-point imports node builtins only at the top level (node/runtime.md
// §1) — local libs are dynamic, inside main().
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(scriptDir, '..');
const pluginSkills = path.join(repo, 'plugin', 'skills');
const outDir = path.join(repo, 'dist-claude-ai');

const hasControlChar = (name) => [...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const byCodeUnit = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true }).sort(byCodeUnit)) {
    if (entry.name.startsWith('.')) continue; // a dotfile or dot-folder is not packaged, at any depth
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (hasControlChar(entry.name)) throw new Error(`${JSON.stringify(entry.name)} has a control character in its name`);
    const st = fs.lstatSync(s); // lstat: a symlink or junction is seen as itself, never followed
    if (st.isSymbolicLink() || !(st.isDirectory() || st.isFile())) throw new Error(`${s} is neither a regular file nor a folder (a symlink or special file is refused, not followed)`);
    if (st.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

// every file and folder under dir gets the same mtime (children first, then the folder), so the archive does not depend on when it was built
function stampTree(dir, seconds) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) stampTree(p, seconds);
    else fs.utimesSync(p, seconds, seconds);
  }
  fs.utimesSync(dir, seconds, seconds);
}

// null when SOURCE_DATE_EPOCH is unset; the seconds when it is a whole number of 1980 or later (zip cannot store an earlier time); else a refusal
function sourceDateEpoch(env) {
  const raw = env.SOURCE_DATE_EPOCH;
  if (raw === undefined) return null; // set but empty (a failed git log in the workflow) is a refusal below, never a silent non-reproducible build
  if (!/^\d{1,12}$/.test(raw) || Number(raw) < 315532800) throw new Error(`SOURCE_DATE_EPOCH must be whole seconds, 1980-01-01 or later (got ${JSON.stringify(raw)})`);
  return Number(raw);
}

// Replace the frontmatter `description:` field (bare/quoted single-line, or
// a block scalar with indented continuation lines) with a single-line
// quoted value — the trimmed description is always <= the platform cap and
// never needs the block-scalar form.
function replaceDescriptionField(text, newValue) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error('no frontmatter block found');
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith('description:'));
  if (i === -1) throw new Error('no description key in frontmatter');
  let end = i + 1;
  const v = lines[i].slice('description:'.length).trim();
  if (/^[>|][-+]?$/.test(v)) {
    // CWK-120 row 9's class, SECOND site (the claim named `desc-cap.mjs:29`;
    // this scan is the same shape and its miss is worse): an internal BLANK line
    // used to end the block scalar, so a rewrite would have replaced only the
    // HEAD of the description and left the orphaned tail lines standing in the
    // frontmatter of a SHIPPED SKILL.md. Carry blank lines through, end at the
    // last real continuation line (so trailing blanks are preserved, not eaten),
    // and stop at the next top-level field.
    let j = i + 1;
    while (j < lines.length && (/^\s*$/.test(lines[j]) || /^\s/.test(lines[j]))) {
      if (/\S/.test(lines[j])) end = j + 1;
      j++;
    }
  }
  const escaped = newValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const newLines = [...lines.slice(0, i), `description: "${escaped}"`, ...lines.slice(end)];
  return text.slice(0, m.index) + '---\n' + newLines.join('\n') + '\n---' + text.slice(m.index + m[0].length);
}

async function main() {
  const { frontmatterField } = await import('./lib/desc-cap.mjs');
  const { trimDescription, CLAUDE_AI_DESC_CAP } = await import('./lib/claude-ai-trim.mjs');

  if (!fs.existsSync(pluginSkills)) {
    console.error(`FAIL: ${pluginSkills} does not exist — run node scripts/build-plugin.mjs first.`);
    process.exitCode = 1;
    return;
  }

  let epoch;
  try { epoch = sourceDateEpoch(process.env); } catch (e) {
    console.error(`FAIL: ${e.message}`);
    process.exitCode = 1;
    return;
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  const skills = fs.readdirSync(pluginSkills, { withFileTypes: true }).filter((e) => e.isDirectory()).sort(byCodeUnit);
  // CWK-120 row 2 (CodeRabbit, this line): the guard above covers plugin/skills
  // ABSENT; an EMPTY plugin/skills fell straight through — the loop never ran,
  // `failed` stayed 0, and the script exited 0 printing `Done: 0/0 skill(s)
  // staged`. The claude-ai-zips workflow would then attach ZERO assets to a
  // Release and report success: a failure reported as a clean bill, which is the
  // class this room has already paid for in its own link-check gate (CWK-092).
  if (skills.length === 0) {
    console.error(`FAIL: ${pluginSkills} holds no skill directories — nothing to stage; run node scripts/build-plugin.mjs first.`);
    process.exitCode = 1;
    return;
  }
  let failed = 0;
  for (const skill of skills) {
    try {
      const srcDir = path.join(pluginSkills, skill.name);
      const destDir = path.join(outDir, skill.name);
      copyDirRecursive(srcDir, destDir);
      const skillMdPath = path.join(destDir, 'SKILL.md');
      const text = fs.readFileSync(skillMdPath, 'utf8');
      const description = frontmatterField(text, 'description');
      if (description == null) throw new Error('no description field found');
      const trimmed = trimDescription(description, CLAUDE_AI_DESC_CAP);
      fs.writeFileSync(skillMdPath, replaceDescriptionField(text, trimmed), 'utf8');
      if (epoch !== null) stampTree(destDir, epoch);
      console.log(`staged ${skill.name} (description ${description.length} -> ${trimmed.length} chars)`);
    } catch (e) {
      console.error(`FAIL ${skill.name}: ${e.message}`);
      failed++;
      process.exitCode = 1;
    }
  }
  console.log(`Done: ${skills.length - failed}/${skills.length} skill(s) staged into ${outDir}, ${failed} failed`);
}

// LOW-3 (r33 INSPECT): a bare `main().catch(...)` here means IMPORTING this
// module (rather than spawning it) runs the build against whatever cwd/argv
// the importer happens to carry, silently setting the IMPORTER's own
// process.exitCode.
//
// MED-3 (r34 INSPECT): the original guard here compared import.meta.url
// against pathToFileURL(process.argv[1]) -- a LEXICAL compare, since
// import.meta.url is the loader's REALPATH of the entry while argv[1] is
// only path.resolve'd. Through a junction or a symlinked ~/.claude the two
// never matched and the guard FAILED OPEN. This room paid for the identical
// lexical-vs-realpath defect at CWK-078.
// fs.realpathSync.native on BOTH sides (.native, never plain -- plain does
// not expand a Windows 8.3 short name, AGENTS.md Hard-won lessons); an
// unresolvable path fails CLOSED (treated as NOT the entry) inside a
// try/catch that never throws past it -- an importer must still see its own
// exit code untouched (LOW-3). Duplicated per file, not shared: three of
// this room's six guarded scripts ship standalone into a copied skill
// folder with no scripts/lib sibling, so a shared helper would break the
// self-contained-engine property -- kept identical across all six rather
// than splitting the idiom three-and-three.
function isMainModule(url) {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync.native(fileURLToPath(url)) === fs.realpathSync.native(process.argv[1]);
  } catch {
    return false;
  }
}
if (isMainModule(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
