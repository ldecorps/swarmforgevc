'use strict';

// BL-1373: step handlers for "The sweep reads the path set it is told".
// These scenarios verify the two invariants from the ticket:
// 1. The classified path set is whatever BL-632's single source reports at runtime
// 2. A path the single source does not report produces no finding
//
// The implementation reuses the same fixture pattern as BL-631 scenario 07.

const assert = require('node:assert/strict');
const { afterEach } = require('node:test');
const {
  mkFixtureRepo,
  commitFile,
  runSweep,
  pipelineFindings,
  reapAndRemove,
  createStubScript,
} = require('./lib/babysitterSweepFixtureHelpers');

const FEATURE = 'The sweep reads the path set it is told';

afterEach(() => {
  reapAndRemove();
});

function registerSteps(registry) {
  // Background
  registry.defineScoped(
    /^the QA-exclusive path set is reported by BL-632's single source$/,
    () => {
      // No-op: this is just context setting
    },
    FEATURE
  );

  // Scenario 01
  registry.defineScoped(
    /^the single source reports a path set the sweep has never seen$/,
    (ctx) => {
      ctx.root = mkFixtureRepo('sfvc-bl1373-');
      ctx.stubPaths = ['docs/custom-secret.md', 'internal/restricted/'];
      ctx.stubScript = createStubScript(ctx.stubPaths, 'sfvc-bl1373-stub-');
    },
    FEATURE
  );

  registry.defineScoped(
    /^a commit touches only a path from that reported set$/,
    (ctx) => {
      ctx.sha = commitFile(ctx.root, 'docs/custom-secret.md', 'secret\n', 'coder: touches stub path');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the babysitter sweep runs$/,
    (ctx) => {
      ctx.result = runSweep(ctx.root, { env: { BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT: ctx.stubScript } });
      ctx.findings = pipelineFindings(ctx.result.output);
    },
    FEATURE
  );

  registry.defineScoped(
    /^that commit fires a critical finding$/,
    (ctx) => {
      const finding = ctx.findings.find((f) => f.key === `pipeline-code-on-main-${ctx.sha}`);
      assert.ok(finding, `expected a critical finding for ${ctx.sha}, got:\n${ctx.result.output}`);
      assert.equal(finding.severity, 'CRIT');
    },
    FEATURE
  );

  // Scenario 02
  registry.defineScoped(
    /^the single source reports a path set that excludes a path$/,
    (ctx) => {
      ctx.root = mkFixtureRepo('sfvc-bl1373-');
      ctx.stubPaths = ['docs/custom-secret.md'];
      ctx.stubScript = createStubScript(ctx.stubPaths, 'sfvc-bl1373-stub-');
      ctx.excludedPath = 'extension/src/foo.ts';
    },
    FEATURE
  );

  registry.defineScoped(
    /^a commit touches only that excluded path$/,
    (ctx) => {
      ctx.sha = commitFile(ctx.root, ctx.excludedPath, 'code\n', 'coder: touches excluded path');
    },
    FEATURE
  );

  registry.defineScoped(
    /^that commit produces no finding$/,
    (ctx) => {
      const finding = ctx.findings.find((f) => f.key === `pipeline-code-on-main-${ctx.sha}`);
      assert.ok(!finding, `expected NO finding for ${ctx.sha} (excluded path), got:\n${ctx.result.output}`);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
