'use strict';

// BL-693: the docs tree's repeated-paragraph guard. 830 KB of one repeated
// paragraph sat in docs/reference/Specification.MD for 17 days and ~25
// documenter commits before anything objected - nothing in the repo lints
// prose. Measured against the real tree (2026-07-27, re-measured 2026-08-10
// and 2026-09-18): a trimmed line over 200 characters repeating within one
// file finds exactly the corruption and nothing else, with NO per-file or
// per-paragraph exemption list. Markdown structure that legitimately
// repeats (fences, rules, table separators, list/blockquote markers,
// diagram glyphs) is short by construction, so the length threshold alone
// excludes it - deliberately no separate structural-pattern classifier, per
// the ticket's own design (see BL-693's description).

const { walkFilesTolerant } = require('./tolerantTreeWalk');

const DEFAULT_THRESHOLD = 200;

// findDuplicateLines(content, threshold) -> [{ text, count, lines: [n, ...] }]
// Pure: given one file's raw content, the trimmed lines over `threshold`
// characters that appear more than once, each with every 1-based line
// number it occurs at (in the order first seen). No filesystem.
function findDuplicateLines(content, threshold = DEFAULT_THRESHOLD) {
  const seen = new Map(); // trimmed text -> line numbers
  const order = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.length <= threshold) continue;
    if (!seen.has(trimmed)) {
      seen.set(trimmed, []);
      order.push(trimmed);
    }
    seen.get(trimmed).push(i + 1);
  }
  const duplicates = [];
  for (const text of order) {
    const lineNumbers = seen.get(text);
    if (lineNumbers.length > 1) {
      duplicates.push({ text, count: lineNumbers.length, lines: lineNumbers });
    }
  }
  return duplicates;
}

// scanDocsTree(docsDir, threshold) -> [{ file, text, count, lines }]
// Impure: every markdown file under docsDir (the shared tolerant walk, so a
// file that vanishes mid-scan is skipped, never a false crash), each
// checked ONLY against its own content - repetition of the same line
// across two different files is never reported (within-file scope is the
// ticket's own constraint).
function scanDocsTree(docsDir, threshold = DEFAULT_THRESHOLD) {
  const findings = [];
  for (const { path: file, content } of walkFilesTolerant(docsDir, { extension: '.md', withContent: true })) {
    for (const dup of findDuplicateLines(content, threshold)) {
      findings.push({ file, ...dup });
    }
  }
  return findings;
}

// A short, readable report line per finding - names the file, the
// truncated repeated text, the occurrence count and every line number, so
// the reader can act without opening the file.
function formatFinding({ file, text, count, lines }) {
  const truncated = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  return `${file}: "${truncated}" repeated ${count} times at lines ${lines.join(', ')}`;
}

module.exports = { DEFAULT_THRESHOLD, findDuplicateLines, scanDocsTree, formatFinding };
