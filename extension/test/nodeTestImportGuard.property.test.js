'use strict';

// BL-1220 invariants 1 and 2, encoded over the guard that makes them true.
//
// Invariant 1: "No file in the unit lane declares its tests to a runner the
// lane does not execute." The guard is what keeps that true going forward, so
// the property quantifies over the shapes a declaration can take: any import
// form, at any line, in any surrounding file - against any appearance of the
// same string as DATA, which must never be flagged. That boundary is the whole
// defect surface: a scanner that misses a form lets the darkness back in, and
// one that flags data flags itself.
//
// Invariant 2: "A test file contributing zero collected tests fails its lane;
// it is never allowlisted, skipped, or deleted into a pass." Encoded as: the
// walk has no skip path - however many violations exist, every one is
// reported, and no input makes the guard return a pass while a violation
// stands. The property lane and pinned fixtures are OUT of the lane rather
// than exempted within it, which the third property pins.
//
// Generator reach: the import form, the data form, the line position and the
// file's other content are drawn independently, and each property asserts a
// floor on the classes it depends on rather than hoping the draw covered them.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  findNodeTestImportLines,
  isUnitLaneTestFile,
  findUnitLaneNodeTestImports,
} = require('./helpers/nodeTestImportGuard');

// Every shape a real declaration takes. `describe`/`it` destructuring is the
// form humanLoopReliability.test.js carried; the bare require is devBounceLib's.
const IMPORT_FORMS = [
  "const { test } = require('node:test');",
  'const { test } = require("node:test");',
  "const { describe, it, beforeEach, afterEach } = require('node:test');",
  "const test = require('node:test');",
  "import { test } from 'node:test';",
  'import test from "node:test";',
  "import 'node:test';",
];

// The same string as DATA. None of these declares anything to any runner.
const DATA_FORMS = [
  '  const fixture = "const test=require(\'node:test\');";',
  '// BL-1220: files that import from node:test collect nothing',
  "  assert.match(message, /node:test/);",
  "  const spec = { runner: 'node:test' };",
  '   * a comment describing require(\'node:test\') in prose',
];

const FILLER = ["const assert = require('node:assert/strict');", "'use strict';", '', "const fs = require('fs');"];

test('property: every import form is flagged wherever it sits, and data forms never are', () => {
  let sawImport = 0;
  let sawData = 0;
  fc.assert(
    fc.property(
      fc.constantFrom(...IMPORT_FORMS),
      fc.constantFrom(...DATA_FORMS),
      fc.array(fc.constantFrom(...FILLER), { minLength: 0, maxLength: 6 }),
      fc.nat({ max: 6 }),
      fc.boolean(),
      (importForm, dataForm, filler, position, useImport) => {
        const lines = [...filler];
        const at = Math.min(position, lines.length);
        lines.splice(at, 0, useImport ? importForm : dataForm);
        const found = findNodeTestImportLines(lines.join('\n'));
        if (useImport) {
          sawImport += 1;
          assert.deepEqual(found, [at + 1], `missed ${importForm} at line ${at + 1}`);
          return;
        }
        sawData += 1;
        assert.deepEqual(found, [], `flagged data as an import: ${dataForm}`);
      }
    ),
    { numRuns: 400 }
  );
  // Reachability floor, asserted rather than hoped for: both sides of the
  // boundary the guard exists to draw must actually have been generated.
  assert.ok(sawImport > 60, `expected import forms to be drawn, saw ${sawImport}`);
  assert.ok(sawData > 60, `expected data forms to be drawn, saw ${sawData}`);
});

test('property: the walk reports every violation - there is no skip path', () => {
  let sawMultiple = 0;
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...IMPORT_FORMS), { minLength: 1, maxLength: 5 }),
      fc.array(fc.constantFrom(...FILLER), { minLength: 0, maxLength: 3 }),
      (imports, filler) => {
        const dir = mkTmpDir('bl1220-prop-');
        imports.forEach((form, i) => {
          fs.writeFileSync(path.join(dir, `offender${i}.test.js`), [...filler, form, "test('x', () => {});"].join('\n'));
        });
        fs.writeFileSync(path.join(dir, 'clean.test.js'), "test('x', () => {});\n");
        const violations = findUnitLaneNodeTestImports(dir);
        assert.equal(violations.length, imports.length, 'one violation per offending file, none skipped');
        for (let i = 0; i < imports.length; i += 1) {
          assert.ok(
            violations.some((v) => v.file.endsWith(`offender${i}.test.js`)),
            `offender${i} was not reported`
          );
        }
        if (imports.length > 1) {
          sawMultiple += 1;
        }
      }
    ),
    { numRuns: 60 }
  );
  // A guard that reported only the first violation would pass a
  // single-offender-only draw; the floor forces the multi-violation state.
  assert.ok(sawMultiple > 15, `expected multi-violation trees to be drawn, saw ${sawMultiple}`);
});

test('property: lane membership is decided by the lane globs, never by an exemption list', () => {
  let sawIn = 0;
  let sawOut = 0;
  fc.assert(
    fc.property(
      fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,12}$/),
      fc.constantFrom('.test.js', '.property.test.js', '.js'),
      fc.constantFrom('', 'fixtures/', 'helpers/', 'nested/deep/'),
      (base, suffix, dir) => {
        const inLane = isUnitLaneTestFile(`${dir}${base}${suffix}`);
        const expected = suffix === '.test.js' && !dir.startsWith('fixtures/');
        assert.equal(inLane, expected, `${dir}${base}${suffix}`);
        expected ? (sawIn += 1) : (sawOut += 1);
      }
    ),
    { numRuns: 200 }
  );
  assert.ok(sawIn > 20, `expected in-lane paths to be drawn, saw ${sawIn}`);
  assert.ok(sawOut > 20, `expected out-of-lane paths to be drawn, saw ${sawOut}`);
});
