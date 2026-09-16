'use strict';

// BL-378: step handlers for "No single test file may silently become the
// suite's wall clock". Scenarios 01-03 drive the REAL compiled
// checkFileDurationBudget/formatBudgetOffenders (check-suite-file-budget.ts)
// directly - pure, no VS Code, no network, no live suite run. Scenario 04
// is verified STRUCTURALLY (recordTestDuration.js - what `npm test`
// actually invokes - unconditionally spawns the compiled guard CLI, and
// package.json's own "test" script is what reaches that file) rather than
// by running the real multi-second suite inside this acceptance run -
// mirrors systemdUnitsCanStartSteps.js's own structural-proof convention
// for a scenario whose live version is a real E2E procedure, not an
// acceptance-suite one (this ticket's own E2E QA PROCEDURE note).
//
// IR-DRY HAZARD (the ticket's own explicit warning): scenarios 01/02/03's
// When steps all share the tail "test file(s) exceeding that budget" -
// each gets its own fully literal, anchored regex (no shared wildcard)
// so the registry's first-match-wins resolve() can never let one
// scenario silently invoke another's handler.
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { checkFileDurationBudget, formatBudgetOffenders, PER_FILE_DURATION_BUDGET_MS, NEW_POLE_REFUSAL_FRACTION } = require(
  path.join(EXT_DIR, 'out', 'tools', 'check-suite-file-budget')
);

const RECORD_TEST_DURATION_PATH = path.join(EXT_DIR, 'scripts', 'recordTestDuration.js');
const PACKAGE_JSON_PATH = path.join(EXT_DIR, 'package.json');

function registerSteps(registry) {
  // ── Background-ish Given (01/02/03 each restate it) ─────────────────
  registry.define(/^a per-file duration budget$/, (ctx) => {
    ctx.budgetMs = PER_FILE_DURATION_BUDGET_MS;
  });

  // ── no-single-file-bounds-the-suite-01 ──────────────────────────────
  // BL-1598 amendment (2026-09-16): an unregistered file only refuses at
  // or above NEW_POLE_REFUSAL_FRACTION times the budget (a bare breach is
  // `watch`, reported not refused) - this scenario's own "exceeds that
  // budget" means "exceeds it clearly enough to refuse", so the duration
  // is chosen at 2x the budget, well past the 1.5x line.
  registry.define(/^the guard sees a test file whose duration exceeds that budget$/, (ctx) => {
    ctx.result = checkFileDurationBudget([{ file: 'test/slow.test.js', durationMs: ctx.budgetMs * 2 }], ctx.budgetMs);
  });

  registry.define(/^the guard fails$/, (ctx) => {
    if (ctx.result.passed !== false) {
      throw new Error(`expected the guard to fail, got passed=${ctx.result.passed}`);
    }
  });

  registry.define(/^it names the offending file, its duration, and the budget it broke$/, (ctx) => {
    const text = formatBudgetOffenders(ctx.result.offenders);
    if (!text.includes('test/slow.test.js') || !text.includes('14.0s') || !text.includes('7.0s')) {
      throw new Error(`expected the report to name the file, its duration, and the broken budget, got: ${text}`);
    }
  });

  // ── no-single-file-bounds-the-suite-02 ──────────────────────────────
  registry.define(/^the guard sees no test file exceeding that budget$/, (ctx) => {
    ctx.result = checkFileDurationBudget([{ file: 'test/fast.test.js', durationMs: 10 }], ctx.budgetMs);
  });

  registry.define(/^the guard passes$/, (ctx) => {
    if (ctx.result.passed !== true) {
      throw new Error(`expected the guard to pass, got passed=${ctx.result.passed}, offenders=${JSON.stringify(ctx.result.offenders)}`);
    }
  });

  // ── no-single-file-bounds-the-suite-03 ──────────────────────────────
  // BL-1598 amendment: both durations chosen at/above 2x the budget, well
  // past the 1.5x refusal line, so this stays a test of "every new-pole
  // offender is named", not a probe of the watch band.
  registry.define(/^the guard sees more than one test file exceeding that budget$/, (ctx) => {
    ctx.result = checkFileDurationBudget(
      [
        { file: 'test/slow1.test.js', durationMs: ctx.budgetMs * 2 },
        { file: 'test/slow2.test.js', durationMs: ctx.budgetMs * 3 },
      ],
      ctx.budgetMs
    );
  });

  registry.define(/^it names every one of them$/, (ctx) => {
    const names = ctx.result.offenders.map((o) => o.file);
    if (names.length !== 2 || !names.includes('test/slow1.test.js') || !names.includes('test/slow2.test.js')) {
      throw new Error(`expected both offenders named, got: ${JSON.stringify(names)}`);
    }
  });

  // ── no-single-file-bounds-the-suite-04 (structural - dark-feature check) ──
  registry.define(/^the project's normal verification command runs$/, (ctx) => {
    ctx.recordTestDurationSource = fs.readFileSync(RECORD_TEST_DURATION_PATH, 'utf8');
    ctx.packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  });

  registry.define(/^the guard runs as part of it, without being invoked by hand$/, (ctx) => {
    if (!ctx.packageJson.scripts.test.includes('recordTestDuration.js')) {
      throw new Error(`expected package.json's "test" script (the normal verification command) to invoke recordTestDuration.js, got: ${ctx.packageJson.scripts.test}`);
    }
    // BL-1598: the guard now runs IN-PROCESS via runGuardAgainstReport (the
    // same decision check-suite-file-budget.ts's own standalone CLI makes),
    // not a second subprocess spawn of a compiled CLI - see that module's
    // own header comment for why (one decision, two callers).
    if (!/runGuardAgainstReport/.test(ctx.recordTestDurationSource)) {
      throw new Error('expected recordTestDuration.js to reference runGuardAgainstReport (the in-process guard call)');
    }
    if (!/if\s*\(fs\.existsSync\(REPORT_PATH\)\)/.test(ctx.recordTestDurationSource)) {
      throw new Error('expected recordTestDuration.js to unconditionally run the guard whenever the report was written, not merely reference it');
    }
  });
}

module.exports = { registerSteps };
