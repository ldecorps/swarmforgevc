'use strict';

// BL-1599: step handlers for "the unit suite work ratchet holds the line".
// Scenario 01 drives the REAL classifySuiteWork/deriveExpectedWallMs/
// buildSuiteWorkVerdict against the committed 550000ms budget - no
// hand-copied arithmetic. Scenario 02 reads the module's own exported
// constants.

const assert = require('node:assert/strict');
const {
  buildSuiteWorkVerdict,
  SUITE_WORK_BUDGET_MS,
  SUITE_DURATION_BUDGET_MS,
} = require('../../../extension/out/tools/check-suite-duration-budget');

const FEATURE = 'BL-1599 The unit suite work ratchet holds the line';

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // -- Scenario 01 (Outline) -----------------------------------------------
  scoped(
    /^a recorded run with summed per-file work (\d+) ms, (\d+) forks and a slowest file of (\d+) ms$/,
    (ctx, work, forks, pole) => {
      ctx.bl1599 = { workMs: Number(work), forks: Number(forks), poleMs: Number(pole) };
    }
  );

  scoped(/^the work ratchet decides it against a 550000 ms budget with a 10 percent tolerance$/, (ctx) => {
    ctx.bl1599.result = buildSuiteWorkVerdict(ctx.bl1599.workMs, ctx.bl1599.forks, ctx.bl1599.poleMs, 550000, 0.1);
  });

  scoped(/^the verdict is (\S+) and the run's exit code is (\S+)$/, (ctx, verdict, exit) => {
    assert.equal(ctx.bl1599.result.verdict, verdict);
    const exitIsNonZero = ctx.bl1599.result.verdict === 'over-budget';
    if (exit === 'non-zero') {
      assert.equal(exitIsNonZero, true, `expected a non-zero exit for verdict "${ctx.bl1599.result.verdict}"`);
    } else {
      assert.equal(Number(exit), 0);
      assert.equal(exitIsNonZero, false, `expected a zero exit for verdict "${ctx.bl1599.result.verdict}"`);
    }
  });

  scoped(/^the derived expected wall is (\d+) ms, (\d+) ms from 13000$/, (ctx, wall, distance) => {
    assert.equal(ctx.bl1599.result.expectedWallMs, Number(wall));
    assert.equal(ctx.bl1599.result.distanceMs, Number(distance));
  });

  // -- Scenario 02 -----------------------------------------------------------
  scoped(/^the suite duration budget module is read$/, () => {
    // Import above already reads the real compiled module - nothing to do
    // but give the scenario a When step of its own.
  });

  scoped(/^SUITE_WORK_BUDGET_MS is 550000 and SUITE_DURATION_BUDGET_MS is still 10000$/, () => {
    assert.equal(SUITE_WORK_BUDGET_MS, 550000);
    assert.equal(SUITE_DURATION_BUDGET_MS, 10000);
  });
}

module.exports = { registerSteps };
