'use strict';

// BL-1206 declared invariants (coder-authored per BL-654 / coder.prompt).
//
// Invariant 1: "No file in the vitest property lane takes its `test`
// binding from node:test - the lane's globals are the single source of
// it." The per-line scanner (findNodeTestImportLines) is BL-1220's own,
// already proven data-vs-import-safe by its own property test (400 runs) -
// not re-proven here. What is new for this ticket is the property-lane
// WALK (isPropertyLaneTestFile / findPropertyLaneNodeTestImports): P1
// proves it reports a genuine import wherever it sits in a property-lane
// file, at any depth, and never in a non-property-lane file carrying the
// identical text; P2 proves the walk skips no offender across a tree of
// several.
//
// Invariant 2: "A file leaves the standing allowlist only by passing under
// the property lane, never by being deleted from the list while still
// red." findSilentRemovals is the pure check this ticket's own register
// edit must satisfy - P3 proves it correctly separates a legitimate
// departure (passed) from a silent one (not passed), for any mix of
// stayed/departed files and any pass/fail assignment.
//
// GENERATOR REACH (BL-654): P1 draws independently from real import forms,
// real data forms, and both lane extensions, so every generated case is a
// genuine instance of exactly one class - there is no synthetic domain to
// miss. P2's file counts and P3's remove/keep/pass assignments are asserted
// to actually vary across runs rather than hoped to.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { findPropertyLaneNodeTestImports } = require('./helpers/nodeTestImportGuard');
const { findSilentRemovals } = require('./helpers/allowlistRemovalGuard');

const IMPORT_FORMS = [
  "const { test } = require('node:test');",
  'const { test } = require("node:test");',
  "const { describe, it, beforeEach, afterEach } = require('node:test');",
  "const test = require('node:test');",
  "import { test } from 'node:test';",
  'import test from "node:test";',
];

// The same string as DATA - none of these declares anything to any runner.
const DATA_FORMS = [
  '  const fixture = "const test=require(\'node:test\');";',
  '// mentions require(\'node:test\') in prose, never imports it',
];

test('P1: an import is flagged wherever it sits in a property-lane file, never in a non-property-lane one carrying the same text', () => {
  let sawPropertyImport = 0;
  let sawNonPropertyImport = 0;
  let sawData = 0;
  fc.assert(
    fc.property(
      fc.constantFrom(...IMPORT_FORMS),
      fc.constantFrom(...DATA_FORMS),
      fc.constantFrom('.property.test.js', '.test.js', '.js'),
      fc.constantFrom('', 'nested', 'nested/deep'),
      fc.boolean(),
      (importForm, dataForm, extension, subdir, useImport) => {
        const dir = mkTmpDir('bl1206-p1-');
        const targetDir = subdir ? path.join(dir, subdir) : dir;
        fs.mkdirSync(targetDir, { recursive: true });
        const file = path.join(targetDir, `subject${extension}`);
        const content = useImport ? importForm : dataForm;
        fs.writeFileSync(file, `${content}\ntest('x', () => {});\n`);

        const violations = findPropertyLaneNodeTestImports(dir);
        const isPropertyLane = extension === '.property.test.js';

        if (useImport && isPropertyLane) {
          sawPropertyImport += 1;
          assert.deepEqual(violations, [{ file, line: 1 }], `missed ${importForm} in ${file}`);
          return;
        }
        if (useImport) {
          sawNonPropertyImport += 1;
        } else {
          sawData += 1;
        }
        assert.deepEqual(violations, [], `unexpected violation for ${JSON.stringify({ extension, useImport, content })}`);
      }
    ),
    { numRuns: 300 }
  );
  // Reachability floor: every class this property distinguishes was actually
  // generated, not merely possible.
  assert.ok(sawPropertyImport > 20, `expected property-lane imports drawn, saw ${sawPropertyImport}`);
  assert.ok(sawNonPropertyImport > 20, `expected non-property-lane imports drawn, saw ${sawNonPropertyImport}`);
  assert.ok(sawData > 20, `expected data forms drawn, saw ${sawData}`);
});

test('P2: the walk reports every offending property-lane file across a tree, none skipped', () => {
  let sawMultiple = 0;
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...IMPORT_FORMS), { minLength: 1, maxLength: 5 }),
      fc.nat({ max: 3 }),
      (imports, cleanCount) => {
        const dir = mkTmpDir('bl1206-p2-');
        imports.forEach((form, i) => {
          fs.writeFileSync(path.join(dir, `offender${i}.property.test.js`), `${form}\ntest('x', () => {});\n`);
        });
        for (let i = 0; i < cleanCount; i += 1) {
          fs.writeFileSync(path.join(dir, `clean${i}.property.test.js`), "test('x', () => {});\n");
        }
        const violations = findPropertyLaneNodeTestImports(dir);
        assert.equal(violations.length, imports.length, 'one violation per offending file, none skipped');
        for (let i = 0; i < imports.length; i += 1) {
          assert.ok(violations.some((v) => v.file.endsWith(`offender${i}.property.test.js`)), `offender${i} was not reported`);
        }
        if (imports.length > 1) {
          sawMultiple += 1;
        }
      }
    ),
    { numRuns: 60 }
  );
  assert.ok(sawMultiple > 15, `expected multi-violation trees to be drawn, saw ${sawMultiple}`);
});

const FILE_NAME = fc.stringMatching(/^[a-z][a-zA-Z0-9]{2,10}\.property\.test\.js$/);

test('P3: a departure from the allowlist is silent unless backed by a recorded pass', () => {
  let sawLegitimateDeparture = 0;
  let sawSilentDeparture = 0;
  let sawStayed = 0;
  fc.assert(
    fc.property(
      fc.uniqueArray(FILE_NAME, { minLength: 1, maxLength: 8 }),
      fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
      fc.array(fc.option(fc.boolean(), { nil: undefined }), { minLength: 8, maxLength: 8 }),
      (beforeFiles, removeFlags, passResults) => {
        const removed = beforeFiles.filter((_, i) => removeFlags[i]);
        const afterFiles = beforeFiles.filter((_, i) => !removeFlags[i]);
        const passedByFile = {};
        removed.forEach((file, i) => {
          passedByFile[file] = passResults[i];
        });

        const flagged = findSilentRemovals(beforeFiles, afterFiles, passedByFile);
        const expectedFlagged = removed.filter((file) => passedByFile[file] !== true);

        assert.deepEqual(new Set(flagged), new Set(expectedFlagged));

        for (const file of removed) {
          if (passedByFile[file] === true) sawLegitimateDeparture += 1;
          else sawSilentDeparture += 1;
        }
        sawStayed += afterFiles.length;
      }
    ),
    { numRuns: 100 }
  );
  assert.ok(sawLegitimateDeparture > 5, `expected some passing departures drawn, saw ${sawLegitimateDeparture}`);
  assert.ok(sawSilentDeparture > 5, `expected some non-passing departures drawn, saw ${sawSilentDeparture}`);
  assert.ok(sawStayed > 5, `expected some files to stay on the list, saw ${sawStayed}`);
});

// ── non-vacuity proofs (each mutation run for real, restored byte-identical
//    afterward, confirmed via diff against a pre-break backup) ──
//
// P1: changing `isPropertyLane` to always `true` (so a non-property-lane
// import is judged the same as a property-lane one) failed on the very
// first non-property-lane import case - "unexpected violation for ..." -
// proving the property actually distinguishes lanes, not merely that some
// violations list comes back.
//
// P2: seeding the walk's directory listing with `.slice(1)` (dropping the
// first entry) failed immediately with "one violation per offending file,
// none skipped" - proving the property is sensitive to a dropped file, not
// just to the walk returning an array.
//
// P3: inverting the filter's `!== true` to `=== true` (reporting the
// legitimate departures instead of the silent ones) failed immediately on
// the very next generated case with a departed-set mismatch - proving the
// property is sensitive to the actual pass/fail computation, not just to
// whether some subset comes back.
