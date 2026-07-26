'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');

// BL-654: the coder-authored property + its generator-reach floor for the
// pre-epoch worked example (see bl654PreEpochTrend.js). Shared between the
// real vitest property test (extension/test/bl654PreEpochTrend.property.test.js
// - the ticket's actual deliverable) and the acceptance step handlers
// (specs/pipeline/steps/bl654InvariantPropertyTestSteps.js), which drive a
// vacuous and a shallow-generator VARIANT of it to demonstrate the two
// failure shapes the coder.prompt Invariants section names
// (property-test-generator-must-reach-deep-state): a generator that can
// technically reach the state under test but almost never does, and a
// non-vacuity check that only proves the assertion is load-bearing, never
// that the generator reaches the state the assertion is about.

const RUNS = 300;
// Asserted, not hoped-for (coder.prompt's Invariants section): the floor a
// healthy generator must clear, not merely be capable of clearing.
const MIN_PRE_EPOCH_RUN_FRACTION = 0.5;

// epochIndex is weighted heavily toward landing STRICTLY inside the series
// so most runs contain both pre- and post-epoch days. A uniform draw across
// [0, length] would make epochIndex === 0 (no pre-epoch days at all) too
// likely and starve exactly the coverage this property needs.
function dailySeriesWithEpoch() {
  return fc.integer({ min: 2, max: 60 }).chain((length) =>
    fc.record({
      dailyCounts: fc.array(fc.integer({ min: 0, max: 500 }), { minLength: length, maxLength: length }),
      epochIndex: fc.oneof(
        { weight: 1, arbitrary: fc.constant(0) },
        { weight: 8, arbitrary: fc.integer({ min: 1, max: length - 1 }) }
      ),
    })
  );
}

// The shallow-generator variant (scenario 10): epochIndex is always 0, so
// the generator NEVER reaches a pre-epoch window - a live demonstration of
// the failure shape the reachability floor exists to catch.
function dailySeriesWithEpochNeverPreEpoch() {
  return fc.integer({ min: 2, max: 60 }).chain((length) =>
    fc.record({
      dailyCounts: fc.array(fc.integer({ min: 0, max: 500 }), { minLength: length, maxLength: length }),
      epochIndex: fc.constant(0),
    })
  );
}

// `assertInvariant: false` produces the vacuous variant (scenario 09): the
// generator and its reachability floor stay intact, only the invariant
// assertion itself is removed - so it can be run against a known-defective
// implementation to prove the non-vacuity check catches a property test
// that would otherwise pass for the wrong reason.
function runPreEpochInvariant(renderFn, { arbitrary, assertInvariant }) {
  let totalRuns = 0;
  let preEpochRuns = 0;

  fc.assert(
    fc.property(arbitrary, ({ dailyCounts, epochIndex }) => {
      totalRuns += 1;
      if (epochIndex > 0) {
        preEpochRuns += 1;
      }
      const rendered = renderFn(dailyCounts, epochIndex);
      if (assertInvariant) {
        for (let day = 0; day < epochIndex; day += 1) {
          assert.notStrictEqual(
            rendered[day],
            0,
            `pre-epoch day ${day} (recording epoch starts at ${epochIndex}) fabricated 0 instead of staying unavailable`
          );
          assert.strictEqual(
            rendered[day],
            null,
            `pre-epoch day ${day} (recording epoch starts at ${epochIndex}) must render unavailable, not a value`
          );
        }
      }
    }),
    { numRuns: RUNS }
  );

  const preEpochFraction = totalRuns === 0 ? 0 : preEpochRuns / totalRuns;
  assert.ok(
    preEpochFraction >= MIN_PRE_EPOCH_RUN_FRACTION,
    `reachability floor: expected at least ${Math.round(MIN_PRE_EPOCH_RUN_FRACTION * 100)}% of ${totalRuns} runs ` +
      `to reach a pre-epoch window, only ${preEpochRuns} did (${(preEpochFraction * 100).toFixed(1)}%)`
  );

  return { totalRuns, preEpochRuns, preEpochFraction };
}

// Scenario 07/08: the real, non-vacuous property test - asserts the
// invariant AND the reachability floor.
function checkPreEpochInvariant(renderFn) {
  return runPreEpochInvariant(renderFn, { arbitrary: dailySeriesWithEpoch(), assertInvariant: true });
}

// Scenario 09: the vacuous variant - assertion removed, reachability floor
// still enforced.
function checkPreEpochInvariantVacuous(renderFn) {
  return runPreEpochInvariant(renderFn, { arbitrary: dailySeriesWithEpoch(), assertInvariant: false });
}

// Scenario 10: the shallow-generator variant - invariant assertion kept,
// generator never reaches a pre-epoch window.
function checkPreEpochInvariantShallowGenerator(renderFn) {
  return runPreEpochInvariant(renderFn, { arbitrary: dailySeriesWithEpochNeverPreEpoch(), assertInvariant: true });
}

// The non-vacuity ritual (coder.prompt / architect.prompt): a property test
// must FAIL when run against a deliberately broken implementation. Returns
// `{ vacuous: true }` when it does NOT fail - the check flagging exactly
// what scenario 09 demonstrates.
function assertNonVacuous(checkFn, defectiveRenderFn) {
  try {
    checkFn(defectiveRenderFn);
  } catch (err) {
    return { vacuous: false, error: err };
  }
  return { vacuous: true };
}

// fast-check's own fc.assert() failure message (counterexample + seed) does
// NOT include the original assertion's message by default - it lives on
// `err.cause` instead (node:assert's AssertionError). A caller checking
// "did the failure name the pre-epoch invariant" needs both.
function errorText(err) {
  const causeMessage = err && err.cause && err.cause.message;
  return causeMessage ? `${err.message}\n${causeMessage}` : err ? err.message : '';
}

module.exports = {
  checkPreEpochInvariant,
  checkPreEpochInvariantVacuous,
  checkPreEpochInvariantShallowGenerator,
  assertNonVacuous,
  errorText,
};
