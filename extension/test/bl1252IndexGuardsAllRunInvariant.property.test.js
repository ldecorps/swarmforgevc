const fc = require('fast-check');
const assert = require('node:assert/strict');
const {
  INDEX_GUARDS, PLAN, runRunner, assertReach, freshSeen, tally, withRoot,
} = require('./helpers/bl1252CommitGuardFixture');

// BL-1252 invariant 1, property 1 of 2 - split out of
// bl1252CommitGuardAggregationInvariants.property.test.js (BL-1349): that
// single file's five properties summed past the 15s per-file budget even
// after their own numRuns cut, though each is comfortably under budget
// alone. numRuns unchanged at 60 (BL-1349: numRuns dropped 120 -> 60, each
// run spawnSync's the real runner - real IO, BL-654 invariant 2).
//
// Runs ONLY via `npm run test:properties`.

test('property (invariant 1): every index-inspection guard runs, whatever the ones before it decided', () => {
  const seen = freshSeen();
  fc.assert(
    fc.property(PLAN(), (plan) => {
      tally(seen, plan);
      withRoot((root) => {
        const run = runRunner(root, plan);
        for (const guard of INDEX_GUARDS) {
          if (plan[guard] === 'missing') continue;
          assert.ok(
            run.ran(guard),
            `${guard} never ran under plan ${JSON.stringify(plan)} - an earlier guard aborted the chain`
          );
        }
      });
    }),
    { numRuns: 60 }
  );
  assertReach(seen, ['clean', 'multiIndexViolation', 'unexpected', 'missing', 'suiteOnly']);
});
