// T-21 (order 29z): doc-standard's repository-scope pass, keyed on the OpenSSF Best Practices passing criteria.
//
// Four checks, each carrying the bare id of the passing criterion it answers (`criterion`). The presence checks and the
// security.txt expiry are CONFIRMED: deterministic file facts. The raw-log check is SUSPECTED: a shape read off text.
// Severity is the caller's call, never this engine's.
//
// Name matching is case-insensitive over readdir names: a naming convention GitHub also applies, not filesystem
// identity. A named entry counts only as a plain file, so a link that leaves the root never satisfies a criterion.
// Zero-dep (Phoenix #2): node built-ins plus this folder's repo-fs.mjs (kind-gated, bounded reads).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoEntryKind, readRepoFileBounded, MAX_DOC_BYTES } from './repo-fs.mjs';

// The criterion ids the engine can emit; the test checks each one against the CoalGob checklist's headings.
export const CRITERIA = ['license_location', 'contribution', 'vulnerability_report_process', 'release_notes'];

// A licence file, or one licence per file (LICENSE-MIT, LICENCE-APACHE.txt): a naming convention GitHub also applies,
// not filesystem identity.
const LICENSE_RE = /^(LICENSE|LICENCE|COPYING)(\.md|\.txt)?$|^(LICENSE|LICENCE)-.+$/i;
const CONTRIBUTING_RE = /^CONTRIBUTING(\.md|\.rst|\.txt)?$/i;
const SECURITY_RE = /^SECURITY(\.md|\.rst|\.txt)?$/i;
const SECURITY_TXT_RE = /^security\.txt$/i;
const RELEASE_NOTES_RE = /^(CHANGELOG|HISTORY|NEWS|RELEASES)(\.md|\.rst|\.txt)?$/i;
// Where a project's policy and contribution files may sit: the root, docs/ and .github/.
const PLACES = ['', 'docs', '.github'];

// The plain files under `dir` whose names match. A project with no such folder has none.
function presentIn(root, dir, re) {
  let names;
  try { names = fs.readdirSync(path.join(root, dir)); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  return names.filter((n) => re.test(n) && repoEntryKind(path.join(root, dir, n), root) === 'file').map((n) => path.join(dir, n));
}

// security.txt: its Expires field. RFC 9116 section 2.5.5 makes Expires REQUIRED. Returns { ms } or { reason }.
function expiresOf(text) {
  if (text === null) return { reason: 'the file could not be read as a plain bounded file' };
  const lines = text.split(/\r?\n/).map((l) => l.match(/^Expires:\s*(.*\S)\s*$/i)).filter(Boolean);
  if (lines.length > 1) return { reason: 'Expires appears more than once (RFC 9116 section 2.5.5)' };
  if (!lines.length) return { reason: 'no Expires field (RFC 9116 section 2.5.5 requires one)' };
  // shortcut: Date.parse accepts more than RFC 3339, so a lax date reads as valid; tighten to the RFC 3339 grammar if a field report shows one.
  const ms = Date.parse(lines[0][1]);
  if (Number.isNaN(ms)) return { reason: `Expires is not a date: ${JSON.stringify(lines[0][1])}` };
  return { ms };
}

// Raw `git log` output in a release-notes file. Two shapes only, and the first matching line is reported.
// shortcut: two git-log shapes only (default and --oneline); a custom --format log is not seen, widen if a field report shows one.
const COMMIT_RE = /^commit [0-9a-f]{40}\b/;
const ONELINE_RE = /^[-*]?\s*[0-9a-f]{7,40}\s+\S/;
function rawLogLine(lines) {
  let firstCommit = -1;
  let firstRun = -1;
  let run = 0;
  for (let i = 0; i < lines.length; i++) {
    if (firstCommit < 0 && COMMIT_RE.test(lines[i]) && lines.slice(i + 1, i + 3).some((l) => l.startsWith('Author:'))) firstCommit = i;
    const hit = lines[i].trim() !== '' && ONELINE_RE.test(lines[i]);
    run = hit ? run + 1 : 0;
    if (run === 5 && firstRun < 0) firstRun = i - 4; // linear: one pass, never a re-scan from each line
  }
  const found = [firstCommit, firstRun].filter((x) => x >= 0);
  return found.length ? Math.min(...found) : -1;
}

// `root` is used as given; `nowMs` is the clock the Expires check compares against (the CLI passes --now or the time now).
export function checkRepository(root, nowMs) {
  const out = [];

  // REUSE keeps licence texts in LICENSES/: a folder holding at least one plain file is a licence.
  if (presentIn(root, '', LICENSE_RE).length === 0 && presentIn(root, 'LICENSES', /./).length === 0) {
    out.push({ check: 'license-missing', criterion: 'license_location', verdict: 'CONFIRMED',
      reason: 'no LICENSE, LICENCE or COPYING file at the root' });
  }

  if (PLACES.every((dir) => presentIn(root, dir, CONTRIBUTING_RE).length === 0)) {
    out.push({ check: 'contributing-missing', criterion: 'contribution', verdict: 'CONFIRMED',
      reason: 'no CONTRIBUTING file at the root, in docs/ or in .github/' });
  }

  // security.txt: a valid one (an Expires still in the future) is a vulnerability process on its own.
  const stxt = presentIn(root, '.well-known', SECURITY_TXT_RE);
  let stxtExpiry = null;
  if (stxt.length) {
    const text = readRepoFileBounded(path.join(root, stxt[0]), root, MAX_DOC_BYTES);
    stxtExpiry = expiresOf(text);
  }
  const stxtValid = stxtExpiry !== null && stxtExpiry.ms !== undefined && stxtExpiry.ms > nowMs;
  const hasSecurityMd = PLACES.some((dir) => presentIn(root, dir, SECURITY_RE).length > 0);
  if (!hasSecurityMd && !stxtValid) {
    out.push({ check: 'vuln-report-missing', criterion: 'vulnerability_report_process', verdict: 'CONFIRMED',
      reason: 'no SECURITY file at the root, in docs/ or in .github/, and no valid .well-known/security.txt' });
  }
  // Reported even beside a SECURITY.md: the file is there, and its Expires says it has lapsed.
  if (stxt.length && !stxtValid) {
    const why = stxtExpiry.reason ?? `Expires ${new Date(stxtExpiry.ms).toISOString()} is not after the check time`;
    out.push({ check: 'securitytxt-expired', criterion: 'vulnerability_report_process', verdict: 'CONFIRMED',
      file: stxt[0], reason: `.well-known/security.txt: ${why}` });
  }

  // This pass judges the shape of a release-notes file that exists; a project with none is not checked here. The
  // criterion's own N/A is narrower (software that is not reused AND is delivered continuously), and this pass does not decide it.
  for (const dir of PLACES) {
    for (const rel of presentIn(root, dir, RELEASE_NOTES_RE)) {
      const text = readRepoFileBounded(path.join(root, rel), root, MAX_DOC_BYTES);
      if (text === null) {
        out.push({ check: 'release-notes-unreadable', criterion: 'release_notes', verdict: 'SUSPECTED', file: rel,
          reason: `${rel} could not be read under the ${MAX_DOC_BYTES / 1048576} MB bound (over it, or unreadable), so its shape is not judged` });
        continue;
      }
      const at = rawLogLine(text.split(/\r?\n/));
      if (at >= 0) {
        out.push({ check: 'release-notes-raw-log', criterion: 'release_notes', verdict: 'SUSPECTED',
          file: rel, line: at + 1, reason: `${rel} reads as raw git log output, not release notes` });
      }
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

// CLI: node repo-standard.mjs --root=<project root> [--json] [--now=<ISO>]
// Exit 0 whenever the run completed, findings included; exit 2 on a usage error. Never process.exit().
if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const rootArg = args.find((a) => a.startsWith('--root='));
  const nowArg = args.find((a) => a.startsWith('--now='));
  const nowMs = nowArg ? Date.parse(nowArg.slice('--now='.length)) : Date.now();
  if (!rootArg || rootArg.length === '--root='.length) {
    console.error('usage: node repo-standard.mjs --root=<project root> [--json] [--now=<ISO>]');
    process.exitCode = 2;
  } else if (Number.isNaN(nowMs)) {
    console.error(`usage: --now must be an ISO date (got ${JSON.stringify(nowArg)})`);
    process.exitCode = 2;
  } else {
    const root = path.resolve(rootArg.slice('--root='.length)); // used literally, never realpathed (the 29w class)
    const findings = checkRepository(root, nowMs);
    if (args.includes('--json')) {
      console.log(JSON.stringify({ findings }, null, 2));
    } else {
      for (const f of findings) {
        console.log(`${f.verdict} ${JSON.stringify(f.check)} ${JSON.stringify(f.criterion)} ${JSON.stringify(f.reason)}`
          + ` file=${JSON.stringify(f.file ?? null)} line=${JSON.stringify(f.line ?? null)}`);
      }
      console.log(`${findings.length} finding(s)`);
    }
  }
}
