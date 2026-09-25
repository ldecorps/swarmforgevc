const fc = require('fast-check');
const assert = require('node:assert/strict');
const {
  INDEX_GUARDS, SUITE_GUARD, KIND_PLANS, runRunner, freshSeen, tally, withRoot,
} = require('./helpers/bl1252CommitGuardFixture');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

// BL-1252 invariant 2, property 2 of 2 - split out of
// bl1252CommitGuardAggregationInvariants.property.test.js (BL-1349): see
// bl1252IndexGuardsAllRunInvariant.property.test.js for why. numRuns
// unchanged at 60.
//
// BL-1762: the three kinds this property must reach (clean,
// multiIndexViolation, suiteOnly) are each drawn from their own
// kind-specific arbitrary (helpers/bl1252CommitGuardFixture's KIND_PLANS)
// rather than sampled from the shared weighted PLAN() - a suiteOnly plan
// is 1-in-10 there, and QA's property lane on 2026-09-25 drew zero of them
// in 60 runs. Reach is now by construction.
//
// Runs ONLY via `npm run test:properties`.

const KINDS = ['clean', 'multiIndexViolation', 'suiteOnly'];
const PER_CELL_RUNS = runsPerCell(60, KINDS.length);

test('property (invariant 2): the expensive guard runs if and only if every cheap guard passes', () => {
  const seen = freshSeen();
  for (const kind of KINDS) {
    fc.assert(
      fc.property(KIND_PLANS[kind](), (plan) => {
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
      { numRuns: PER_CELL_RUNS }
    );
  }
  assertReachFloor(seen, KINDS, 1, 'plan-kind');
});
