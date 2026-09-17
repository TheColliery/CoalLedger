// CWK-101 -- doc-quality's SECOND mechanical engine (after emdash.mjs):
// language-mechanics rules keyed on SCRIPT RANGE, never on a doc's declared
// language. This unit ships the design + exactly ONE language end-to-end:
// ZH (two rules, one authority). JA/KO/CLDR/TH/EN join later, one unit each
// -- per the CWK-101 design record (a room-internal working note, not a
// tracked file this header can point at). Disagree with THIS header and
// this header wins: it is the tracked, load-bearing contract.
//
// PREMISE, stated so nobody widens the wrong file: at the time this shipped,
// CoalLedger had NO Thai mechanics engine and NO Thai mechanics test. The
// Thai checker a reader may remember is `check-thai.mjs`, OUTSIDE this
// series (the thai-writing skill) -- SHAPE borrowed (RULES table · CHECKS ·
// markdown-aware checkText · --plain/--json CLI), rules never pasted: every
// rule here is re-derived from ITS OWN cited authority.
//
// A RULE WITH NO AUTHORITY DOES NOT SHIP (THE FORMAL STANDARD doctrine): the
// `authority` field on every RULES entry names the standard + clause it
// enforces, so a house guess never wears a standard's label.
//
// SEVERITY is the DETECTOR's confidence (error = objectively wrong under the
// named authority; warn/info = judgment-shaped), mapped to CONFIRMED/
// SUSPECTED by the caller -- the REPORT's severity is still judged by
// context, never mechanically (the suite's own "severity NEVER mechanical"
// law). This field is not that judgment.
//
// SCRIPT DETECTION IS PER-LINE, NOT PER-DOCUMENT: Han is shared by ZH and
// JA, so a line carrying any Kana resolves 'ja'; Han with no Kana resolves
// 'zh'. THE ONE NAMED AMBIGUITY: an all-Kanji JA sentence (no Kana at all)
// misclassifies as 'zh' -- bounded, because the ZH rules below are ALSO
// violations under JLReq (Japanese punctuation is full-width too), so a
// misread JA line still produces a TRUE finding, merely under the wrong
// authority. A Kana-bearing line is JA-classified and NEVER fires a
// zh-* rule (the JA ruleset that would cover it does not exist yet).
//
// A SECOND AMBIGUITY, CLOSED not bounded (HIGH-1, r34 INSPECT): Hangul
// (Korean) can carry Hanja (Han characters) alongside native Hangul on the
// same line, and 한글 맞춤법's own punctuation uses ASCII `,` correctly --
// GB/T 15834-2011 §1 scopes itself to 汉语的书面语 (Chinese written
// language), so a Korean line is OUTSIDE the standard entirely, not merely
// a different dialect of it. RULED: any Hangul on the line VETOES 'zh', the
// identical mechanism as the Kana veto above, checked in classifyLine()
// BEFORE the Han test -- never a majority-script count (this is a
// CONFIRMED-severity rule in an anti-cry-wolf suite; precision over recall,
// YAGNI on the heuristic). THE PRICE: a ZH line carrying one Hangul name
// now misses (see the recall-gaps list below).
//
// A THIRD, NAMED BOUNDED MISREAD (LOW-2, r34 INSPECT): Traditional Chinese
// text (Taiwan/HK) resolves 'zh' and is reported under GB/T 15834-2011 --
// the PRC national standard. The finding is TRUE in substance (Taiwan's own
// 重訂標點符號手冊 also uses full-width point marks placed the same way),
// but the authority label is the wrong standard, the same shape as the
// all-Kanji JA misread above. Not fixed this round: a Traditional-vs-
// Simplified Han split (and a second authority table for it) is a future
// unit's work, not this exemplar's.
//
// RECALL GAPS -- named, not hidden (LOW-3, r34 INSPECT). None of these is a
// false claim; each reads 0 and is DELIBERATELY not covered by this round's
// two rules:
//   - an ASCII comma immediately followed by a SPACE (`你好, 再见`) -- the
//     lookahead requires a Han character immediately after the punct
//   - a ZH line carrying one Katakana loanword, or U+30FB `・` (JLReq's own
//     interpunct) -- the whole line resolves 'ja' per the veto above,
//     suppressing every zh-* finding on it
//   - a ZH line carrying one Hangul word/name -- the same veto, KO side
//   - U+3000 (ideographic space) or a tab before a full-width point mark --
//     ZH_SPACE_BEFORE_PUNCT_RE matches only the ASCII space run
//
// CLI EXIT CONTRACT, load-bearing (r32 paid for this once already):
// exit 0 on a findings run -- exactly md-checks.mjs's shape, so a skill
// reads the summary/--json, never the exit code. exit 1 ONLY on an
// unreadable file or an internal crash. Any CI wrapper tests the summary
// line, never the exit code, the same lesson link-check.yml already learned.
//
// BUILD-ONLY, generated into doc-quality's own skill folder from this ONE
// source -- the emdash.mjs shape (see build-plugin.mjs's GENERATED map +
// BUILD_ONLY_LIB_NAMES), never a second hand-tracked copy. Standalone by
// design (no cross-import of emdash.mjs or any sibling engine): doc-quality
// ships two independent, self-contained engines side by side, the same way
// doc-structure's md-ast.mjs/md-checks.mjs pair is its OWN independent unit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Script ranges (CWK-101-DESIGN §2) -- detection by CODEPOINT, never by a
// file's declared language.
// ---------------------------------------------------------------------------
const HAN_RE = /[一-鿿㐀-䶿]/;
const KANA_RE = /[぀-ゟ゠-ヿ]/;
const HANGUL_RE = /[가-힯ᄀ-ᇿ㄰-㆏]/;
const THAI_RE = /[฀-๿]/;

// Resolve ONE line's script, post-masking (a code span's own script must
// never influence the surrounding prose's classification): any Kana => 'ja'
// (Han-shared ambiguity resolved toward JA); any Hangul => 'ko' (HIGH-1,
// r34 INSPECT -- the identical veto, checked BEFORE Han: a Korean sentence
// writing a place name in Hanja is outside GB/T 15834-2011's own §1 scope,
// 汉语的书面语, so letting Han win there is a false positive, not a bounded
// misread); Han with neither Kana nor Hangul => 'zh'; else Thai => 'th',
// else null (Latin/no script of interest).
//
// RULED (design question the reviewer raised): VETO, never a majority-
// script count. This is a CONFIRMED-severity rule in a suite whose thesis
// is anti-cry-wolf -- precision beats recall, and "majority script" is a
// heuristic with its own edge cases (YAGNI). THE PRICE, named rather than
// hidden: a ZH line carrying one Katakana loanword or one Hangul name now
// MISSES -- see LOW-3 in the header below.
function classifyLine(line) {
  if (KANA_RE.test(line)) return 'ja';
  if (HANGUL_RE.test(line)) return 'ko';
  if (HAN_RE.test(line)) return 'zh';
  if (THAI_RE.test(line)) return 'th';
  return null;
}

// ---------------------------------------------------------------------------
// RULES -- the tracked, load-bearing table (CWK-101-DESIGN's own working
// copy is a RECORD; this header + this table are the CONTRACT).
// ---------------------------------------------------------------------------
export const RULES = {
  'zh-halfwidth-punct': {
    id: 'zh-halfwidth-punct',
    script: 'zh',
    severity: 'error',
    description: 'an ASCII , ; : ? ! with a Han character on both sides (no Kana on the line) -- Chinese uses the full-width point mark',
    // LOW-1 (r34 INSPECT), completed against the primary text directly
    // (people.ubuntu.com mirror of GB/T 15834-2011, re-fetched and quoted
    // raw, never copied from a paraphrase): the FORM clause differs per
    // character -- §4.4.2 (逗号的形式是"，"), §4.6.2 (分号的形式是"；"),
    // §4.7.2 (冒号的形式是"："), §4.2.2 (问号的形式是"？"), §4.3.2
    // (叹号的形式是"！") -- and PLACEMENT is TWO separate clauses, not one:
    // §5.1.1 covers only 句号、逗号、顿号、分号、冒号 (period/comma/dun-mark/
    // semicolon/colon); §5.1.2 covers 问号、叹号 (question/exclamation mark)
    // on its own, the same rule restated for a different character set.
    authority: 'GB/T 15834-2011《标点符号用法》-- forms: §4.4.2 (，), §4.6.2 (；), §4.7.2 (：), §4.2.2 (？), §4.3.2 (！); placement: §5.1.1 (，；： -- 置于相应文字之后，占一个字位置) and §5.1.2 (？！ -- the identical rule, a separate clause)',
  },
  'zh-space-before-punct': {
    id: 'zh-space-before-punct',
    script: 'zh',
    severity: 'error',
    description: 'one or more spaces between a Han character and a following full-width point mark ，。、；：？！',
    // LOW-1: the same two-clause split as above -- ，。、；： under §5.1.1,
    // ？！ under §5.1.2, never folded into one citation.
    authority: 'GB/T 15834-2011《标点符号用法》§5.1.1 (句号、逗号、顿号、分号、冒号均置于相应文字之后，占一个字位置 -- covers 。，、；：) and §5.1.2 (问号、叹号均置于相应文字之后，占一个字位置 -- covers ？！, a separate clause)',
  },
};

// Group 1 is the defect span itself (the ASCII punct, or the space run) --
// the lookaround on both sides is zero-width so it never appears in the
// match, and matchAll resets lastIndex per call so adjacent hits (a run of
// several half-width commas) are each found independently.
const ZH_HALFWIDTH_PUNCT_RE = /(?<=[一-鿿㐀-䶿])([,;:?!])(?=[一-鿿㐀-䶿])/g;
const ZH_SPACE_BEFORE_PUNCT_RE = /(?<=[一-鿿㐀-䶿])( +)(?=[，。、；：？！])/g;

// Each CHECKS entry: [id, RegExp]. A rule fires on a line only when
// classifyLine(line) matches ITS OWN `script` field (CWK-101-DESIGN §2's
// "a rule table fires only on runs of ITS script").
const CHECKS = [
  ['zh-halfwidth-punct', ZH_HALFWIDTH_PUNCT_RE],
  ['zh-space-before-punct', ZH_SPACE_BEFORE_PUNCT_RE],
];

// ---------------------------------------------------------------------------
// Markdown awareness -- STATE THE EXCLUSION, never "exactly like" another
// file (MED-1, r34 INSPECT: that phrasing shipped false -- the first cut
// dropped the indented-code exclusion and left the HTML/front-matter gaps
// below). What this engine excludes, exhaustively:
//   - a fenced code block (``` or ~~~), skipped whole
//   - inline code (`...`) and a link destination (](...)), masked same-
//     length so adjacency is preserved and no hit is manufactured
//   - a bare http(s):// URL, masked the same way
//   - an HTML comment or tag (<...>), masked up to its first `>` -- covers
//     an attribute or a comment body containing a space
//   - a blockquote line (`>`-prefixed), skipped whole
//   - a 4-space-indented code block, skipped whole (parity with
//     emdash.mjs:207-214's own rule and its stated trade: an indented
//     list-continuation line is over-excluded too, a miss never a hit)
//   - a YAML front matter block, ONLY when it opens the document
// ---------------------------------------------------------------------------
const mask = (s) => 'x'.repeat(s.length);

function maskInline(line) {
  let out = line.replace(/(`+)[\s\S]*?\1/g, mask);
  out = out.replace(/\]\([^)]*\)/g, mask);
  // MED-1 (r34 INSPECT): the prior `<[^ >]*>` stopped at the FIRST space, so
  // any HTML comment or tag carrying a space or an attribute (`<!-- 注释, -->`,
  // `<span title="中,文">`) left its content unmasked. Masking up to the
  // first `>` instead fixed that -- but r34 RE-INSPECT (INFO, ruled by the
  // coder) found the widened form also swallowed ORDINARY PROSE bracketed
  // by a bare `<`...`>` with no tag shape at all (`如果甲<乙,那么丙>丁`), a
  // MISS. Requiring a real tag/comment/closing-tag opener right after `<`
  // (a letter, `/`, `!`, or `?` -- what every real HTML construct starts
  // with, and a Han/CJK character never is) closes that miss without
  // reopening MED-1: a `>` inside a quoted attribute value would still end
  // the mask early, an accepted, unlikely edge (emdash.mjs's own tag mask
  // carries the same shape).
  out = out.replace(/<[a-zA-Z!/?][^>]*>/g, mask);
  out = out.replace(/https?:\/\/\S+/g, mask);
  return out;
}

function fenceInfo(line) {
  const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
  return m ? { ch: m[1][0], len: m[1].length } : null;
}

// LICENSE/NOTICE/COPYING-class files, and a <!-- third-party-text --> own-
// line marker for verbatim third-party wording elsewhere -- the identical
// two exclusions emdash.mjs ships, kept as an independent local copy rather
// than a cross-import (doc-quality's two engines are each self-contained).
const LEGAL_BASENAME_RE = /^(LICENSE|NOTICE|COPYING)(\..+)?$/i;
export function isLegalPath(file) {
  return LEGAL_BASENAME_RE.test(path.basename(file));
}
export const THIRD_PARTY_MARKER = '<!-- third-party-text -->';
const THIRD_PARTY_MARKER_RE = new RegExp(
  '^[ \\t]*' + THIRD_PARTY_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*$',
  'm'
);

/**
 * Scan one document's text for language-mechanics findings. Returns
 * [{ rule, script, severity, authority, line, col, length, snippet }] --
 * 1-based line.
 * Pure: takes text, never touches the filesystem, so a test can drive it.
 *
 * opts.plain disables all markdown awareness (fence/inline-code/URL/
 * blockquote handling) -- for a non-markdown source. opts.script restricts
 * to rules whose own `script` field matches (CLI's `--script`).
 */
export function checkText(text, opts = {}) {
  if (THIRD_PARTY_MARKER_RE.test(String(text))) return [];
  const checks = opts.script ? CHECKS.filter(([id]) => RULES[id].script === opts.script) : CHECKS;
  const findings = [];
  let fence = null;
  const lines = String(text).split(/\r?\n/);
  // MED-A (r34 RE-INSPECT): a `---` on line 0 is front matter ONLY if a
  // closing `---`/`...` line exists LATER in the text -- decided by a
  // LOOK-AHEAD, once, BEFORE the per-line loop, never discovered mid-scan.
  // Without this, an UNTERMINATED leading `---` (or a doc that simply opens
  // with a thematic break, which is what a lone `---` means in CommonMark)
  // set inFrontMatter TRUE and NEVER cleared it, silently skipping the
  // WHOLE REST OF THE DOCUMENT -- a false clean bill, the exact
  // anti-cry-wolf inversion this suite exists to prevent. frontMatterEnd is
  // the index of the FIRST later closing line found, so an extra `---`
  // thematic break further down in the body (after real front matter has
  // already closed) is correctly left as ordinary prose, never re-opens
  // skipping.
  // KNOWN, ACCEPTED TRADE (stated, not hidden): this look-ahead tests only
  // for EXISTENCE of a later closing line, not that the lines between look
  // like YAML -- two thematic breaks bracketing an ordinary paragraph
  // (`---\n\ntext\n\n---\n`) reads identically to real front matter and
  // that paragraph is skipped. A miss (treating real prose as metadata) is
  // the safe direction here, the same trade the indented-code exclusion
  // above already accepts.
  let frontMatterEnd = -1;
  if (!opts.plain && lines[0] !== undefined && lines[0].trim() === '---') {
    for (let j = 1; j < lines.length; j++) {
      if (lines[j].trim() === '---' || lines[j].trim() === '...') { frontMatterEnd = j; break; }
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!opts.plain) {
      if (frontMatterEnd !== -1 && i <= frontMatterEnd) continue; // whole front-matter block: metadata, never prose
      const f = fenceInfo(raw);
      if (fence) {
        if (f && f.ch === fence.ch && f.len >= fence.len) fence = null;
        continue; // inside a fence: content, never prose mechanics
      }
      if (f) { fence = f; continue; }
      if (/^\s{0,3}>/.test(raw)) continue; // blockquote: quoted matter
      // INDENTED CODE BLOCK (MED-1, r34 INSPECT): 4+ leading spaces is
      // Markdown's other code form -- parity with emdash.mjs's own
      // identical rule and its stated trade: indented CONTINUATION text
      // inside a list item is skipped too, so this OVER-excludes; a miss is
      // the safe direction, never a manufactured hit.
      if (/^ {4,}\S/.test(raw)) continue;
    }
    const line = opts.plain ? raw : maskInline(raw);
    const script = classifyLine(line);
    if (!script) continue;
    for (const [id, re] of checks) {
      if (RULES[id].script !== script) continue;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        findings.push({
          rule: id,
          script,
          severity: RULES[id].severity,
          // MED-2 (r34 INSPECT): SKILL.md step 2c promises a finding traces
          // to its cited standard via `authority` -- carried through here so
          // every consumer (the CLI's --json shape included) gets it, never
          // just the RULES table a caller has to cross-reference by hand.
          authority: RULES[id].authority,
          line: i + 1,
          col: m.index + 1,
          length: m[1] ? m[1].length : m[0].length,
          snippet: line.slice(Math.max(0, m.index - 12), m.index + (m[1] ? m[1].length : m[0].length) + 12),
        });
      }
    }
  }
  return findings;
}

export function checkFile(file, opts = {}) {
  if (isLegalPath(file)) return [];
  return checkText(fs.readFileSync(file, 'utf8'), opts);
}

// ---------------------------------------------------------------------------
// CLI: node lang-mechanics.mjs [--plain] [--json] [--script zh|ja|ko|...] <file...>
// Exit contract (load-bearing, see header): exit 0 on a findings run, exit 1
// ONLY on an unreadable file -- mirrors md-checks.mjs's own CLI exactly.
// ---------------------------------------------------------------------------
// MED-3 (r34 INSPECT): the original guard here compared import.meta.url
// against pathToFileURL(process.argv[1]) -- a LEXICAL compare, since
// import.meta.url is the loader's REALPATH of the entry while argv[1] is
// only path.resolve'd. Through a junction or a symlinked ~/.claude the two
// never matched and this shipped engine printed nothing and exited 0,
// reading as a clean bill. This room paid for the identical
// lexical-vs-realpath defect at CWK-078.
// fs.realpathSync.native on BOTH sides (.native, never plain -- plain does
// not expand a Windows 8.3 short name, AGENTS.md Hard-won lessons); an
// unresolvable path fails CLOSED (treated as NOT the entry) inside a
// try/catch that never throws past it -- an importer must still see its own
// exit code untouched (LOW-3). Duplicated per file, not shared: this file
// ships standalone into a copied skill folder with no scripts/lib sibling,
// so a shared helper would break the self-contained-engine property --
// kept identical across all six of this room's guarded scripts instead.
function isMainModule(url) {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync.native(fileURLToPath(url)) === fs.realpathSync.native(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const opts = { plain: args.includes('--plain'), json: args.includes('--json') };
  const scriptIdx = args.findIndex((a) => a === '--script');
  if (scriptIdx !== -1) opts.script = args[scriptIdx + 1];
  const files = args.filter((a, i) => !a.startsWith('--') && (scriptIdx === -1 || i !== scriptIdx + 1));
  if (!files.length) {
    console.error('usage: node lang-mechanics.mjs [--plain] [--json] [--script zh|ja|ko|...] <file.md> [more.md ...]');
    process.exitCode = 1;
  } else {
    const out = [];
    let total = 0;
    for (const f of files) {
      let findings;
      try {
        findings = checkFile(f, opts);
      } catch (e) {
        console.error(`FAIL ${f}: ${e && e.message ? e.message : e}`);
        process.exitCode = 1;
        continue;
      }
      total += findings.length;
      if (opts.json) {
        out.push({ file: f, findings });
      } else {
        for (const x of findings) console.log(`${f}:${x.line}:${x.col} [${x.rule}] ${RULES[x.rule].description} | ${JSON.stringify(x.snippet)}`);
      }
    }
    if (opts.json) console.log(JSON.stringify(out, null, 2));
    else console.log(`${total} finding(s) across ${files.length} file(s)`);
  }
}
