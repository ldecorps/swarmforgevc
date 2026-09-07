const fc = require('fast-check');
const assert = require('node:assert/strict');
const {
  INDEX_GUARDS, PLAN, runRunner, assertReach, freshSeen, tally, withRoot,
} = require('./helpers/bl1252CommitGuardFixture');

// BL-1252 invariant 1, property 2 of 2 - split out of
// bl1252CommitGuardAggregationInvariants.property.test.js (BL-1349): see
// bl1252IndexGuardsAllRunInvariant.property.test.js for why. numRuns
// unchanged at 60.
//
// Runs ONLY via `npm run test:properties`.

test('property (invariant 1): every violating index guard is named in the ONE refusal', () => {
  const seen = freshSeen();
  fc.assert(
    fc.property(PLAN(), (plan) => {
      tally(seen, plan);
      withRoot((root) => {
        const run = runRunner(root, plan);
        for (const guard of INDEX_GUARDS) {
          const violated = plan[guard] !== 0;
          assert.equal(
            run.output.includes(guard),
            violated,
            `${guard} should ${violated ? '' : 'NOT '}appear in the refusal for ${JSON.stringify(plan)}: ${run.output}`
          );
        }
      });
    }),
    { numRuns: 60 }
  );
  assertReach(seen, ['clean', 'multiIndexViolation', 'unexpected', 'missing']);
});
