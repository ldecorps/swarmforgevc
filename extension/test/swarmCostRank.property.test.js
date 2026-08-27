const assert = require('node:assert/strict');
const fc = require('fast-check');
const { resolveNowMs, parseSwarmCostRankArgs } = require('../out/tools/swarm-cost-rank');

// BL-575 (architect property pass): the fixture-time-bomb fix introduced a new
// pure parse seam on swarm-cost-rank.ts - `resolveNowMs` (the clock-override
// parser) and the refactored `parseSwarmCostRankArgs`/`parseTopN` path. The
// unit suite pins each at a single hand-picked example (PINNED_NOW_MS, topN=5);
// these are "parsing/formatting stability" invariants that should hold across
// the whole input range, so they earn property coverage. Runs ONLY via
// `npm run test:properties` (vitest.properties.config.mjs) - never the normal
// unit/coverage/mutation run, which excludes **/*.property.test.js.

const NOW_MS_ENV_VAR = 'SWARMFORGE_COST_RANK_NOW_MS';
const HORIZONS = ['3h', '24h', '7d'];

// resolveNowMs must return an in-range numeric override EXACTLY, never the real
// clock - this is what lets a test (and scenario-04's subprocess) pin the
// horizon window deterministically. fc.integer() stays inside the safe-integer
// range, so String()->Number() round-trips exactly for every generated value.
test('property: resolveNowMs returns any finite numeric override verbatim, never the real clock', () => {
  fc.assert(
    fc.property(fc.integer(), (x) => {
      assert.equal(resolveNowMs({ [NOW_MS_ENV_VAR]: String(x) }), x);
    })
  );
});

// The refactored topN parse: any positive-integer argument round-trips into the
// parsed args unchanged, with an empty groupBy and the horizon preserved.
test('property: parseSwarmCostRankArgs round-trips any positive-integer topN', () => {
  fc.assert(
    fc.property(fc.constantFrom(...HORIZONS), fc.integer({ min: 1 }), (horizon, n) => {
      assert.deepEqual(parseSwarmCostRankArgs([horizon, String(n)]), {
        horizon,
        topN: n,
        groupBy: [],
      });
    })
  );
});

// The rejection half of the same seam: a non-positive topN is never accepted -
// it collapses the whole parse to null (usage-and-exit), for every horizon.
// topN must be strictly POSITIVE, so the load-bearing boundary is exactly 0
// (the `<= 0` guard). fast-check's random sampling of `{ max: 0 }` will not
// reliably land on 0, so the 0 boundary is forced via `examples` for every
// horizon - otherwise the property would still pass against a guard that only
// rejected negatives.
test('property: parseSwarmCostRankArgs rejects any non-positive topN as null', () => {
  fc.assert(
    fc.property(fc.constantFrom(...HORIZONS), fc.integer({ max: 0 }), (horizon, n) => {
      assert.equal(parseSwarmCostRankArgs([horizon, String(n)]), null);
    }),
    { examples: HORIZONS.map((horizon) => [horizon, 0]) }
  );
});
