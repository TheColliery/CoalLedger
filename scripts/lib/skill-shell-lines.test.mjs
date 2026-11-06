// The class antibody: shipped skill text must not hand the agent a value to paste onto a shell line. A
// cloned repository writes the project config, so any config value a SKILL tells the agent to copy into a command reaches
// the agent's shell. This scanner reads every COMMAND span (an inline code span, or a line inside a fenced block, that runs
// node, cd, bash, sh or git) and fails on any <placeholder> that is not on the allowlist below. A placeholder outside a
// command span is prose and is not read here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMMAND = /(^|[\s;&|(])(node|cd|bash|sh|git)\s/;
const PLACEHOLDER = /<([A-Za-z][^<>`]*)>/g;

// Each allowed placeholder names a value the agent takes from its own context, never a value read from a config file.
export const ALLOWED = new Set([
  '<skill base dir>', // the skill folder the agent cds into; its own load context
  '<project root>', // the absolute project folder the agent is working in
  '<absolute-file.md>', // a doc path the agent names
  '<ISO date>', // a clock value the agent supplies (doc-standard --now)
  '<ask|auto|remind|off>', // commands/update.md: the user's own pick from these four fixed words, never read from config
]);

// Every command span in a text: { line, text }. A fenced line counts whole; an inline span counts by its own text.
export function commandSpans(text) {
  const spans = [];
  let fenced = false;
  text.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return; }
    if (fenced) {
      if (COMMAND.test(' ' + line.trim())) spans.push({ line: i + 1, text: line.trim() });
      return;
    }
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      if (COMMAND.test(' ' + m[1])) spans.push({ line: i + 1, text: m[1] });
    }
  });
  return spans;
}

// Findings: one per placeholder inside a command span that is not on the allowlist.
export function scanShellLines(text) {
  const findings = [];
  for (const span of commandSpans(text)) {
    for (const m of span.text.matchAll(PLACEHOLDER)) {
      const ph = '<' + m[1] + '>';
      if (!ALLOWED.has(ph)) findings.push({ line: span.line, placeholder: ph });
    }
  }
  return findings;
}

function shippedMarkdown() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.md')) out.push(p);
    }
  };
  for (const sub of ['skills', 'commands', 'agents']) {
    const d = path.join(ROOT, 'plugin', sub);
    if (fs.existsSync(d)) walk(d);
  }
  return out;
}

test('the scanner refuses a config placeholder inside an inline command span', () => {
  const text = 'Run `cd "<skill base dir>" && node ./lib/x.mjs --pair="<source=counterpart>"` now.';
  assert.deepEqual(scanShellLines(text).map((f) => f.placeholder), ['<source=counterpart>']);
});

test('the scanner refuses a config placeholder on a fenced command line', () => {
  const text = ['```', 'node ./lib/emdash.mjs --mode=<unspaced|spaced> --root="<project root>" <absolute-file.md>', '```'].join('\n');
  assert.deepEqual(scanShellLines(text).map((f) => f.placeholder), ['<unspaced|spaced>']);
});

test('a placeholder outside any command span is prose and is not read here', () => {
  assert.deepEqual(scanShellLines('The value is `<source=counterpart>` in prose.'), []);
});

test('a command span carrying only allowlisted placeholders passes', () => {
  const text = 'Run `cd "<skill base dir>" && node ./lib/md-checks.mjs --json --root="<project root>" <absolute-file.md>`.';
  assert.deepEqual(scanShellLines(text), []);
});

test('every command span shipped in plugin/ carries only allowlisted placeholders, and the walk saw spans', () => {
  const files = shippedMarkdown();
  let spans = 0;
  const findings = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    spans += commandSpans(text).length;
    for (const x of scanShellLines(text)) findings.push(path.relative(ROOT, f) + ':' + x.line + ' ' + x.placeholder);
  }
  assert.ok(spans >= 5, 'the walk saw ' + spans + ' command span(s) in ' + files.length + ' file(s); a walk that sees almost none is a broken walk');
  assert.deepEqual(findings, []);
});
