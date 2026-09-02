const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { computeDocsStructure } = require('../out/docs/docsStructure');
const {
  KNOWN_ORPHAN_ALLOWLIST_REL,
  filterNonAllowlistedOrphans,
  loadKnownOrphanAllowlist,
  parseAllowlistTsv,
  allowlistEntriesHaveDates,
} = require('../out/docs/docsOrphanAllowlist');

// BL-1066: a fixed `../..` walk-up from __dirname lands one level too
// shallow under a Stryker sandbox (the sandbox dir IS the extension root,
// not a child of one), so every REPO_ROOT-relative path below silently
// missed under Stryker's dry run. `git rev-parse --show-toplevel` finds the
// true repo root regardless of sandbox nesting.
const REPO_ROOT = execFileSync('git', ['-C', __dirname, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const REAL_TREE_TEST = path.join(__dirname, 'docsStructureRealTree.test.js');

const BL756_CLEARED = [
  'how-to/BL-623-routing-skip-trail-records-actual-hop.md',
  'how-to/BL-637-lifecycle-script-scope.md',
  'how-to/BL-641-pages-deploy-timeout-and-action-majors.md',
  'how-to/BL-642-gate-snippet-question-not-chrome.md',
  'how-to/BL-661-stage-skip-reasons-flow-style.md',
  'how-to/BL-662-paused-pager-shows-server-failure-reason.md',
  'how-to/BL-671-operator-runtime-fixture-sandbox.md',
  'how-to/BL-694-residual-word-allowlist-survives-stage-moves.md',
  'how-to/BL-718-bubble-talk-mirror-chunks-and-fails-loudly.md',
  'reference/specs/BL-627-pricing-table-correctness-and-coverage-invariant.md',
];

test('BL-757: real-tree suite file calls computeDocsStructure on REPO_ROOT', () => {
  const text = fs.readFileSync(REAL_TREE_TEST, 'utf8');
  assert.match(text, /computeDocsStructure\s*\(\s*REPO_ROOT\s*\)/);
});

test('BL-757: known orphan allowlist entries carry ISO dates', () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, KNOWN_ORPHAN_ALLOWLIST_REL), 'utf8');
  assert.equal(allowlistEntriesHaveDates(parseAllowlistTsv(text)), true);
});

test('BL-757: BL-756 pilot-batch paths are not orphaned on the real tree', () => {
  const report = computeDocsStructure(REPO_ROOT);
  const keys = new Set(report.orphanedDocs.map((d) => `${d.mode}/${d.file}`));
  for (const cleared of BL756_CLEARED) {
    assert.equal(keys.has(cleared), false, `expected indexed: ${cleared}`);
  }
});

test('BL-757: real-tree suite passes when only allowlisted orphans remain', () => {
  const allowlist = loadKnownOrphanAllowlist(REPO_ROOT);
  assert.ok(allowlist.size > 0, 'allowlist must not be silently empty');
  const report = computeDocsStructure(REPO_ROOT);
  const violations = filterNonAllowlistedOrphans(report.orphanedDocs, allowlist);
  assert.deepEqual(
    violations,
    [],
    `non-allowlisted orphans: ${JSON.stringify(violations.map((d) => `${d.mode}/${d.file}`))}`
  );
});

test('BL-757: a non-allowlisted orphan fails the real-tree assertion', () => {
  const root = mkTmpDir('docs-structure-real-tree-fail-');
  const docs = path.join(root, 'docs');
  fs.mkdirSync(path.join(docs, 'how-to'), { recursive: true });
  fs.writeFileSync(path.join(docs, 'how-to', 'orphan.md'), '# orphan\n', 'utf8');
  fs.writeFileSync(
    path.join(docs, 'index.md'),
    '## How-to guides\n*Task-oriented: recipes.*\n',
    'utf8'
  );
  for (const mode of ['tutorials', 'reference', 'explanation']) {
    fs.mkdirSync(path.join(docs, mode), { recursive: true });
    fs.writeFileSync(path.join(docs, mode, 'a.md'), '# a\n', 'utf8');
    fs.appendFileSync(
      path.join(docs, 'index.md'),
      `\n## ${mode}\n*${mode}-oriented.*\n- [a](${mode}/a.md)\n`,
      'utf8'
    );
  }
  const report = computeDocsStructure(root);
  const violations = filterNonAllowlistedOrphans(report.orphanedDocs, new Set());
  assert.equal(violations.length, 1);
  assert.equal(violations[0].file, 'orphan.md');
});
