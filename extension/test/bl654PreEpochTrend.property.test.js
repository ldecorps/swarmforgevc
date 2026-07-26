const assert = require('node:assert/strict');
const { renderDailyTrend, renderDailyTrendDefective } = require('./fixtures/bl654PreEpochTrend');
const {
  checkPreEpochInvariant,
  assertNonVacuous,
  errorText,
} = require('./fixtures/bl654PreEpochInvariant');

// BL-654: the coder-authored property test for the worked-example invariant
// ("pre-epoch absence renders unavailable, never zero" - BL-635
// invariants[2]'s shape). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs); excluded from the normal
// unit/coverage/mutation run, per the standing property-test separation
// rule. See fixtures/bl654PreEpochInvariant.js for the generator's asserted
// reachability floor - a generator that can technically reach a pre-epoch
// window is not enough; this test asserts it actually did, at a counted
// floor, not hope (coder.prompt's Invariants section /
// property-test-generator-must-reach-deep-state).
test('property: pre-epoch days render unavailable, never a fabricated 0 (BL-635 invariants[2] worked example)', () => {
  const { totalRuns, preEpochRuns } = checkPreEpochInvariant(renderDailyTrend);
  assert.ok(totalRuns > 0 && preEpochRuns > 0, 'expected the property to actually execute and reach pre-epoch windows');
});

// Non-vacuity ritual (break-then-restore): the same property, run against
// the known-defective implementation, must fail - proving the assertion
// above is load-bearing rather than accidentally always-true. This is the
// live counterpart to the manual "flip the fixture, watch it fail, restore"
// step in the ticket's e2e QA procedure.
test('non-vacuity: the property fails against the defective variant that fabricates 0 for pre-epoch days', () => {
  const verdict = assertNonVacuous(checkPreEpochInvariant, renderDailyTrendDefective);
  assert.equal(verdict.vacuous, false, 'expected the property to fail against the defective implementation');
  assert.match(errorText(verdict.error), /pre-epoch/i, 'expected the failure to name the pre-epoch invariant');
});
