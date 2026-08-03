const assert = require('node:assert/strict');
const fc = require('fast-check');
const { assertRecordPassed, assertTestCountNotShrunk } = require('../out/tools/build-test-duration-profile');

// BL-792 declared invariant (BL-654 coder-authored property test): "A
// failing run is never used as a baseline or as evidence about where the
// suite's time goes." assertRecordPassed is the executable encoding - the
// profile-builder's own gate. Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs), per the standing property-test
// separation rule.
const nonPassResultArb = fc.string().filter((s) => s !== 'pass');
const recordArb = (resultArb) =>
  fc.record({
    finished_at: fc.string(),
    test_count: fc.nat(),
    result: resultArb,
    duration_ms: fc.nat(),
  });

test('property: assertRecordPassed throws for every non-"pass" result string', () => {
  fc.assert(
    fc.property(recordArb(nonPassResultArb), (record) => {
      assert.throws(() => assertRecordPassed(record));
    }),
    { numRuns: 200 }
  );
});

test('property: assertRecordPassed never throws for a "pass" result', () => {
  fc.assert(
    fc.property(recordArb(fc.constant('pass')), (record) => {
      assert.doesNotThrow(() => assertRecordPassed(record));
    }),
    { numRuns: 200 }
  );
});

test('non-vacuity: a genuine non-passing record is reachable, and a defective always-passes implementation would miss it', () => {
  const failingRecord = { finished_at: 'x', test_count: 1, result: 'fail', duration_ms: 1 };
  assert.throws(() => assertRecordPassed(failingRecord), 'expected the real implementation to throw on a failing record');
  const defectiveAlwaysPasses = () => {};
  assert.doesNotThrow(
    () => defectiveAlwaysPasses(failingRecord),
    'the defective variant does not throw, proving the assertion above is load-bearing'
  );
});

// BL-792 declared invariant (BL-654 coder-authored property test): "the
// recorded test_count never falls below the previous recorded run."
// assertTestCountNotShrunk is the executable encoding. The generator
// DERIVES current from previous by a signed delta (rather than drawing two
// independent counts), so every generated pair is a shrink-or-not-shrink
// case by construction, per the coder's generator-reach obligation.
test('property: assertTestCountNotShrunk throws exactly when the delta is negative, for any previous count and any delta', () => {
  fc.assert(
    fc.property(fc.nat({ max: 100000 }), fc.integer({ min: -1000, max: 1000 }), (previousCount, delta) => {
      const previous = { finished_at: 'x', test_count: previousCount, result: 'pass', duration_ms: 0 };
      const current = { ...previous, test_count: previousCount + delta };
      if (delta < 0) {
        assert.throws(() => assertTestCountNotShrunk(previous, current));
      } else {
        assert.doesNotThrow(() => assertTestCountNotShrunk(previous, current));
      }
    }),
    { numRuns: 200 }
  );
});

test('non-vacuity: a genuine shrink is reachable, and a defective never-throwing implementation would miss it', () => {
  const previous = { finished_at: 'x', test_count: 10, result: 'pass', duration_ms: 0 };
  const current = { ...previous, test_count: 9 };
  assert.throws(() => assertTestCountNotShrunk(previous, current), 'expected the real implementation to throw on a genuine shrink');
  const defectiveNeverThrows = () => {};
  assert.doesNotThrow(
    () => defectiveNeverThrows(previous, current),
    'the defective variant does not throw, proving the assertion above is load-bearing'
  );
});
