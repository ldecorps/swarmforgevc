'use strict';

// BL-1695's one declared invariant (coder first authorship - BL-654):
//
// "Every assertion in the file names the closure member under test and
// the cause it failed on (the subprocess stderr on a spawn failure, the
// observed copy set on a presence failure, the guard's own list on a
// comparison failure), so a lane red is diagnosable from its one line
// without a re-run."
//
// Encoded against the REAL, shared detector
// (extension/test/helpers/assertionNamesCauseCheck.js) - the same pure
// functions
// specs/pipeline/steps/bl1695ClosureFixtureCopiesOnlyTheClosureSteps.js
// drives for its own scenario 02, never a reimplementation.
//
// Generator reach: property one draws across the THREE real invariant-2
// assertions in the real property test file (fc.constantFrom over their
// actual matched text, computed once from the real source) and proves
// each one individually interpolates ${removed} - not just that the
// block as a WHOLE contains three matching lines somewhere. Property two
// is the non-vacuity/generality proof: a generator over SYNTHETIC
// assertion lines, crossed with whether they interpolate the token,
// proves everyMatchingAssertionInterpolates classifies every shape
// correctly - not just the three shapes that happen to exist in the
// file today.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { assertionsInBlock, everyMatchingAssertionInterpolates } = require('./helpers/assertionNamesCauseCheck');

const PROPERTY_FILE = path.join(__dirname, 'bl1538Bl1028RunnerFixtureClosureInvariants.property.test.js');
const INVARIANT_2_ANCHOR = "describe('BL-1538 invariant 2:";

test('property (BL-1695 invariant): every real invariant-2 assertion referencing the removed member interpolates it, over repeated independent draws', () => {
  const source = fs.readFileSync(PROPERTY_FILE, 'utf8');
  const assertions = assertionsInBlock(source, INVARIANT_2_ANCHOR);
  assert.ok(assertions, 'expected to find the invariant 2 describe block in the real property file');
  const relevant = assertions.filter((line) => /removed/.test(line));
  assert.ok(relevant.length >= 3, `expected at least 3 real assertions referencing removed, got ${relevant.length}`);

  const seen = new Set();
  fc.assert(
    fc.property(fc.constantFrom(...relevant), (line) => {
      seen.add(line);
      assert.ok(line.includes('${removed}'), `expected the removed member interpolated in: ${line}`);
    }),
    { numRuns: 30 }
  );
  assert.equal(seen.size, relevant.length, `expected the generator to reach every one of the ${relevant.length} real assertions, reached ${seen.size}`);
});

// Synthetic assertion-line generator: a call that DOES or DOES NOT
// reference "removed" in its condition, crossed with whether its message
// interpolates ${removed} - the exact shape everyMatchingAssertionInterpolates
// must classify correctly (only lines matching the filter regex count,
// and among those, only interpolation decides pass/fail).
function buildAssertionLine(referencesRemoved, interpolates) {
  const condition = referencesRemoved ? 'have.has(removed)' : 'have.has(other)';
  const message = interpolates ? "`${removed} was expected to be dropped but is present`" : "'a fixed message with no member name'";
  return `assert.ok(!${condition}, ${message});`;
}

const shapeArbitrary = fc.record({
  referencesRemoved: fc.boolean(),
  interpolates: fc.boolean(),
});

test('property (BL-1695 invariant) non-vacuity: everyMatchingAssertionInterpolates classifies every referencing/interpolating combination correctly', () => {
  const seenShapes = new Set();
  fc.assert(
    fc.property(fc.array(shapeArbitrary, { minLength: 1, maxLength: 6 }), (shapes) => {
      for (const shape of shapes) seenShapes.add(`${shape.referencesRemoved}/${shape.interpolates}`);
      const lines = shapes.map((s) => buildAssertionLine(s.referencesRemoved, s.interpolates));
      const source = `describe('synthetic', () => {\n${lines.join('\n')}\n});`;
      const assertions = assertionsInBlock(source, "describe('synthetic'");
      assert.ok(assertions, 'expected the synthetic describe block to be found');

      const result = everyMatchingAssertionInterpolates(assertions, /removed/, '${removed}');
      // The filter matches "removed" ANYWHERE in the line, and an
      // interpolated message itself contains "removed" (via ${removed})
      // regardless of whether the CONDITION references it - so a shape
      // is relevant when EITHER half mentions "removed", not only when
      // referencesRemoved is true (the bug this property caught against
      // its own first draft, before this comment existed).
      const relevantShapes = shapes.filter((s) => s.referencesRemoved || s.interpolates);
      const expectedOk = relevantShapes.length > 0 && relevantShapes.every((s) => s.interpolates);
      assert.equal(
        result.relevant.length,
        relevantShapes.length,
        `shapes=${JSON.stringify(shapes)}: expected ${relevantShapes.length} relevant assertions, got ${result.relevant.length}: ${JSON.stringify(result.relevant)}`
      );
      if (relevantShapes.length > 0) {
        assert.equal(result.ok, expectedOk, `shapes=${JSON.stringify(shapes)}: expected ok=${expectedOk}, got ${result.ok}, missing=${JSON.stringify(result.missing)}`);
      }
    }),
    { numRuns: 40 }
  );
  assert.equal(seenShapes.size, 4, `expected all four referencing/interpolating combinations drawn, got: ${JSON.stringify([...seenShapes])}`);
});
