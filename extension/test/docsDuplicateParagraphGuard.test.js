'use strict';

// BL-693: the standing docs duplicate-paragraph guard, in the suite every
// parcel already runs - the same posture as tmpDirMigrationGuard.test.js.
// 830 KB of one repeated paragraph (BL-692) sat in
// docs/reference/Specification.MD for 17 days and ~25 documenter commits
// before anything objected. This is the assertion that would have caught it
// the same parcel it landed in.
//
// findDuplicateLines is the pure per-file scanner (fixture strings, no
// filesystem); scanDocsTree is the real directory walk over docs/, proven
// against real duplicated content by BL-692's own break-then-fix history
// (the real-tree assertion below is red until BL-692 lands, by design -
// depends_on: [BL-692]).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { DEFAULT_THRESHOLD, findDuplicateLines, scanDocsTree, formatFinding } = require('./helpers/docsDuplicateParagraphGuard');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');

// ── findDuplicateLines (pure) ────────────────────────────────────────────

test('a substantial line repeated twice is reported once, naming both line numbers', () => {
  const long = 'x'.repeat(DEFAULT_THRESHOLD + 1);
  const content = [long, 'short line', long].join('\n');
  const result = findDuplicateLines(content);
  assert.deepEqual(result, [{ text: long, count: 2, lines: [1, 3] }]);
});

test('a substantial line appearing once is never reported', () => {
  const long = 'y'.repeat(DEFAULT_THRESHOLD + 1);
  assert.deepEqual(findDuplicateLines(long), []);
});

test('a line at or under the threshold is never reported, however many times it repeats', () => {
  const short = 'z'.repeat(DEFAULT_THRESHOLD);
  const content = Array(50).fill(short).join('\n');
  assert.deepEqual(findDuplicateLines(content), []);
});

test('trimming: leading/trailing whitespace does not defeat the match', () => {
  const long = 'w'.repeat(DEFAULT_THRESHOLD + 1);
  const content = [`  ${long}  `, `\t${long}\t`].join('\n');
  assert.deepEqual(findDuplicateLines(content), [{ text: long, count: 2, lines: [1, 2] }]);
});

test('286 copies (BL-692 shape) are all counted and every line number named', () => {
  const long = 'v'.repeat(DEFAULT_THRESHOLD + 1);
  const content = Array(286).fill(long).join('\n');
  const result = findDuplicateLines(content);
  assert.equal(result.length, 1);
  assert.equal(result[0].count, 286);
  assert.equal(result[0].lines.length, 286);
});

test('two different substantial lines each repeated are both reported, independently', () => {
  const longA = 'a'.repeat(DEFAULT_THRESHOLD + 1);
  const longB = 'b'.repeat(DEFAULT_THRESHOLD + 1);
  const content = [longA, longB, longA, longB].join('\n');
  const result = findDuplicateLines(content);
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((r) => r.count),
    [2, 2]
  );
});

// ── structural markdown, however many times it repeats (invariant 1) ────
// Real structural lines are short by construction (a fence, a rule, a
// table separator, a bare list/blockquote marker, a diagram glyph) - the
// length threshold alone excludes them, deliberately with no separate
// structural-pattern classifier (BL-693's own design).

const STRUCTURAL_LINE_VALUES = new Map([
  ['horizontal rule', '---'],
  ['heading', '## Gaps'],
  ['code fence', '```'],
  ['table separator', '| --- | --- |'],
  ['list marker', '- '],
  ['blockquote marker', '>'],
  ['diagram glyph', '┌───┐'],
]);

for (const [kind, line] of STRUCTURAL_LINE_VALUES) {
  test(`a repeated structural line (${kind}) is never reported`, () => {
    const content = Array(50).fill(line).join('\n');
    assert.deepEqual(findDuplicateLines(content), []);
  });
}

// ── formatFinding ─────────────────────────────────────────────────────────

test('formatFinding names the file, the (truncated) text, the count and the line numbers', () => {
  const long = 'q'.repeat(300);
  const line = formatFinding({ file: '/x/y.md', text: long, count: 3, lines: [4, 9, 12] });
  assert.match(line, /\/x\/y\.md/);
  assert.match(line, /repeated 3 times/);
  assert.match(line, /4, 9, 12/);
  assert.ok(line.length < long.length, 'the repeated text must be truncated, not embedded whole');
});

// BL-693 hardener: the 300-char fixture above exercises only the
// well-over-80 case - it cannot tell `text.length > 80` from `>= 80`
// (both truncate). Pin the boundary itself: exactly 80 chars must NOT be
// truncated (text is over the guard's own 200-char substantiality
// threshold, so this is a real reportable finding, just a short one).
test('formatFinding does not truncate text at or under 80 characters', () => {
  const exactly80 = 'e'.repeat(80);
  const line = formatFinding({ file: '/x/y.md', text: exactly80, count: 2, lines: [1, 2] });
  assert.match(line, new RegExp(`"${exactly80}"`), 'text exactly at the truncation boundary must appear in full, not cut short');
});

// ── scanDocsTree (impure, real fs) - break-then-fix ─────────────────────

function writeFile(dir, name, content) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

test('scanDocsTree finds a duplicate within one file', () => {
  const root = mkTmpDir('bl693-scan-');
  const long = 'p'.repeat(DEFAULT_THRESHOLD + 1);
  writeFile(root, 'a.md', [long, long].join('\n'));
  const findings = scanDocsTree(root);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].count, 2);
});

test('scanDocsTree never reports the same line shared across two different files', () => {
  const root = mkTmpDir('bl693-scan-');
  const long = 'r'.repeat(DEFAULT_THRESHOLD + 1);
  writeFile(root, 'a.md', long);
  writeFile(root, 'b.md', long);
  assert.deepEqual(scanDocsTree(root), []);
});

test('scanDocsTree checks every file, not just the first', () => {
  const root = mkTmpDir('bl693-scan-');
  const long = 's'.repeat(DEFAULT_THRESHOLD + 1);
  writeFile(root, 'clean.md', 'nothing to see here');
  writeFile(root, 'dirty.md', [long, long].join('\n'));
  const findings = scanDocsTree(root);
  assert.equal(findings.length, 1);
  assert.match(findings[0].file, /dirty\.md$/);
});

test('break-then-fix: a real duplicate paragraph pasted a second time turns the guard red, then removing it clears', () => {
  const root = mkTmpDir('bl693-scan-');
  const paragraph =
    'This is a substantial paragraph of prose long enough to cross the guard\'s two-hundred-character substantiality threshold entirely on its own, deliberately, ' +
    'with no help from any other line in the file, written out at length so the count is not in doubt.';
  assert.ok(paragraph.length > DEFAULT_THRESHOLD, 'fixture paragraph must itself exceed the threshold');
  writeFile(root, 'doc.md', `${paragraph}\n\nSome other unrelated text.\n`);
  assert.deepEqual(scanDocsTree(root), [], 'clean before the paste');

  writeFile(root, 'doc.md', `${paragraph}\n\nSome other unrelated text.\n\n${paragraph}\n`);
  const findings = scanDocsTree(root);
  assert.equal(findings.length, 1, 'red after the paste');
  assert.equal(findings[0].count, 2);

  writeFile(root, 'doc.md', `${paragraph}\n\nSome other unrelated text.\n`);
  assert.deepEqual(scanDocsTree(root), [], 'green again after removing the paste');
});

// ── the real docs tree, and the no-exemption-list invariant ─────────────

test('the real docs tree repeats no substantial paragraph', () => {
  const findings = scanDocsTree(DOCS_DIR);
  assert.deepEqual(
    findings.map(formatFinding),
    [],
    'a substantial paragraph repeats within one docs file - see the printed finding(s) for file, text, count and line numbers'
  );
});

test('the guard reaches green with no per-file or per-paragraph exemption list', () => {
  const guardSource = fs.readFileSync(path.join(__dirname, 'helpers', 'docsDuplicateParagraphGuard.js'), 'utf8');
  // Code-shaped identifiers only (ALL_CAPS_WITH_UNDERSCORES) - never a bare
  // substring match, which would also trip on this very file's own prose
  // explaining that no such list exists.
  assert.doesNotMatch(
    guardSource,
    /\b[A-Z][A-Z_]*(?:EXEMPT|ALLOWLIST|IGNORE)[A-Z_]*\b/,
    'the guard must reach green through the substantiality threshold alone, never a per-file/per-paragraph exemption list'
  );
});
