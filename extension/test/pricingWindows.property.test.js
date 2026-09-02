'use strict';

// BL-1056's two declared invariants.
//
// Invariant 1: "A priced model is never costed at a rate outside its own
// validity window. For any model and any instant, the rate used is the one
// whose window contains that instant; a model with no window uses its single
// rate at every instant." The interesting states are the two sides of a
// boundary and the boundary itself, which a generator drawing an arbitrary
// instant from all of time reaches essentially never. So instants are
// CONSTRUCTED as an offset from the entry's own boundary - every drawn pair
// straddles or lands on it by construction, and the offsets include 0 and
// ±1ms around the exact transition.
//
// Invariant 2: "Costing never silently degrades. A model whose windows leave
// an instant uncovered fails loud in the same way BL-627 made an unpriced
// model fail loud - never a fallback rate, never a zero." Encoded as: an
// uncovered instant answers null, never a number, and never the rate of any
// other entry - checked against nonzero usage so a 0 answer would be a
// visible defect rather than an indistinguishable one.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { resolveRatesAt, estimateCostUsdAt } = require('../out/metrics/pricingTable');

const USAGE = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreationTokens: 500_000, cacheReadTokens: 500_000 };
const DAY_MS = 24 * 60 * 60 * 1000;

const ratesArb = fc
  .record({
    inputPerMTok: fc.double({ min: 0.1, max: 100, noNaN: true }),
    outputPerMTok: fc.double({ min: 0.1, max: 100, noNaN: true }),
    cacheCreatePerMTok: fc.double({ min: 0.1, max: 100, noNaN: true }),
    cacheReadPerMTok: fc.double({ min: 0.1, max: 100, noNaN: true }),
  })
  .filter((r) => r.inputPerMTok !== r.outputPerMTok);

// A boundary day drawn as a real calendar day, kept away from month ends so
// the string arithmetic in the test itself stays honest.
const boundaryArb = fc
  .record({ year: fc.integer({ min: 2025, max: 2030 }), month: fc.integer({ min: 1, max: 12 }), day: fc.integer({ min: 1, max: 28 }) })
  .map(({ year, month, day }) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);

// Offsets FROM the transition instant (midnight after the boundary day),
// including the exact instant and the millisecond either side of it.
const offsetArb = fc.oneof(
  fc.constantFrom(-1, 0, 1, -DAY_MS, DAY_MS),
  fc.integer({ min: -400 * DAY_MS, max: 400 * DAY_MS })
);

const transitionMs = (until) => Date.parse(`${until}T00:00:00.000Z`) + DAY_MS;

test('invariant 1: the rate used is the one whose window contains the instant', () => {
  fc.assert(
    fc.property(ratesArb, ratesArb, boundaryArb, offsetArb, (inside, after, until, offset) => {
      const entry = { ...inside, until, then: after };
      const at = new Date(transitionMs(until) + offset);
      const expected = offset < 0 ? inside : after;
      const resolved = resolveRatesAt(entry, at);
      for (const field of Object.keys(expected)) {
        assert.equal(resolved[field], expected[field], field);
      }
      assert.equal(estimateCostUsdAt(USAGE, 'm', at, { m: entry }), estimateCostUsdAt(USAGE, 'm', at, { m: { ...expected } }));
    }),
    { numRuns: 400 }
  );
});

test('invariant 1: a windowless entry answers the same rate at every instant', () => {
  fc.assert(
    fc.property(ratesArb, fc.integer({ min: -4000 * DAY_MS, max: 4000 * DAY_MS }), (rates, offset) => {
      const at = new Date(Date.parse('2026-09-01T00:00:00.000Z') + offset);
      assert.deepEqual({ ...resolveRatesAt(rates, at) }, { ...rates });
      assert.equal(estimateCostUsdAt(USAGE, 'm', at, { m: rates }), estimateCostUsdAt(USAGE, 'm', new Date(0), { m: rates }));
    }),
    { numRuns: 300 }
  );
});

test('invariant 2: an uncovered instant is null - never a number, never zero', () => {
  fc.assert(
    fc.property(ratesArb, ratesArb, boundaryArb, offsetArb, (inside, other, until, offset) => {
      const entry = { ...inside, until, then: null };
      const at = new Date(transitionMs(until) + offset);
      const cost = estimateCostUsdAt(USAGE, 'm', at, { m: entry, other });
      if (offset < 0) {
        assert.equal(typeof cost, 'number');
        assert.ok(cost > 0);
      } else {
        assert.equal(cost, null);
      }
      // An unpriced model is the same answer, at every instant.
      assert.equal(estimateCostUsdAt(USAGE, 'absent', at, { m: entry, other }), null);
    }),
    { numRuns: 400 }
  );
});
