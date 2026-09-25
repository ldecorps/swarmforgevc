const fc = require('fast-check');
const assert = require('node:assert/strict');
const {
  INDEX_GUARDS, KIND_PLANS, runRunner, freshSeen, tally, withRoot,
} = require('./helpers/bl1252CommitGuardFixture');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

// BL-1252 invariant 1, property 1 of 2 - split out of
// bl1252CommitGuardAggregationInvariants.property.test.js (BL-1349): that
// single file's five properties summed past the 15s per-file budget even
// after their own numRuns cut, though each is comfortably under budget
// alone. numRuns unchanged at 60 (BL-1349: numRuns dropped 120 -> 60, each
// run spawnSync's the real runner - real IO, BL-654 invariant 2).
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

test('property (invariant 1): every index-inspection guard runs, whatever the ones before it decided', () => {
  const seen = freshSeen();
  for (const kind of KINDS) {
    fc.assert(
      fc.property(KIND_PLANS[kind](), (plan) => {
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
      { numRuns: PER_CELL_RUNS }
    );
  }
  assertReachFloor(seen, KINDS, 1, 'plan-kind');
});
