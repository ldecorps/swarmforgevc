'use strict';

// BL-693: step handlers for "a markdown doc cannot ship the same prose
// paragraph twice" (specifier-authored feature, promoted from
// .feature.draft and wired in this same commit - BL-233, BL-1340,
// BL-1371). Drives the REAL scanDocsTree/findDuplicateLines/formatFinding
// functions the standing Vitest guard (extension/test/
// docsDuplicateParagraphGuard.test.js) itself uses, over real fixture
// files under mkdtemp - never a re-implementation of the guard's logic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FEATURE = 'a markdown doc cannot ship the same prose paragraph twice';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const GUARD_HELPER = path.join(REPO_ROOT, 'extension', 'test', 'helpers', 'docsDuplicateParagraphGuard.js');

const { DEFAULT_THRESHOLD, scanDocsTree, formatFinding } = require(GUARD_HELPER);

const LONG_LINE = 'p'.repeat(DEFAULT_THRESHOLD + 1);

// Explicit KNOWN_VALUES per the Scenario Outline handler rule (engineering
// rules): each Examples: <line> value is a real, representative structural
// markdown line - never a passthrough of the label text itself.
const STRUCTURAL_LINE_VALUES = new Map([
  ['horizontal rule', '---'],
  ['heading', '## Gaps'],
  ['code fence', '```'],
  ['table separator', '| --- | --- |'],
  ['list marker', '- '],
  ['blockquote marker', '>'],
  ['diagram glyph', '┌───┐'],
]);

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bl693-acc-'));
}

function writeFile(root, name, content) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, name), content);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the standing docs duplicate-paragraph guard$/, (ctx) => {
    ctx.scan = () => scanDocsTree(ctx.scannedTree, DEFAULT_THRESHOLD);
  });

  // ── Scenario 01 / 06 ─────────────────────────────────────────────────

  scoped(/^the scanned tree is the real docs directory after BL-692 landed$/, (ctx) => {
    ctx.scannedTree = DOCS_DIR;
  });

  scoped(/^the guard scans that tree$/, (ctx) => {
    ctx.findings = ctx.scan();
  });

  scoped(/^the guard passes$/, (ctx) => {
    assert.deepEqual(ctx.findings.map(formatFinding), [], `expected no findings, got: ${JSON.stringify(ctx.findings)}`);
  });

  scoped(/^the guard is inspected for per-file and per-paragraph allowlists$/, (ctx) => {
    ctx.guardSource = fs.readFileSync(GUARD_HELPER, 'utf8');
  });

  scoped(/^it declares none$/, (ctx) => {
    assert.doesNotMatch(
      ctx.guardSource,
      /\b[A-Z][A-Z_]*(?:EXEMPT|ALLOWLIST|IGNORE)[A-Z_]*\b/,
      'expected no per-file/per-paragraph allowlist identifier in the guard source'
    );
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────

  scoped(/^a markdown file with one substantial prose line appearing (\d+) times$/, (ctx, countToken) => {
    const count = Number(countToken);
    assert.ok(Number.isInteger(count) && count > 0, `bl693: bad count token ${countToken}`);
    ctx.scannedTree = mkFixtureRoot();
    ctx.fixtureFile = 'doc.md';
    ctx.fixtureCount = count;
    writeFile(ctx.scannedTree, ctx.fixtureFile, Array(count).fill(LONG_LINE).join('\n'));
  });

  scoped(/^the guard fails$/, (ctx) => {
    assert.ok(ctx.findings.length > 0, 'expected at least one finding');
  });

  scoped(/^the report names the file, the repeated text, (\d+) occurrences, and the line numbers$/, (ctx, countToken) => {
    const count = Number(countToken);
    assert.equal(ctx.findings.length, 1, `expected exactly one finding group, got: ${JSON.stringify(ctx.findings)}`);
    const [finding] = ctx.findings;
    assert.match(finding.file, new RegExp(`${ctx.fixtureFile.replace('.', '\\.')}$`));
    assert.equal(finding.text, LONG_LINE);
    assert.equal(finding.count, count);
    assert.equal(finding.lines.length, count);
  });

  scoped(/^removing all but one copy clears the report$/, (ctx) => {
    writeFile(ctx.scannedTree, ctx.fixtureFile, LONG_LINE);
    const after = ctx.scan();
    assert.deepEqual(after, [], `expected no findings after dedup, got: ${JSON.stringify(after)}`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────

  scoped(/^a markdown file repeating only the short structural line (.+)$/, (ctx, lineToken) => {
    const line = STRUCTURAL_LINE_VALUES.get(lineToken);
    assert.ok(line !== undefined, `bl693: unknown structural line in Examples: ${lineToken}`);
    ctx.scannedTree = mkFixtureRoot();
    writeFile(ctx.scannedTree, 'doc.md', Array(50).fill(line).join('\n'));
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────

  scoped(/^two markdown files sharing one substantial prose line$/, (ctx) => {
    ctx.scannedTree = mkFixtureRoot();
    writeFile(ctx.scannedTree, 'a.md', LONG_LINE);
    writeFile(ctx.scannedTree, 'b.md', LONG_LINE);
  });

  // ── Scenario 05 ──────────────────────────────────────────────────────

  scoped(/^a clean markdown file and a markdown file with a repeated substantial prose line$/, (ctx) => {
    ctx.scannedTree = mkFixtureRoot();
    writeFile(ctx.scannedTree, 'clean.md', 'nothing substantial here');
    ctx.fixtureFile = 'dirty.md';
    writeFile(ctx.scannedTree, ctx.fixtureFile, [LONG_LINE, LONG_LINE].join('\n'));
  });

  scoped(/^the report names the second file$/, (ctx) => {
    assert.equal(ctx.findings.length, 1, `expected exactly one finding, got: ${JSON.stringify(ctx.findings)}`);
    assert.match(ctx.findings[0].file, /dirty\.md$/);
  });
}

module.exports = { registerSteps };
