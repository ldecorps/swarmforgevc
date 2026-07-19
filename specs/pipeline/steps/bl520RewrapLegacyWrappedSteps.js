'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  BL131_FEATURE,
  REPO_ROOT,
  SAMPLE_REWRAPPED_FEATURE,
  assertNoContinuationLines,
  assertNoLegacyAllowlistEntries,
  readLegacyAllowlistEntries,
  runLintGate,
} = require('./bl520RewrapLegacyWrappedStepsSupport');

const {
  assertFreshWrappedStepRejected,
  runFullStepReconciliationFixture,
  runRestoredParamFixture,
} = require('./bl520RewrapLegacyWrappedStepsFixtures');

function registerSteps(registry) {
  registry.define(/^a legacy feature file whose wrapped steps have been rejoined to single lines$/, (ctx) => {
    ctx.featurePath = SAMPLE_REWRAPPED_FEATURE;
    assertNoContinuationLines(ctx.featurePath);
  });

  registry.define(/^its entry has been removed from the grandfather allowlist$/, (ctx) => {
    const relativePath = path.relative(REPO_ROOT, ctx.featurePath);
    assert.equal(readLegacyAllowlistEntries().includes(relativePath), false);
  });

  registry.define(/^the gherkin lint gate runs on it$/, (ctx) => {
    ctx.lintResult = runLintGate(ctx.featurePath);
  });

  registry.define(/^the gate passes cleanly$/, (ctx) => {
    assert.equal(ctx.lintResult.status, 0, `expected lint gate to pass; stdout=${ctx.lintResult.stdout} stderr=${ctx.lintResult.stderr}`);
    assert.match(ctx.lintResult.stdout, /^OK: /m);
  });

  registry.define(/^a rewrapped legacy feature file whose step handlers were reconciled to the full step text$/, (ctx) => {
    ctx.featurePath = SAMPLE_REWRAPPED_FEATURE;
    ctx.featureText = assertNoContinuationLines(ctx.featurePath);
  });

  registry.define(/^its acceptance entry points are generated and run$/, (ctx) => {
    ctx.acceptanceResult = runFullStepReconciliationFixture();
  });

  registry.define(/^every scenario resolves to a step handler and the run passes$/, (ctx) => {
    const { tmpDir, outDir, result, sentinelPath } = ctx.acceptanceResult;
    try {
      assert.equal(result.status, 0, `expected generated acceptance run to pass; stdout=${result.stdout} stderr=${result.stderr}`);
      assert.match(result.stdout, /# pass 1/m);
      assert.equal(fs.existsSync(path.join(outDir, 'full-step-reconciliation-fixture.generated.test.js')), true);
      assert.equal(fs.readFileSync(sentinelPath, 'utf8'), 'executed');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  registry.define(/^a legacy wrapped step whose continuation line carried a parameter the parser dropped$/, (ctx) => {
    ctx.featurePath = BL131_FEATURE;
    ctx.featureText = assertNoContinuationLines(ctx.featurePath);
  });

  registry.define(/^the step is rejoined to a single line and its handler is reconciled$/, (ctx) => {
    assert.match(
      ctx.featureText,
      /Then no test contains a bare `setTimeout`\/`setInterval` call or an\s+`await new Promise\(resolve => setTimeout\(resolve, <ms>\)\)` wait on the\s+real clock/
    );
    ctx.paramAcceptanceResult = runRestoredParamFixture();
  });

  registry.define(/^the restored parameter reaches the step handler and its Examples column is referenced$/, (ctx) => {
    assert.match(ctx.featureText, /<ms>/);
    const gateResult = runLintGate(ctx.featurePath);
    assert.equal(gateResult.status, 0, `expected BL-131 to have no phantom <ms> column; stdout=${gateResult.stdout} stderr=${gateResult.stderr}`);
    const { tmpDir, result, sentinelPath } = ctx.paramAcceptanceResult;
    try {
      assert.equal(result.status, 0, `expected restored <ms> acceptance fixture to pass; stdout=${result.stdout} stderr=${result.stderr}`);
      assert.equal(fs.readFileSync(sentinelPath, 'utf8'), '137');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  registry.define(/^every legacy feature file has been rewrapped and removed from the allowlist$/, (ctx) => {
    assertNoLegacyAllowlistEntries();
  });

  registry.define(/^the allowlist holds no feature-file entries$/, () => {
    assertNoLegacyAllowlistEntries();
  });

  registry.define(/^the lint gate enforces single-line steps for every feature file with no exemptions$/, () => {
    assertFreshWrappedStepRejected();
  });
}

module.exports = { registerSteps };
