// The class antibody: shipped skill text must not hand the agent a value to put on a shell line. A cloned repository
// writes the project config, so a config value a SKILL tells the agent to copy into a command reaches the agent's shell;
// and a repository-written path with a space or a shell character splits into arguments unless it is double-quoted.
// A command span is an inline code span, or a line inside a fenced or indented block, that starts a runner (node, cd,
// bash, sh, git, npx, python and the like). In a span every value slot must be on the allowlist, every path slot must sit
// inside double quotes, and no CONFIG_SCHEMA key may be named (a fixed word-list pick is the one exception).
// The scanner reads text only: it never runs or imports the code the text describes.
// shortcut: the prose rule (a schema key on the span's own line beside a paste word) is blind to scope, so a negation
// anywhere on that line exempts it; a value the text names only in words, with no code span, is not seen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_SCHEMA } from './config-schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNERS = 'node|npx|npm|pnpm|yarn|bun|deno|python3?|pip3?|uvx?|bash|sh|zsh|pwsh|powershell|cmd|git|gh|curl|wget|rtk|claude|agy|cd|cp|mv|rm|mkdir|cat|grep|sed|awk|find|tar|unzip|go|cargo';
const COMMAND = new RegExp(`(^|[\\s;&|(])(${RUNNERS})(\\.exe)?\\s`);
const KEYS = CONFIG_SCHEMA.map((s) => s.key);

// Each allowed placeholder is a value the agent takes from its own context, never from a config file or from the
// repository: the skill folder is the agent's own load context, the clock is supplied by the agent, and the fixed word list
// is the user's pick. A project root or a doc path is never a slot on a command line (T-47): the agent writes it to the run
// list, and the engine reads it from there.
export const ALLOWED = new Set([
  '<skill base dir>', // the skill folder the agent cds into; its own load context
  '<ISO date>', // a clock value the agent supplies (doc-standard --now)
  '<ask|auto|remind|off>', // commands/update.md: the user's own pick from these four fixed words, never read from config
]);
const PATH_SLOTS = ['<skill base dir>'];
// A bracket notation that names paths ("[more absolute paths ...]") is a path slot too: the shell reads its words unless quoted.
const BARE_NOTATION = /\[[^\]"]*\bpaths?\b[^\]"]*\.\.\.\]/g;
const SLOT_PATTERNS = [
  /<[A-Za-z][^<>`\n]*>/g, // <value>
  /\{\{?[A-Za-z_][\w. -]*\}?\}/g, // {value}, {{value}}
  /\$\{?[A-Za-z_]\w*\}?/g, // $VALUE, ${VALUE}
  /%[A-Za-z_]\w*%/g, // %VALUE%
  /(?<==)[A-Z][A-Z0-9_]{2,}\b/g, // --flag=VALUE
];
const SHELL_OWN = new Set(['$HOME', '$PWD', '$PATH', '$TMPDIR', '$OLDPWD', '%USERPROFILE%', '%TEMP%', '%APPDATA%']);
const PASTE_WORD = /\b(configured|config|pasting|paste|pasted|verbatim|copy)\b/i;
const NEGATION = /\b(never|not|no|don't|do not)\b/i;

// Every command span in a text: { line, text, raw }. A fenced or indented line counts whole; an inline span counts by its
// own text. `raw` is the whole source line, read for the prose rule.
export function commandSpans(text) {
  const spans = [];
  let fence = null;
  text.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const open = /^\s*(`{3,}|~{3,})/.exec(raw);
    if (open) {
      if (!fence) fence = open[1][0];
      else if (open[1][0] === fence) fence = null;
      return;
    }
    if (fence) {
      if (COMMAND.test(' ' + raw.trim())) spans.push({ line, text: raw.trim(), raw });
      return;
    }
    if (/^( {4}|\t)/.test(raw) && !raw.includes('`') && COMMAND.test(' ' + raw.trim()) && !raw.trim().startsWith('-')) {
      spans.push({ line, text: raw.trim(), raw });
    }
    for (const m of raw.matchAll(/(`+)([^`\n]+?)\1(?!`)/g)) {
      if (COMMAND.test(' ' + m[2].trim())) spans.push({ line, text: m[2].trim(), raw });
    }
  });
  return spans;
}

// True when the index sits inside a double-quoted run of the span.
const inDoubleQuotes = (text, at) => (text.slice(0, at).match(/"/g) ?? []).length % 2 === 1;

// Findings: { line, placeholder, why } with why = slot | unquoted-path | config-key | config-prose.
export function scanShellLines(text) {
  const findings = [];
  for (const span of commandSpans(text)) {
    const slots = new Map();
    for (const pattern of SLOT_PATTERNS) {
      for (const m of span.text.matchAll(pattern)) if (!SHELL_OWN.has(m[0])) slots.set(m.index, m[0]);
    }
    for (const [at, slot] of slots) {
      if (!ALLOWED.has(slot)) findings.push({ line: span.line, placeholder: slot, why: 'slot' });
      else if (PATH_SLOTS.includes(slot) && !inDoubleQuotes(span.text, at)) findings.push({ line: span.line, placeholder: slot, why: 'unquoted-path' });
    }
    for (const m of span.text.matchAll(BARE_NOTATION)) {
      if (!inDoubleQuotes(span.text, m.index)) findings.push({ line: span.line, placeholder: m[0], why: 'unquoted-path' });
    }
    const named = KEYS.filter((k) => new RegExp(`\\b${k}\\b`).test(span.text));
    const onlyPicks = slots.size > 0 && [...slots.values()].every((s) => ALLOWED.has(s) && s.includes('|'));
    if (!onlyPicks) for (const k of named) findings.push({ line: span.line, placeholder: k, why: 'config-key' });
    if (PASTE_WORD.test(span.raw) && !NEGATION.test(span.raw)) {
      for (const k of KEYS) {
        if (new RegExp(`\\b${k}\\b`).test(span.raw)) { findings.push({ line: span.line, placeholder: k, why: 'config-prose' }); break; }
      }
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
  const text = ['```', 'node ./lib/emdash.mjs --mode=<unspaced|spaced> --list', '```'].join('\n');
  assert.deepEqual(scanShellLines(text).map((f) => f.placeholder), ['<unspaced|spaced>']);
});

test('a placeholder outside any command span is prose and is not read here', () => {
  assert.deepEqual(scanShellLines('The value is `<source=counterpart>` in prose.'), []);
});

test('a command span carrying only the allowlisted skill folder passes', () => {
  const text = 'Run `cd "<skill base dir>" && node ./lib/md-checks.mjs --json --list`.';
  assert.deepEqual(scanShellLines(text), []);
});

test('a project root on a command line is refused: the agent writes it to the run list instead', () => {
  assert.ok(scanShellLines('Run `cd "<skill base dir>" && node ./lib/x.mjs --root="<project root>" --list` now.').length >= 1);
});

test('a doc path on a command line is refused, quoted or not: it goes to the run list instead', () => {
  assert.ok(scanShellLines('Run `cd "<skill base dir>" && node ./lib/x.mjs --json --list "<absolute-file.md>"` now.').length >= 1);
});

test('every command span shipped in plugin/ carries only allowlisted placeholders, and the walk saw spans', () => {
  const files = shippedMarkdown();
  let spans = 0;
  const findings = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    spans += commandSpans(text).length;
    for (const x of scanShellLines(text)) findings.push(path.relative(ROOT, f) + ':' + x.line + ' ' + x.why + ' ' + x.placeholder);
  }
  assert.ok(spans >= 5, 'the walk saw ' + spans + ' command span(s) in ' + files.length + ' file(s); a walk that sees almost none is a broken walk');
  assert.deepEqual(findings, []);
});

// Bounce 1 (29cg, r52): each plant below is a dirty line the old scanner passed (control rows it already caught).
const PLANTS = {
  'inline placeholder (control)': 'Run `node ./lib/x.mjs --mode=<emDash>` now.',
  'fenced placeholder (control)': '```\nnode ./lib/x.mjs --pair=<pair>\n```',
  'tilde fence': '~~~\nnode ./lib/x.mjs --pair=<pair>\n~~~',
  'shell variable slot': 'Run `node ./lib/x.mjs --mode=$EMDASH` with the configured value.',
  'brace slot': 'Run `node ./lib/x.mjs --pair={pair}` now.',
  'upper-case value slot': 'Run `node ./lib/x.mjs --mode=VALUE`, pasting the configured emDash for VALUE.',
  'allowed slot fed from config prose': 'Run `node ./lib/x.mjs "<absolute-file.md>"`, pasting each configured translationPairs side for it.',
  'bare bracket notation after a quoted slot': 'Run `cd "<skill base dir>" && node ./lib/x.mjs --root="<project root>" "<absolute-file.md>" [more absolute paths ...]` now.',
  'npx runner': 'Run `npx foo --pair=<pair>` now.',
  'python runner': 'Run `python3 x.py --pair=<pair>` now.',
  'double-backtick span (control)': 'Run ``node ./lib/x.mjs --pair=<pair>`` now.',
};
for (const [name, text] of Object.entries(PLANTS)) {
  test('plant is refused by the antibody: ' + name, () => {
    assert.ok(scanShellLines(text).length >= 1, 'a planted dirty line passed the scanner');
  });
}

test('a quoted skill folder and a list run pass', () => {
  assert.deepEqual(scanShellLines('Run `cd "<skill base dir>" && node ./lib/x.mjs --json --list` now.'), []);
});

test('a bracket notation naming paths passes once its words are quoted', () => {
  assert.deepEqual(scanShellLines('Run `cd "<skill base dir>" && node ./lib/x.mjs --json --list ["more absolute paths" ...]` now.'), []);
});

test('an unquoted path slot is refused: a file name with a space splits into arguments', () => {
  assert.ok(scanShellLines('Run `cd "<skill base dir>" && node ./lib/x.mjs --root="<project root>" <absolute-file.md>` now.').length >= 1);
});

// The keys come from the schema itself, never from a list typed here.
for (const s of CONFIG_SCHEMA) {
  test('a command line naming the config key ' + s.key + ' is refused', () => {
    assert.ok(scanShellLines('Run `node ./lib/x.mjs --mode=' + s.key + '` now.').length >= 1);
  });
}

test('a fixed word-list pick beside a config key passes (the update.md shape)', () => {
  assert.deepEqual(scanShellLines('Run `node scripts/configure.mjs --updateMode <ask|auto|remind|off>` now.'), []);
});

// Path slots that the shell splits when unquoted, read on the shipped tree (item 1 of r52; bounce 2: the bracket notation too).
function unquotedPathSlots(text) {
  const out = [];
  for (const span of commandSpans(text)) {
    for (const slot of PATH_SLOTS) {
      for (let at = span.text.indexOf(slot); at >= 0; at = span.text.indexOf(slot, at + 1)) {
        if (!inDoubleQuotes(span.text, at)) out.push({ line: span.line, slot });
      }
    }
    for (const m of span.text.matchAll(BARE_NOTATION)) {
      if (!inDoubleQuotes(span.text, m.index)) out.push({ line: span.line, slot: m[0] });
    }
  }
  return out;
}

test('every path placeholder on a shipped command line is double-quoted', () => {
  const bad = [];
  for (const f of shippedMarkdown()) {
    for (const hit of unquotedPathSlots(fs.readFileSync(f, 'utf8'))) bad.push(path.relative(ROOT, f) + ':' + hit.line + ' ' + hit.slot);
  }
  assert.deepEqual(bad, []);
});
