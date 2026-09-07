const fc = require('fast-check');
const assert = require('node:assert/strict');
const {
  INDEX_GUARDS, SUITE_GUARD, PLAN, runRunner, assertReach, freshSeen, tally, withRoot,
} = require('./helpers/bl1252CommitGuardFixture');

// BL-1252 invariant 2, property 2 of 2 - split out of
// bl1252CommitGuardAggregationInvariants.property.test.js (BL-1349): see
// bl1252IndexGuardsAllRunInvariant.property.test.js for why. numRuns
// unchanged at 60.
//
// Runs ONLY via `npm run test:properties`.

test('property (invariant 2): the expensive guard runs if and only if every cheap guard passes', () => {
  const seen = freshSeen();
  fc.assert(
    fc.property(PLAN(), (plan) => {
      tally(seen, plan);
      withRoot((root) => {
        const run = runRunner(root, plan);
        const cheapAllPass = INDEX_GUARDS.every((g) => plan[g] === 0);
        const suitePresent = plan[SUITE_GUARD] !== 'missing';
        assert.equal(
          run.ran(SUITE_GUARD),
          cheapAllPass && suitePresent,
          `property suite tiering wrong for ${JSON.stringify(plan)}`
        );
      });
    }),
    { numRuns: 60 }
  );
  assertReach(seen, ['clean', 'multiIndexViolation', 'suiteOnly']);
});
