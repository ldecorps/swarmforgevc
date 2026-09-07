const fc = require('fast-check');
const assert = require('node:assert/strict');
const {
  PLAN, runRunner, legacyChainRefuses, assertReach, freshSeen, tally, withRoot,
} = require('./helpers/bl1252CommitGuardFixture');

// BL-1252 invariant 2, property 1 of 2 - split out of
// bl1252CommitGuardAggregationInvariants.property.test.js (BL-1349): see
// bl1252IndexGuardsAllRunInvariant.property.test.js for why. numRuns
// unchanged at 60.
//
// Runs ONLY via `npm run test:properties`.

test('property (invariant 2): the runner refuses exactly the commits the pre-BL-1252 chain refused', () => {
  const seen = freshSeen();
  fc.assert(
    fc.property(PLAN(), (plan) => {
      tally(seen, plan);
      withRoot((root) => {
        const run = runRunner(root, plan);
        assert.equal(
          run.status !== 0,
          legacyChainRefuses(plan),
          `refusal predicate changed for ${JSON.stringify(plan)} (status ${run.status})`
        );
      });
    }),
    { numRuns: 60 }
  );
  assertReach(seen, ['clean', 'multiIndexViolation', 'unexpected', 'missing', 'suiteOnly']);
});
