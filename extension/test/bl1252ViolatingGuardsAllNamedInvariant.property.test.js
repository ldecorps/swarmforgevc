const fc = require('fast-check');
const assert = require('node:assert/strict');
const {
  INDEX_GUARDS, KIND_PLANS, runRunner, freshSeen, tally, withRoot,
} = require('./helpers/bl1252CommitGuardFixture');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

// BL-1252 invariant 1, property 2 of 2 - split out of
// bl1252CommitGuardAggregationInvariants.property.test.js (BL-1349): see
// bl1252IndexGuardsAllRunInvariant.property.test.js for why. numRuns
// unchanged at 60.
//
// BL-1762: each kind this property must reach (clean, multiIndexViolation,
// unexpected, missing) is drawn from its own kind-specific arbitrary
// (helpers/bl1252CommitGuardFixture's KIND_PLANS), not sampled from the
// shared weighted PLAN() - reach is now by construction, never hoped for.
//
// Runs ONLY via `npm run test:properties`.

const KINDS = ['clean', 'multiIndexViolation', 'unexpected', 'missing'];
const PER_CELL_RUNS = runsPerCell(60, KINDS.length);

test('property (invariant 1): every violating index guard is named in the ONE refusal', () => {
  const seen = freshSeen();
  for (const kind of KINDS) {
    fc.assert(
      fc.property(KIND_PLANS[kind](), (plan) => {
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
      { numRuns: PER_CELL_RUNS }
    );
  }
  assertReachFloor(seen, KINDS, 1, 'plan-kind');
});
