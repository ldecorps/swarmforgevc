'use strict';

// BL-420: step handlers driving the REAL shared temp-dir helper
// (extension/test/helpers/tmpDir.js, plain JS - no compile step, test-only
// code) and the REAL regression guard (rawMkdtempGuard.js) directly - never
// a hand-rolled substitute for either.
const path = require('node:path');

const EXT_TEST = path.join(__dirname, '..', '..', '..', 'extension', 'test');
const { mkTmpDir, sweepPendingTmpDirs } = require(path.join(EXT_TEST, 'helpers', 'tmpDir'));
const { findRawMkdtempCallSites } = require(path.join(EXT_TEST, 'helpers', 'rawMkdtempGuard'));

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a test that allocates a temp directory through the shared temp-dir helper$/, () => {
    // Non-behavioral: each scenario's own Given step below drives the real
    // mkTmpDir/sweepPendingTmpDirs directly.
  });

  // ── test-helpers-clean-up-tmp-dirs-01 ───────────────────────────────────
  registry.define(/^the helper created a temp directory for the test$/, (ctx) => {
    ctx.dir = mkTmpDir('sfvc-bl420-acceptance-');
  });

  registry.define(/^the test's teardown runs$/, () => {
    sweepPendingTmpDirs();
  });

  registry.define(/^that exact directory no longer exists$/, (ctx) => {
    const fs = require('node:fs');
    if (fs.existsSync(ctx.dir)) {
      throw new Error(`expected ${ctx.dir} to have been removed by teardown, but it still exists`);
    }
  });

  // ── test-helpers-clean-up-tmp-dirs-02 ───────────────────────────────────
  registry.define(/^the test body throws after the helper created its temp directory$/, (ctx) => {
    ctx.dir = mkTmpDir('sfvc-bl420-acceptance-throw-');
    try {
      throw new Error('simulated test-body failure');
    } catch {
      // swallowed - mirrors a real test body throwing after allocating its
      // dir; the dir is still recorded for the next sweep regardless.
    }
  });

  registry.define(/^teardown runs$/, () => {
    sweepPendingTmpDirs();
  });

  // "Then that exact directory no longer exists" reuses the SAME handler
  // registered above for scenario 01 - identical step text, identical check.

  // ── test-helpers-clean-up-tmp-dirs-03 ───────────────────────────────────
  registry.define(/^a scan of the extension test suite for raw os\.tmpdir mkdtemp calls$/, (ctx) => {
    ctx.scanTarget = EXT_TEST;
  });

  registry.define(/^the scan runs$/, (ctx) => {
    ctx.violations = findRawMkdtempCallSites(ctx.scanTarget);
  });

  registry.define(/^no test allocates an os\.tmpdir temp directory outside the shared helper$/, (ctx) => {
    if (ctx.violations.length > 0) {
      throw new Error(`expected zero raw mkdtemp call sites, found:\n${ctx.violations.map((v) => `${v.file}:${v.line}`).join('\n')}`);
    }
  });
}

module.exports = { registerSteps };
