'use strict';

// BL-445: step handlers for "The unit suite runs below the 10-second target
// and an over-budget run is surfaced". Drives the REAL compiled
// classifySuiteDuration/buildSuiteBudgetVerdict/formatSuiteBudgetVerdict
// (check-suite-duration-budget.ts) directly - pure, no VS Code, no network,
// no live suite run. The OPERATIONAL half of this ticket (the suite's actual
// wall-clock) is a QA e2e procedure (`npm test`, per the ticket's own notes),
// not an acceptance scenario - mirrors noSingleFileBoundsTheSuiteSteps.js's
// own split between acceptance-verified pure logic and E2E-verified wiring.
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { buildSuiteBudgetVerdict, formatSuiteBudgetVerdict, SUITE_DURATION_BUDGET_MS } = require(
  path.join(EXT_DIR, 'out', 'tools', 'check-suite-duration-budget')
);

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a passing unit-suite run recorded in the test-duration log$/, (ctx) => {
    ctx.budgetMs = SUITE_DURATION_BUDGET_MS;
  });

  // ── BL-445 unit-suite-below-10s-01 (Scenario Outline) ───────────────
  registry.define(/^the recorded run lasted "([^"]+)" ms$/, (ctx, durationMsText) => {
    ctx.durationMs = Number(durationMsText);
  });

  registry.define(/^its duration is checked against the 10-second suite budget$/, (ctx) => {
    ctx.result = buildSuiteBudgetVerdict(ctx.durationMs, ctx.budgetMs);
  });

  registry.define(/^the run is reported "([^"]+)"$/, (ctx, expectedVerdict) => {
    if (ctx.result.verdict !== expectedVerdict) {
      throw new Error(`expected verdict "${expectedVerdict}", got "${ctx.result.verdict}" for duration ${ctx.durationMs}ms`);
    }
  });

  // ── BL-445 unit-suite-below-10s-02 ──────────────────────────────────
  registry.define(/^the recorded run is over the 10-second suite budget$/, (ctx) => {
    ctx.durationMs = ctx.budgetMs + 2963;
  });

  registry.define(/^the whole-suite budget verdict is produced$/, (ctx) => {
    ctx.result = buildSuiteBudgetVerdict(ctx.durationMs, ctx.budgetMs);
    ctx.formatted = formatSuiteBudgetVerdict(ctx.result);
  });

  registry.define(/^the verdict names the run as an offender with its measured duration$/, (ctx) => {
    if (ctx.result.verdict !== 'over-budget') {
      throw new Error(`expected the verdict to be over-budget, got "${ctx.result.verdict}"`);
    }
    if (!/over budget/.test(ctx.formatted)) {
      throw new Error(`expected the formatted verdict to name the run as an offender, got: ${ctx.formatted}`);
    }
    const durationS = (ctx.durationMs / 1000).toFixed(1);
    if (!ctx.formatted.includes(`${durationS}s`)) {
      throw new Error(`expected the formatted verdict to include the measured duration ${durationS}s, got: ${ctx.formatted}`);
    }
  });
}

module.exports = { registerSteps };
