const assert = require('node:assert/strict');
const fc = require('fast-check');
const { computeMean, computeStdDev } = require('../out/benchmark/aggregate');

// BL-479: seeds the architect-owned property-test command with a real,
// non-vacuous suite against computeMean/computeStdDev (extension/src/
// benchmark/aggregate.ts) - two small, pure, mathematical functions with
// well-known invariants over a BROAD input range, exactly the "useful
// properties undercovered by example-based tests" shape the ticket asks
// for. Ordinary unit tests (benchmarkAggregate.test.js) exercise a
// handful of hand-picked arrays; these run the same invariants over
// thousands of generated cases. Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs) - never the normal unit/coverage/mutation
// run (vitest.config.mjs excludes **/*.property.test.js).
//
// Floating-point addition is not perfectly associative, so exact equality
// across differently-ORDERED sums can differ in the last bit - every
// comparison below uses a small epsilon rather than ===, so the suite
// stays deterministic and non-flaky rather than merely "usually passes".
const EPSILON = 1e-9;

function approxEqual(a, b, epsilon = EPSILON) {
  return Math.abs(a - b) <= epsilon;
}

// Bounded, finite doubles - a broad range (values well past anything the
// real benchmark ever produces: quality is 0..1, cost/duration/tokens are
// small positive numbers) without courting NaN/Infinity, which would
// trivially poison every arithmetic invariant below and prove nothing
// about the functions themselves.
const finiteDouble = () => fc.double({ noNaN: true, noDefaultInfinity: true, min: -1_000_000, max: 1_000_000 });

test('property: computeMean of a non-empty array lies within [min, max] of that array', () => {
  fc.assert(
    fc.property(fc.array(finiteDouble(), { minLength: 1, maxLength: 200 }), (values) => {
      const mean = computeMean(values);
      const min = Math.min(...values);
      const max = Math.max(...values);
      assert.ok(mean >= min - EPSILON && mean <= max + EPSILON, `expected mean ${mean} within [${min}, ${max}]`);
    })
  );
});

test('property: computeStdDev is never negative, for any array including the empty one', () => {
  fc.assert(
    fc.property(fc.array(finiteDouble(), { maxLength: 200 }), (values) => {
      assert.ok(computeStdDev(values) >= 0, `expected a non-negative stddev, got ${computeStdDev(values)}`);
    })
  );
});

test('property: computeStdDev of a constant array is ~0 - no dispersion when every value is identical', () => {
  fc.assert(
    fc.property(finiteDouble(), fc.integer({ min: 1, max: 200 }), (value, length) => {
      const constantArray = Array.from({ length }, () => value);
      const stdDev = computeStdDev(constantArray);
      // A large-magnitude value's own rounding residual scales with its
      // magnitude (floating-point precision is RELATIVE, not absolute) -
      // a fixed absolute EPSILON alone would false-fail on e.g. a
      // constant array of ~500,000, whose summed rounding noise sits
      // around 1e-9 in absolute terms despite the true variance being
      // exactly 0. Combine a relative term with the absolute floor so the
      // bound scales with the input yet still catches a REAL invariant
      // violation (many orders of magnitude larger than rounding noise).
      const tolerance = Math.max(EPSILON, Math.abs(value) * EPSILON);
      assert.ok(stdDev <= tolerance, `expected ~0 stddev (tolerance ${tolerance}) for a constant array, got ${stdDev}`);
    })
  );
});

test('property: computeMean is unaffected by the array\'s order (permutation invariance)', () => {
  fc.assert(
    fc.property(fc.array(finiteDouble(), { minLength: 1, maxLength: 200 }), (values) => {
      const shuffled = fc.sample(fc.shuffledSubarray(values, { minLength: values.length }), 1)[0];
      assert.ok(approxEqual(computeMean(values), computeMean(shuffled)), 'expected mean to be order-independent');
    })
  );
});

test('property: doubling an array (concatenating it with itself) never changes its mean', () => {
  fc.assert(
    fc.property(fc.array(finiteDouble(), { minLength: 1, maxLength: 100 }), (values) => {
      assert.ok(
        approxEqual(computeMean(values), computeMean([...values, ...values])),
        'expected the mean of an array duplicated onto itself to equal the original mean'
      );
    })
  );
});
