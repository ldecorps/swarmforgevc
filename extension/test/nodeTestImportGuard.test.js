'use strict';

// BL-1220: the guard's own tests. findNodeTestImportLines is the pure
// per-file scanner (fixture strings, no filesystem); findUnitLaneNodeTestImports
// is the real walk, proven break-then-fix against a scratch file before being
// trusted against the live tree.
//
// Every fixture below carries the literal string "node:test" as test DATA
// inside a quoted string. The scanner anchors on the import form at the start
// of a line, so this file is not a violation of its own rule - the
// self-referential-grep trap the ticket calls out by name.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  findNodeTestImportLines,
  isUnitLaneTestFile,
  findUnitLaneNodeTestImports,
} = require('./helpers/nodeTestImportGuard');

const TEST_DIR = __dirname;

// ── findNodeTestImportLines (pure) ──────────────────────────────────────

test('flags a destructured require of node:test', () => {
  assert.deepEqual(findNodeTestImportLines("const { test } = require('node:test');\n"), [1]);
});

test('flags a whole-module require of node:test', () => {
  assert.deepEqual(findNodeTestImportLines("const test = require('node:test');\n"), [1]);
});

test('flags an ESM import from node:test', () => {
  assert.deepEqual(findNodeTestImportLines("import { test } from 'node:test';\n"), [1]);
  assert.deepEqual(findNodeTestImportLines('import test from "node:test";\n'), [1]);
});

test('does not flag the string node:test appearing as data', () => {
  assert.deepEqual(
    findNodeTestImportLines('  const fixture = "const test=require(\'node:test\');";\n'),
    []
  );
  assert.deepEqual(findNodeTestImportLines("// a comment mentioning node:test\n"), []);
});

test('does not flag a require of node:assert', () => {
  assert.deepEqual(findNodeTestImportLines("const assert = require('node:assert/strict');\n"), []);
});

test('reports every offending line, not just the first', () => {
  const text = ["const { test } = require('node:test');", "const x = 1;", "const t2 = require('node:test');"].join(
    '\n'
  );
  assert.deepEqual(findNodeTestImportLines(text), [1, 3]);
});

// ── isUnitLaneTestFile (pure) ───────────────────────────────────────────

test('the unit lane owns *.test.js but not the property lane', () => {
  assert.equal(isUnitLaneTestFile('foo.test.js'), true);
  assert.equal(isUnitLaneTestFile('foo.property.test.js'), false);
  assert.equal(isUnitLaneTestFile('helpers/tmpDir.js'), false);
  // test/fixtures/** is a pinned task fixture the harness runs through a real
  // node --test child process; importing node:test there is correct.
  assert.equal(isUnitLaneTestFile('fixtures/task/foo.test.js'), false);
});

// ── findUnitLaneNodeTestImports (real walk) ─────────────────────────────

test('the guard fails on a reintroduced import and passes once it is removed', () => {
  const dir = mkTmpDir('bl1220-guard-');
  const offender = path.join(dir, 'scratch.test.js');
  fs.writeFileSync(offender, "const { test } = require('node:test');\ntest('x', () => {});\n");
  assert.deepEqual(findUnitLaneNodeTestImports(dir), [{ file: offender, line: 1 }]);

  fs.writeFileSync(offender, "test('x', () => {});\n");
  assert.deepEqual(findUnitLaneNodeTestImports(dir), []);
});

test('the guard leaves the property lane and pinned fixtures alone', () => {
  const dir = mkTmpDir('bl1220-guard-');
  fs.mkdirSync(path.join(dir, 'fixtures'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'thing.property.test.js'), "const { test } = require('node:test');\n");
  fs.writeFileSync(path.join(dir, 'fixtures', 'pinned.test.js'), "const { test } = require('node:test');\n");
  assert.deepEqual(findUnitLaneNodeTestImports(dir), []);
});

test('the real extension/test tree has no unit-lane node:test imports', () => {
  const violations = findUnitLaneNodeTestImports(TEST_DIR);
  assert.deepEqual(
    violations,
    [],
    `expected zero unit-lane node:test imports, found:\n${violations
      .map((v) => `  ${path.relative(TEST_DIR, v.file)}:${v.line}`)
      .join('\n')}`
  );
});
