const assert = require('node:assert/strict');
const fc = require('fast-check');
const { computeMean, computeStdDev, aggregateModelTrials } = require('../out/benchmark/aggregate');

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

const MODEL = { id: 'm', provider: 'claude', model: 'm', label: 'm' };

function runOf(costUsd, reworkRounds) {
  return {
    taskId: 't',
    modelId: 'm',
    repetition: 1,
    ran: true,
    survived: true,
    reworkRounds,
    qualityScore: 0.9,
    testsPassed: 9,
    testsTotal: 10,
    durationMs: 1000,
    costUsd,
    tokens: { inputTokens: 100, outputTokens: 100 },
  };
}

// BL-388: meanReworkAdjustedCostUsd prices each run at costUsd * (1 +
// reworkRounds) - a run that bounced through more rework rounds must never
// come out CHEAPER than the same run with fewer rounds, holding its raw
// cost fixed. This is the monotonicity invariant the whole ticket rests
// on: rank.ts's bestByValue/cheapestAcceptable both switched from
// meanCostUsd to this field on the strength of exactly this guarantee (a
// cheap-first-diff model that reworks heavily must not look cheap). A
// single-run aggregate isolates the pricing function itself from the
// cross-run averaging computeMean already covers above.
test('property: meanReworkAdjustedCostUsd is monotonically non-decreasing in reworkRounds, for a fixed cost', () => {
  fc.assert(
    fc.property(
      fc.double({ noNaN: true, noDefaultInfinity: true, min: 0.0001, max: 1000 }),
      fc.integer({ min: 0, max: 50 }),
      fc.integer({ min: 0, max: 50 }),
      (costUsd, roundsA, roundsB) => {
        const lo = Math.min(roundsA, roundsB);
        const hi = Math.max(roundsA, roundsB);
        const cheaper = aggregateModelTrials(MODEL, [runOf(costUsd, lo)]).meanReworkAdjustedCostUsd;
        const pricier = aggregateModelTrials(MODEL, [runOf(costUsd, hi)]).meanReworkAdjustedCostUsd;
        assert.ok(
          pricier >= cheaper - EPSILON,
          `expected ${hi} rework rounds (cost ${pricier}) to never price cheaper than ${lo} rounds (cost ${cheaper})`
        );
      }
    )
  );
});

// A run with no priced cost at all stays unpriced regardless of how much
// rework it needed - reworkRounds must never manufacture a cost out of
// null, mirroring meanCostUsd's own null-when-unpriced semantics.
test('property: meanReworkAdjustedCostUsd stays null for an unpriced run, for any reworkRounds', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 50 }), (reworkRounds) => {
      const aggregate = aggregateModelTrials(MODEL, [runOf(null, reworkRounds)]);
      assert.equal(aggregate.meanReworkAdjustedCostUsd, null, `expected a null-cost run to stay unpriced, got ${aggregate.meanReworkAdjustedCostUsd}`);
    })
  );
});
