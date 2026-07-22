const assert = require('node:assert/strict');
const fc = require('fast-check');
const { buildOriginCostTrendSeries, chooseCostTrendAxisScale } = require('../out/metrics/llmCostTrendSeries');

// BL-551: architect-added property coverage for the newly-split
// llmCostTrendSeries submodule. Two pure, mathematically-invariant
// functions - bucketed cost conservation and scale-invariant axis choice -
// undercovered by the example-based unit/acceptance tests, which each pin
// only a handful of hand-picked scenarios. Runs ONLY via
// `npm run test:properties` (vitest.properties.config.mjs) - never the
// normal unit/coverage/mutation run (vitest.config.mjs excludes
// **/*.property.test.js).

const NOW_MS = Date.parse('2026-07-22T18:00:00Z');
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const EPSILON = 1e-6;
const ROLES = ['coder', 'architect', 'hardener'];

function approxEqual(a, b, epsilon = EPSILON) {
  return Math.abs(a - b) <= epsilon;
}

function makeRecord(role, offsetMs, costUsd) {
  return {
    type: 'llm_invocation',
    at: new Date(NOW_MS - offsetMs).toISOString(),
    model: null,
    tokens: null,
    costUsd,
    origin: {
      subsystem: 'pipeline',
      role,
      stage: null,
      trigger: 'other',
      ticketId: null,
      handoffId: null,
      handoffType: null,
      script: null,
      pack: null,
      model: null,
      provider: null,
    },
  };
}

// offsetMs bounded to [0, WINDOW_MS) so every generated record lands
// strictly inside the rolling 7-day window buildOriginCostTrendSeries
// evaluates - the property below asserts conservation WITHIN that
// window, so a record outside it would be a false failure, not a bug.
const recordArb = fc
  .record({
    role: fc.constantFrom(...ROLES),
    offsetMs: fc.integer({ min: 0, max: WINDOW_MS - 1 }),
    costUsd: fc.option(fc.double({ min: 0, max: 1000, noNaN: true }), { nil: null }),
  })
  .map(({ role, offsetMs, costUsd }) => makeRecord(role, offsetMs, costUsd));

test('property: bucketed trend series conserve total priced cost per origin', () => {
  fc.assert(
    fc.property(fc.array(recordArb, { minLength: 0, maxLength: 60 }), (records) => {
      const series = buildOriginCostTrendSeries(records, { nowMs: NOW_MS, groupBy: ['role'], topN: ROLES.length });
      for (const s of series) {
        const bucketTotal = s.buckets.reduce((sum, b) => sum + b.costUsd, 0);
        const expectedTotal = records
          .filter((r) => r.origin.role === s.key.role && r.costUsd !== null)
          .reduce((sum, r) => sum + r.costUsd, 0);
        assert.ok(
          approxEqual(bucketTotal, expectedTotal),
          `expected bucket total ${bucketTotal} to equal priced record total ${expectedTotal} for role ${s.key.role}`
        );
      }
    })
  );
});

// Bucket costs are either exactly 0 (no spend) or at least a hundredth of a
// cent - real USD invocation costs never land in the subnormal range
// (e.g. 5e-323). Allowing subnormals here made the invariance property
// below fail spuriously: scaling a subnormal costUsd by k loses enough
// precision to flip which side of the log/linear ratio threshold it lands
// on, even though the ratio is exactly scale-invariant in real arithmetic.
const bucketCostUsdArb = fc.oneof(fc.constant(0), fc.double({ min: 0.0001, max: 1000, noNaN: true }));

const trendSeriesArb = fc
  .array(
    fc.record({
      role: fc.constantFrom(...ROLES),
      buckets: fc.array(bucketCostUsdArb, { minLength: 1, maxLength: 10 }),
    }),
    { minLength: 1, maxLength: 3 }
  )
  .map((entries) =>
    entries.map(({ role, buckets }) => ({
      key: { role },
      buckets: buckets.map((costUsd, i) => ({ bucketStartMs: i, bucketEndMs: i + 1, costUsd })),
    }))
  );

test('property: trend chart axis scale choice is invariant under uniform positive rescaling', () => {
  fc.assert(
    fc.property(trendSeriesArb, fc.double({ min: 0.001, max: 1000, noNaN: true }), (series, k) => {
      const scaled = series.map((s) => ({
        key: s.key,
        buckets: s.buckets.map((b) => ({ ...b, costUsd: b.costUsd * k })),
      }));
      assert.equal(chooseCostTrendAxisScale(scaled), chooseCostTrendAxisScale(series));
    })
  );
});
