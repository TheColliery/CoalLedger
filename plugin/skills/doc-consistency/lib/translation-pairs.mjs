// T-20 (order 29z): doc-consistency's mechanical layer for DECLARED translation pairs.
//
// The pairing is declared in the config (`translationPairs`, "source=counterpart"), never guessed. For each pair the
// engine answers one question with a file fact and the repository's record: is the counterpart missing, or was it
// last committed before its source? Dates come from git's committer record, never from mtime (a checkout or a copy
// resets mtime). Every finding is SUSPECTED: which side is the true one is a judgment this engine never makes.
//
// Zero-dep (Phoenix #2): node built-ins plus this folder's repo-fs.mjs (kind-gated file reads) and git-env.mjs
// (the git spawn's environment). Both ride beside this file in the skill copy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { repoEntryKind } from './repo-fs.mjs';
import { gitEnv } from './git-env.mjs';

const ruleText = (raw) => `translationPairs ${JSON.stringify(raw)}`;

// Parse one "source=counterpart" declaration, split on the FIRST "=". A malformed pair is never read.
export function parsePair(raw) {
  const i = raw.indexOf('=');
  if (i < 0) return { invalid: 'no "=" between the two paths' };
  const source = raw.slice(0, i);
  const counterpart = raw.slice(i + 1);
  for (const side of [source, counterpart]) {
    if (!side) return { invalid: 'an empty side' };
    if (side.includes('\\')) return { invalid: 'a backslash (use forward slashes)' };
    if (path.posix.isAbsolute(side) || /^[A-Za-z]:/.test(side)) return { invalid: 'an absolute path' };
    if (side.split('/').includes('..')) return { invalid: 'a ".." segment leaves the root' };
  }
  return { source, counterpart };
}

// The repository's own record of when a file last changed (committer date). Undated: git is absent, the folder is not
// a repository, or no commit records the file (untracked). Never mtime.
function lastCommitDate(root, rel) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', rel], {
      cwd: root, env: gitEnv(path.dirname(root)), encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out ? { date: out } : { reason: 'no commit records this file (untracked or never committed)' };
  } catch (e) {
    const why = e && e.code === 'ENOENT' ? 'git is not installed' : 'not a git repository, or git could not read it';
    return { reason: `undated: ${why}` };
  }
}

// One finding per pair at most. `root` is used as given (the caller pins it literally).
export function checkTranslationPairs(root, pairs) {
  const out = [];
  for (const raw of pairs) {
    const base = { rule: ruleText(raw), verdict: 'SUSPECTED', sourceDate: null, counterpartDate: null };
    const p = parsePair(raw);
    if (p.invalid) {
      out.push({ ...base, check: 'pair-invalid', source: null, counterpart: null, reason: `not read: ${p.invalid}` });
      continue;
    }
    const { source, counterpart } = p;
    const base2 = { ...base, source, counterpart };
    const sourceKind = repoEntryKind(path.join(root, source), root);
    if (sourceKind !== 'file') {
      out.push({ ...base2, check: 'pair-source-missing', reason: `${source} is not a plain file under the root (${sourceKind === 'missing' ? 'missing' : 'refused by the link rule'})` });
      continue;
    }
    const counterKind = repoEntryKind(path.join(root, counterpart), root);
    if (counterKind !== 'file') {
      out.push({ ...base2, check: 'translation-missing', reason: `${counterpart} is not a plain file under the root (${counterKind === 'missing' ? 'missing' : 'refused by the link rule'})` });
      continue;
    }
    const s = lastCommitDate(root, source);
    const c = lastCommitDate(root, counterpart);
    if (s.reason || c.reason) {
      const why = [s.reason && `${source}: ${s.reason}`, c.reason && `${counterpart}: ${c.reason}`].filter(Boolean).join('; ');
      out.push({ ...base2, check: 'translation-undated', sourceDate: s.date ?? null, counterpartDate: c.date ?? null, reason: why });
      continue;
    }
    if (Date.parse(c.date) < Date.parse(s.date)) {
      out.push({ ...base2, check: 'translation-older', sourceDate: s.date, counterpartDate: c.date,
        reason: `${counterpart} was last committed before ${source}` });
    }
  }
  return out;
}

function isMainModule(url) {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync.native(fileURLToPath(url)) === fs.realpathSync.native(process.argv[1]);
  } catch {
    return false;
  }
}

// CLI: node translation-pairs.mjs --root=<project root> [--json] [--pair=<source=counterpart> ...]
// Exit 0 whenever the run completed, findings included; exit 2 on a usage error. Never process.exit().
if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const rootArg = args.find((a) => a.startsWith('--root='));
  if (!rootArg || rootArg.length === '--root='.length) {
    console.error('usage: node translation-pairs.mjs --root=<project root> [--json] [--pair=<source=counterpart> ...]');
    process.exitCode = 2;
  } else {
    const root = path.resolve(rootArg.slice('--root='.length)); // used literally, never realpathed (the 29w class)
    const pairs = args.filter((a) => a.startsWith('--pair=')).map((a) => a.slice('--pair='.length));
    const findings = checkTranslationPairs(root, pairs);
    if (args.includes('--json')) {
      console.log(JSON.stringify({ findings }, null, 2));
    } else {
      for (const f of findings) {
        console.log(`${f.verdict} ${JSON.stringify(f.check)} ${JSON.stringify(f.rule)} ${JSON.stringify(f.reason)}`
          + ` source=${JSON.stringify(f.source)} counterpart=${JSON.stringify(f.counterpart)}`
          + ` sourceDate=${JSON.stringify(f.sourceDate)} counterpartDate=${JSON.stringify(f.counterpartDate)}`);
      }
      console.log(`${findings.length} finding(s) across ${pairs.length} pair(s)`);
    }
  }
}
