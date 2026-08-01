'use strict';

// BL-771: step handlers driving the REAL raw-mkdtemp migration guard and the
// REAL compiled pricing-coverage check directly - never a hand-rolled
// reimplementation of either. What counts as "fixed" is what the guard
// REPORTS when it walks the real extension/test tree, never a file list
// copied out of a bounce note (that's exactly how BL-714 left this ticket's
// offender unmigrated).
const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_TEST = path.join(REPO_ROOT, 'extension', 'test');
const { mkTmpDir, sweepPendingTmpDirs } = require(path.join(EXT_TEST, 'helpers', 'tmpDir'));
const { findRawMkdtempCallSites, SELF_EXEMPT_RELATIVE_PATHS } = require(path.join(EXT_TEST, 'helpers', 'rawMkdtempGuard'));
const { checkPricingCoverage } = require(path.join(REPO_ROOT, 'extension', 'out', 'metrics', 'pricingTable'));

const EXPECTED_EXEMPT_PATHS = ['helpers/tmpDir.js', 'tmpDirMigrationGuard.test.js', 'tmpDirMigrationGuard.property.test.js'];

function registerSteps(registry) {
  // ── shared-tmpdir-helper-01 ─────────────────────────────────────────────
  registry.define(/^the raw-mkdtemp migration guard walks the real extension\/test tree$/, (ctx) => {
    ctx.mkdtempViolations = findRawMkdtempCallSites(EXT_TEST);
  });

  registry.define(/^it reports zero raw mkdtemp call sites$/, (ctx) => {
    if (ctx.mkdtempViolations.length > 0) {
      throw new Error(
        `expected zero raw mkdtemp call sites, found:\n${ctx.mkdtempViolations.map((v) => `${v.file}:${v.line}`).join('\n')}`,
      );
    }
  });

  // ── shared-tmpdir-helper-02 ─────────────────────────────────────────────
  registry.define(/^the raw-mkdtemp migration guard's own configuration is inspected$/, () => {
    // Non-behavioral: the Then steps below inspect the real exported
    // SELF_EXEMPT_RELATIVE_PATHS and re-run the real scanner directly.
  });

  registry.define(
    /^its exempt paths are exactly helpers\/tmpDir\.js, tmpDirMigrationGuard\.test\.js and tmpDirMigrationGuard\.property\.test\.js$/,
    () => {
      const actual = SELF_EXEMPT_RELATIVE_PATHS;
      const matches = actual.length === EXPECTED_EXEMPT_PATHS.length && EXPECTED_EXEMPT_PATHS.every((p, i) => actual[i] === p);
      if (!matches) {
        throw new Error(`expected exempt paths exactly ${JSON.stringify(EXPECTED_EXEMPT_PATHS)}, got ${JSON.stringify(actual)}`);
      }
    },
  );

  registry.define(/^it still flags a raw mkdtemp call planted in a fixture copy of pricingTable\.test\.js$/, () => {
    const root = mkTmpDir('sfvc-bl771-acceptance-fixture-');
    const offender = path.join(root, 'pricingTable.test.js');
    try {
      fs.writeFileSync(offender, "const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl627-unpriced-'));\n");
      const violations = findRawMkdtempCallSites(root);
      if (violations.length !== 1 || violations[0].file !== offender || violations[0].line !== 1) {
        throw new Error(`expected exactly one violation at ${offender}:1, got: ${JSON.stringify(violations)}`);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // ── shared-tmpdir-helper-03 ─────────────────────────────────────────────
  registry.define(/^a fixture repo whose swarmforge\.conf names a model absent from the pricing table$/, (ctx) => {
    ctx.fixtureRoot = mkTmpDir('sfvc-bl771-coverage-fixture-');
    ctx.fixtureModel = 'claude-bl771-unpriced-fixture-model';
    fs.mkdirSync(path.join(ctx.fixtureRoot, 'swarmforge', 'packs'), { recursive: true });
    fs.writeFileSync(
      path.join(ctx.fixtureRoot, 'swarmforge', 'swarmforge.conf'),
      `window coder claude coder --model ${ctx.fixtureModel} --dangerously-skip-permissions\n`,
    );
  });

  registry.define(/^the unpriced-model pricing coverage check runs against it$/, (ctx) => {
    ctx.coverageResult = checkPricingCoverage(ctx.fixtureRoot);
  });

  registry.define(/^it reports not ok and names that model$/, (ctx) => {
    if (ctx.coverageResult.ok !== false || !ctx.coverageResult.missing.includes(ctx.fixtureModel)) {
      throw new Error(`expected not-ok naming ${ctx.fixtureModel}, got: ${JSON.stringify(ctx.coverageResult)}`);
    }
  });

  registry.define(/^the fixture temp root does not survive the test file's teardown$/, (ctx) => {
    sweepPendingTmpDirs();
    if (fs.existsSync(ctx.fixtureRoot)) {
      throw new Error(`expected ${ctx.fixtureRoot} to have been removed by teardown, but it still exists`);
    }
  });
}

module.exports = { registerSteps };
