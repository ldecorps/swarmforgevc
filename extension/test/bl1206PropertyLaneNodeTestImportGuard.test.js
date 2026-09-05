'use strict';

// BL-1206: the property lane's own analog of BL-1220's unit-lane guard
// tests. isPropertyLaneTestFile / findPropertyLaneNodeTestImports are new
// here; findNodeTestImportLines itself is BL-1220's, already proven
// data-vs-import-safe by its own property test (nodeTestImportGuard.property.test.js,
// 400 runs) - not re-proven here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { isPropertyLaneTestFile, findPropertyLaneNodeTestImports } = require('./helpers/nodeTestImportGuard');

const TEST_DIR = __dirname;

test('the property lane owns *.property.test.js but not the unit lane', () => {
  assert.equal(isPropertyLaneTestFile('foo.property.test.js'), true);
  assert.equal(isPropertyLaneTestFile('foo.test.js'), false);
  assert.equal(isPropertyLaneTestFile('helpers/tmpDir.js'), false);
  assert.equal(isPropertyLaneTestFile('nested/deep/foo.property.test.js'), true);
});

test('the guard fails on a reintroduced import and passes once it is removed', () => {
  const dir = mkTmpDir('bl1206-guard-');
  const offender = path.join(dir, 'scratch.property.test.js');
  fs.writeFileSync(offender, "const { test } = require('node:test');\ntest('x', () => {});\n");
  assert.deepEqual(findPropertyLaneNodeTestImports(dir), [{ file: offender, line: 1 }]);

  fs.writeFileSync(offender, "test('x', () => {});\n");
  assert.deepEqual(findPropertyLaneNodeTestImports(dir), []);
});

test('the guard leaves the unit lane alone', () => {
  const dir = mkTmpDir('bl1206-guard-');
  fs.writeFileSync(path.join(dir, 'thing.test.js'), "const { test } = require('node:test');\n");
  assert.deepEqual(findPropertyLaneNodeTestImports(dir), []);
});

test('the real extension/test tree has no property-lane node:test imports', () => {
  const violations = findPropertyLaneNodeTestImports(TEST_DIR);
  assert.deepEqual(
    violations,
    [],
    `expected zero property-lane node:test imports, found:\n${violations
      .map((v) => `  ${path.relative(TEST_DIR, v.file)}:${v.line}`)
      .join('\n')}`
  );
});
