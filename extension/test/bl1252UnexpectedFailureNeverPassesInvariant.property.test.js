const fc = require('fast-check');
const assert = require('node:assert/strict');
const {
  ALL_GUARDS, INDEX_GUARDS, PLAN, runRunner, assertReach, freshSeen, tally, withRoot,
} = require('./helpers/bl1252CommitGuardFixture');

// BL-1252 invariant 3, its one property - split out of
// bl1252CommitGuardAggregationInvariants.property.test.js (BL-1349): see
// bl1252IndexGuardsAllRunInvariant.property.test.js for why. numRuns
// unchanged at 60.
//
// Runs ONLY via `npm run test:properties`.

test('property (invariant 3): an unexpected failure refuses the commit and is named as an error, never a pass', () => {
  const seen = freshSeen();
  fc.assert(
    fc.property(PLAN(), (plan) => {
      tally(seen, plan);
      const broken = ALL_GUARDS.filter(
        (g) => plan[g] === 2 || plan[g] === 127 || plan[g] === 'missing'
      );
      // A guard that is never reached cannot be reported; only the ones the
      // tiering actually invokes are in scope for this property.
      const reached = broken.filter(
        (g) => INDEX_GUARDS.includes(g) || INDEX_GUARDS.every((i) => plan[i] === 0)
      );
      fc.pre(reached.length > 0);
      withRoot((root) => {
        const run = runRunner(root, plan);
        assert.notEqual(run.status, 0, `an unexpected guard failure was collected as a pass: ${JSON.stringify(plan)}`);
        assert.match(run.output, /unexpected/i, `the refusal did not distinguish an error from a refusal: ${run.output}`);
        for (const guard of reached) {
          assert.ok(run.output.includes(guard), `the refusal did not name ${guard}: ${run.output}`);
        }
      });
    }),
    { numRuns: 60 }
  );
  assertReach(seen, ['unexpected', 'missing']);
});
