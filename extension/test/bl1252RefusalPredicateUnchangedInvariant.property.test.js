const fc = require('fast-check');
const assert = require('node:assert/strict');
const {
  KIND_PLANS, runRunner, legacyChainRefuses, freshSeen, tally, withRoot,
} = require('./helpers/bl1252CommitGuardFixture');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

// BL-1252 invariant 2, property 1 of 2 - split out of
// bl1252CommitGuardAggregationInvariants.property.test.js (BL-1349): see
// bl1252IndexGuardsAllRunInvariant.property.test.js for why. numRuns
// unchanged at 60.
//
// BL-1762: each kind this property must reach (clean, multiIndexViolation,
// unexpected, missing, suiteOnly) is drawn from its own kind-specific
// arbitrary (helpers/bl1252CommitGuardFixture's KIND_PLANS), not sampled
// from the shared weighted PLAN() - reach is now by construction, never
// hoped for.
//
// Runs ONLY via `npm run test:properties`.

const KINDS = ['clean', 'multiIndexViolation', 'unexpected', 'missing', 'suiteOnly'];
const PER_CELL_RUNS = runsPerCell(60, KINDS.length);

test('property (invariant 2): the runner refuses exactly the commits the pre-BL-1252 chain refused', () => {
  const seen = freshSeen();
  for (const kind of KINDS) {
    fc.assert(
      fc.property(KIND_PLANS[kind](), (plan) => {
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
      { numRuns: PER_CELL_RUNS }
    );
  }
  assertReachFloor(seen, KINDS, 1, 'plan-kind');
});
