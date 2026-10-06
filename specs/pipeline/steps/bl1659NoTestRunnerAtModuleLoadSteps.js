'use strict';

// BL-1659: step handlers for "No step handler registers a test runner at
// module load, and fixture cleanup runs through the runtime's disposal".
//
// Drives the REAL require-census helper (extension/test/helpers/
// stepHandlerRequireCensus.js) against the REAL specs/pipeline/steps tree -
// never a reimplementation of the loader-intercept or the budget-guard
// logic. Scenario 01 censuses every real handler in one fresh child and
// checks the production census's own `registeredTestRunner` field, never a
// second definition of "requires node:test" re-derived in this file.
// Scenario 02 drives the real `checkHandlerBudgets` over a FIXTURE row that
// claims `registeredTestRunner: true`, proving the guard itself names that
// shape a violation - the census row shape, not a real file on disk.
// Scenario 03 requires the real step registry (specs/pipeline/steps/
// index.js) in a fresh child and reads its stdout for the TAP epilogue.
// Scenario 04 is this ticket's own reference recipe: a tiny fixture handler,
// registered into the SAME registry the scenario runs through, that
// creates a fixture root in a Given and registers its removal via
// `ctx.__disposables` (BL-1357) - never a hook the acceptance runtime does
// not run.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  censusAllHandlers,
  checkHandlerBudgets,
} = require('../../../extension/test/helpers/stepHandlerRequireCensus');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = "BL-1659 No step handler registers a test runner at module load, and fixture cleanup runs through the runtime's disposal";

// The same budget the production guard (extension/test/
// stepHandlerModuleLoadBudget.test.js) uses - this file must apply the SAME
// value to make the same true claim about the same real tree.
const PER_HANDLER_BUDGET_MS = 400;

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^every step handler is required in one fresh child process with the loader intercept$/, (ctx) => {
    ctx.bl1659Census = censusAllHandlers();
  });

  scoped(/^no handler loads node:test during its require$/, (ctx) => {
    const { rows } = ctx.bl1659Census;
    const violators = rows.filter((r) => r.registeredTestRunner);
    assert.deepEqual(
      violators.map((v) => v.file),
      [],
      `expected no handler to require node:test at module load, got: ${JSON.stringify(violators.map((v) => v.file))}`
    );
  });

  scoped(/^the census counts at least (\d+) handlers$/, (ctx, count) => {
    const { rows } = ctx.bl1659Census;
    assert.ok(
      rows.length >= Number(count),
      `expected at least ${count} handlers, got ${rows.length}`
    );
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the guard runs the require census over a fixture handler that requires node:test at module load$/, (ctx) => {
    const rows = [
      {
        file: 'fixtureRequiresNodeTestSteps.js',
        ms: 1,
        listedDir: false,
        spawnedProcess: false,
        registeredTestRunner: true,
        error: null,
      },
    ];
    ctx.bl1659Violations = checkHandlerBudgets(rows, { budgetMs: PER_HANDLER_BUDGET_MS });
  });

  scoped(/^it names that handler as a violation$/, (ctx) => {
    const named = ctx.bl1659Violations.find((v) => v.file === 'fixtureRequiresNodeTestSteps.js');
    assert.ok(
      named,
      `expected fixtureRequiresNodeTestSteps.js among the violations, got: ${JSON.stringify(ctx.bl1659Violations)}`
    );
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the step registry index is required in a fresh child process$/, (ctx) => {
    const { spawnSync } = require('node:child_process');
    const indexJs = path.join(__dirname, 'index.js');
    const res = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(indexJs)})`], {
      encoding: 'utf8',
    });
    ctx.bl1659RegistryOutput = `${res.stdout || ''}${res.stderr || ''}`;
  });

  // Scenario 03 was retired, never reworded (specifier amendment
  // 2026-10-06, 7e4f6c64c3): the MaxListenersExceededWarning this step
  // used to also assert away is not node:test's (11 exit listeners,
  // unchanged before/after this parcel, from handlers' own legitimate
  // exit cleanup - see backlog/evidence/BL-1659-coder-spec-gap-
  // maxlisteners-not-caused-by-node-test-20261006.md) and is out of this
  // ticket's scope. Scenario 05 asserts the TAP half alone.
  scoped(/^the child's output carries no TAP version line$/, (ctx) => {
    assert.doesNotMatch(
      ctx.bl1659RegistryOutput,
      /TAP version/,
      `expected no TAP epilogue, got:\n${ctx.bl1659RegistryOutput}`
    );
  });

  // ── Scenario 04: the disposal recipe ────────────────────────────────
  // A fresh, isolated registry and in-memory feature/scenario (same shape
  // bl726Bl718AcceptanceFeatureHasNoStepHandlersSteps.js's own
  // runBl718ScenarioByName uses) - never mutating the shared registry this
  // file's own steps are registered into.
  scoped(/^a fixture step handler that creates a fixture root in a Given step and registers its removal through the runtime's disposal$/, (ctx) => {
    const log = [];
    ctx.bl1659RecipeLog = log;
    const { createStepRegistry } = require('../stepRegistry');
    const recipeRegistry = createStepRegistry();
    recipeRegistry.define(/^the BL-1659 recipe fixture creates its own root$/, (innerCtx) => {
      innerCtx.__disposables = innerCtx.__disposables || [];
      const root = mkSocketFixtureRoot('bl1659-recipe-');
      innerCtx.bl1659RecipeRoot = root;
      innerCtx.__disposables.push(() => {
        log.push(root);
        fs.rmSync(root, { recursive: true, force: true });
      });
    });
    ctx.bl1659RunRecipeScenario = async () => {
      const { runScenario } = require('../runtime');
      const feature = { name: 'BL-1659 recipe fixture', background: [] };
      const scenario = {
        name: 'the recipe fixture disposes its own root',
        steps: [{ keyword: 'Given', text: 'the BL-1659 recipe fixture creates its own root' }],
      };
      await runScenario(recipeRegistry, feature, scenario);
    };
  });

  scoped(/^its scenario runs through the runtime$/, async (ctx) => {
    await ctx.bl1659RunRecipeScenario();
  });

  scoped(/^the disposal record names the root$/, (ctx) => {
    assert.ok(
      ctx.bl1659RecipeLog.length === 1 && typeof ctx.bl1659RecipeLog[0] === 'string',
      `expected the disposal record to name the root, got: ${JSON.stringify(ctx.bl1659RecipeLog)}`
    );
    ctx.bl1659RecipeDisposedRoot = ctx.bl1659RecipeLog[0];
  });

  scoped(/^the root no longer exists$/, (ctx) => {
    assert.equal(
      fs.existsSync(ctx.bl1659RecipeDisposedRoot),
      false,
      `expected ${ctx.bl1659RecipeDisposedRoot} to have been removed`
    );
  });
}

module.exports = { registerSteps };
