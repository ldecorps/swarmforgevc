'use strict';

// BL-485: step handlers for "A count-only mutation-site helper reports
// per-file site counts and flags oversized changed files". Drives the REAL
// compiled countMutationSites/verdictFor (extension/out/quality/
// mutationSiteCount.js) against a FAKE countMutantsPerFile adapter - this
// feature pins the COUNTING/MAPPING/THRESHOLD contract, not Stryker's own
// mutant-generation correctness (that is Stryker's own concern). The real
// @stryker-mutator/instrumenter wiring (mutation-site-count.js's
// realAdapters) is proven separately by mutationSiteCountCli.test.js's
// real-engine tests, the same TESTABLE-boundary split
// dependencyGate.test.js/dependencyGateCli*.test.js already established.
const assert = require('node:assert/strict');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { countMutationSites, verdictFor } = require(path.join(EXT_DIR, 'out', 'quality', 'mutationSiteCount'));

// countsByOutPath: { outPath: siteCount } - a changed file whose path isn't
// a key here is treated as having no compiled counterpart (readOutFile
// returns undefined), matching mutationSiteCount.ts's own real contract.
function fakeAdapters(countsByOutPath) {
  return {
    readOutFile: (outPath) => (outPath in countsByOutPath ? `// fixture content for ${outPath}` : undefined),
    countMutantsPerFile: async (files) => {
      const counts = {};
      for (const f of files) counts[f.path] = countsByOutPath[f.path];
      return counts;
    },
  };
}

function registerSteps(registry) {
  // ── mutation-site-size-gate-01 ───────────────────────────────────────
  registry.define(/^changed compiled files with (\d+) and (\d+) mutation sites$/, (ctx, first, second) => {
    ctx.changedFiles = ['out/quality/first.js', 'out/quality/second.js'];
    ctx.adapters = fakeAdapters({
      'out/quality/first.js': Number(first),
      'out/quality/second.js': Number(second),
    });
  });

  registry.define(/^the count-only helper runs on the changed files$/, async (ctx) => {
    ctx.result = await countMutationSites(ctx.changedFiles, ctx.adapters);
  });

  registry.define(/^it reports a mutation-site count of (\d+) for the first file and (\d+) for the second$/, (ctx, first, second) => {
    assert.equal(ctx.result[0].siteCount, Number(first));
    assert.equal(ctx.result[1].siteCount, Number(second));
  });

  // ── mutation-site-size-gate-02 ────────────────────────────────────────
  registry.define(/^a changed TypeScript source file whose compiled out\/ file has (\d+) mutation sites$/, (ctx, sites) => {
    ctx.changedFiles = ['extension/src/quality/mapped.ts'];
    ctx.adapters = fakeAdapters({ 'extension/out/quality/mapped.js': Number(sites) });
  });

  registry.define(/^it reports (\d+) mutation sites for that file from its compiled out\/ mapping$/, (ctx, sites) => {
    assert.equal(ctx.result[0].outPath, 'extension/out/quality/mapped.js');
    assert.equal(ctx.result[0].siteCount, Number(sites));
  });

  // ── mutation-site-size-gate-03 ────────────────────────────────────────
  registry.define(/^a changed compiled file with (\d+) mutation sites$/, (ctx, sites) => {
    ctx.changedFiles = ['out/quality/solo.js'];
    ctx.adapters = fakeAdapters({ 'out/quality/solo.js': Number(sites) });
  });

  registry.define(/^it does not execute any mutant against the test suite$/, (ctx) => {
    // A count-only run can never report a kill/survive/test-execution
    // verdict for anything it never ran - proof by construction: the
    // returned record carries only the site count, no test-result field.
    assert.deepEqual(Object.keys(ctx.result[0]).sort(), ['file', 'outPath', 'siteCount']);
  });

  // ── mutation-site-size-gate-04 (Scenario Outline) ────────────────────
  registry.define(/^the mutation-site size threshold is configured to (\d+) sites$/, (ctx, threshold) => {
    ctx.threshold = Number(threshold);
  });

  registry.define(/^the file is reported as (over|within) the size gate$/, (ctx, expectedVerdict) => {
    const verdict = verdictFor(ctx.result[0].siteCount, ctx.threshold);
    assert.equal(verdict, expectedVerdict);
  });
}

module.exports = { registerSteps };
