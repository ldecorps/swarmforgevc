const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DIVIO_MODES,
  DIVIO_MODE_ORIENTATIONS,
  computeDocsStructureReport,
  computeDocsStructure,
} = require('../out/docs/docsStructure');

// BL-456: the Divio four-mode docs-structure validator. computeDocsStructureReport
// is the pure seam (a fixed {modes, indexContent} input); computeDocsStructure is
// the one impure orchestrator, exercised end-to-end against a real fixture tree.

function emptyModes(overrides = {}) {
  const modes = {};
  for (const mode of DIVIO_MODES) {
    modes[mode] = { exists: true, files: ['a.md'] };
  }
  return { ...modes, ...overrides };
}

function fullIndex() {
  return [
    '## Tutorials',
    '*Learning-oriented: a guided first experience.*',
    '- [a](tutorials/a.md)',
    '## How-to guides',
    '*Task-oriented: recipes.*',
    '- [a](how-to/a.md)',
    '## Reference',
    '*Information-oriented: exhaustive descriptions.*',
    '- [a](reference/a.md)',
    '## Explanation',
    '*Understanding-oriented: rationale.*',
    '- [a](explanation/a.md)',
  ].join('\n');
}

// ── computeDocsStructureReport (pure) ────────────────────────────────────

test('divio-docs-01: a mode directory that does not exist is reported missing', () => {
  const modes = emptyModes({ 'how-to': { exists: false, files: [] } });
  const report = computeDocsStructureReport({ modes, indexContent: fullIndex() });
  assert.deepEqual(report.missingModeDirs, ['how-to']);
});

test('divio-docs-01: all four modes present reports no missing directories', () => {
  const report = computeDocsStructureReport({ modes: emptyModes(), indexContent: fullIndex() });
  assert.deepEqual(report.missingModeDirs, []);
});

// divio-docs-02 (Scenario Outline: each mode classified with its orientation)
for (const mode of DIVIO_MODES) {
  test(`divio-docs-02: the "${mode}" mode is recognized as classified with its "${DIVIO_MODE_ORIENTATIONS[mode]}" orientation`, () => {
    const report = computeDocsStructureReport({ modes: emptyModes(), indexContent: fullIndex() });
    assert.ok(!report.modesWithoutOrientation.includes(mode), `expected ${mode} to be classified`);
  });
}

test('divio-docs-02: a mode missing its orientation word in the index is flagged', () => {
  const index = fullIndex().replace('*Task-oriented: recipes.*', '*(no orientation stated)*');
  const report = computeDocsStructureReport({ modes: emptyModes(), indexContent: index });
  assert.deepEqual(report.modesWithoutOrientation, ['how-to']);
});

test('divio-docs-02: an incidental earlier mention of a mode name in prose does not fool the classifier away from its real heading', () => {
  // Regression: docs/index.md's own intro prose mentions "Reference" (linking
  // the diagrams "from Reference below") before the real "## Reference"
  // heading - a naive first-occurrence substring search anchors on that
  // incidental mention and never reaches the real section's orientation word.
  const index = `This intro links the diagrams from Reference below.\n\n${fullIndex()}`;
  const report = computeDocsStructureReport({ modes: emptyModes(), indexContent: index });
  assert.ok(!report.modesWithoutOrientation.includes('reference'), 'expected reference to still be classified via its real heading');
});

test('divio-docs-02: a missing index.md flags every mode as unclassified', () => {
  const report = computeDocsStructureReport({ modes: emptyModes(), indexContent: null });
  assert.deepEqual(report.modesWithoutOrientation, [...DIVIO_MODES]);
  assert.equal(report.indexMissing, true);
});

test('divio-docs-03: a mode directory with zero files is reported empty', () => {
  const modes = emptyModes({ explanation: { exists: true, files: [] } });
  const report = computeDocsStructureReport({ modes, indexContent: fullIndex() });
  assert.deepEqual(report.emptyModeDirs, ['explanation']);
});

test('divio-docs-03: a missing directory is not double-counted as empty', () => {
  const modes = emptyModes({ explanation: { exists: false, files: [] } });
  const report = computeDocsStructureReport({ modes, indexContent: fullIndex() });
  assert.deepEqual(report.emptyModeDirs, []);
  assert.deepEqual(report.missingModeDirs, ['explanation']);
});

test('divio-docs-04: every authored doc linked from the index is not orphaned', () => {
  const report = computeDocsStructureReport({ modes: emptyModes(), indexContent: fullIndex() });
  assert.deepEqual(report.orphanedDocs, []);
});

test('divio-docs-04: a doc absent from the index is reported orphaned', () => {
  const modes = emptyModes({ reference: { exists: true, files: ['a.md', 'unlinked.md'] } });
  const report = computeDocsStructureReport({ modes, indexContent: fullIndex() });
  assert.deepEqual(report.orphanedDocs, [{ mode: 'reference', file: 'unlinked.md' }]);
});

test('divio-docs-04: a nested doc is matched by its mode-relative path', () => {
  const modes = emptyModes({ reference: { exists: true, files: ['specs/BL-007-spec.md'] } });
  const index = fullIndex().replace('- [a](reference/a.md)', '- [spec](reference/specs/BL-007-spec.md)');
  const report = computeDocsStructureReport({ modes, indexContent: index });
  assert.deepEqual(report.orphanedDocs, []);
});

test('divio-docs-04: a URL-encoded space in the index link still matches a doc with a real space in its name', () => {
  const modes = emptyModes({ explanation: { exists: true, files: ['Milestone Roadmap.MD'] } });
  const index = fullIndex().replace('- [a](explanation/a.md)', '- [r](explanation/Milestone%20Roadmap.MD)');
  const report = computeDocsStructureReport({ modes, indexContent: index });
  assert.deepEqual(report.orphanedDocs, []);
});

test('a missing index.md reports every doc in every mode as orphaned, never a crash', () => {
  const report = computeDocsStructureReport({ modes: emptyModes(), indexContent: null });
  assert.deepEqual(report.orphanedDocs, []);
});

// ── computeDocsStructure (impure, real fixture tree) ─────────────────────

function mkTmp() {
  return mkTmpDir('sfvc-docs-structure-');
}

test('computeDocsStructure reads a real fixture tree end to end', () => {
  const root = mkTmp();
  for (const mode of DIVIO_MODES) {
    fs.mkdirSync(path.join(root, 'docs', mode), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', mode, 'a.md'), '# a');
  }
  fs.writeFileSync(path.join(root, 'docs', 'index.md'), fullIndex());

  const report = computeDocsStructure(root);
  assert.deepEqual(report.missingModeDirs, []);
  assert.deepEqual(report.emptyModeDirs, []);
  assert.deepEqual(report.modesWithoutOrientation, []);
  assert.deepEqual(report.orphanedDocs, []);
  assert.equal(report.indexMissing, false);
});

test('computeDocsStructure over an empty target reports every mode missing and the index missing, never a crash', () => {
  const root = mkTmp();
  const report = computeDocsStructure(root);
  assert.deepEqual(report.missingModeDirs, [...DIVIO_MODES]);
  assert.equal(report.indexMissing, true);
});
