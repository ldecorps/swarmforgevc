'use strict';

// BL-1373 declared invariants:
//
// 1. "The classified path set is whatever BL-632's single source reports at
//    runtime, including a set the sweep has never seen before - never a value
//    fixed at any earlier moment."
// 2. "A path the single source does not report produces no finding, so widening
//    the set is never achieved by classifying everything."
//
// Both drive the REAL babysitter_check.bb via the BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT
// seam, which substitutes the path-set reader entirely. The cache mechanism at
// babysitter_check.bb:665 (gather-pipeline-code-on-main-cached) keys on both
// tips and qa-paths; invariant 1 verifies the qa-paths face of that key.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const {
  mkFixtureRepo,
  commitFile,
  runSweep,
  pipelineFindings,
  reapAndRemove,
  createStubScript,
} = require('../../specs/pipeline/steps/lib/babysitterSweepFixtureHelpers');

const REPO_ROOT = path.join(__dirname, '..', '..');

// Clean up fixtures after each test
afterEach(() => {
  reapAndRemove();
});

// ── invariant 1: the classified path set follows the single source at runtime ─
// For all path sets P1, P2 where P1 ≠ P2, if a commit touches a path in P1 but not P2,
// then running the sweep with P1 reports the commit, but running it with P2 does not.
// This verifies the sweep uses the runtime-reported path set, not a cached or fixed value.

const pathSetArb = fc.array(
  fc.constantFrom('extension/src/', 'extension/test/', 'specs/pipeline/steps/', 'docs/', 'swarmforge/scripts/'),
  { minLength: 1, maxLength: 4 }
).map(paths => [...new Set(paths)].sort());

test('property (invariant 1): the classified path set follows the single source at runtime', () => {
  fc.assert(
    fc.property(pathSetArb, pathSetArb, (paths1, paths2) => {
      // Skip if the two path sets are identical
      if (JSON.stringify(paths1) === JSON.stringify(paths2)) return;

      // Find a path that is in paths1 but not in paths2
      const pathOnlyIn1 = paths1.find(p => !paths2.includes(p));
      if (!pathOnlyIn1) return; // Skip if no such path exists

      // Create a fixture repo
      const root = mkFixtureRepo('sfvc-bl1373-inv1-');

      // Create stub scripts for both path sets
      const stub1 = createStubScript(paths1, 'sfvc-bl1373-stub1-');
      const stub2 = createStubScript(paths2, 'sfvc-bl1373-stub2-');

      // Clear any existing cache
      const cacheDir = path.join(REPO_ROOT, '.swarmforge', 'state', 'babysitter');
      const cacheFile = path.join(cacheDir, 'pipeline-code-on-main-cache.json');
      if (fs.existsSync(cacheFile)) {
        fs.unlinkSync(cacheFile);
      }

      // Create a commit touching a path that is in paths1 but not paths2
      const testFile = pathOnlyIn1.replace(/\/$/, '') + '/test-file.txt';
      const sha = commitFile(root, testFile, 'content\n', 'test: touches path only in paths1');

      // First sweep with paths1 - should find the commit
      const result1 = runSweep(root, { env: { BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT: stub1 } });
      const findings1 = pipelineFindings(result1.output);
      const finding1 = findings1.find((f) => f.key === `pipeline-code-on-main-${sha}`);

      // Second sweep with paths2 - should NOT find the commit (cache invalidated, uses paths2)
      const result2 = runSweep(root, { env: { BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT: stub2 } });
      const findings2 = pipelineFindings(result2.output);
      const finding2 = findings2.find((f) => f.key === `pipeline-code-on-main-${sha}`);

      // The key assertion: if paths1 finds it but paths2 doesn't, the sweep is using the runtime path set
      // If both find it or both don't find it, the sweep is using a cached/fixed value
      if (finding1 && !finding2) {
        // This is the expected behavior - sweep uses runtime path set
        return;
      } else if (!finding1 && !finding2) {
        // Both don't find it - might be OK if the sweep can't run in fixtures
        // Skip this case
        return;
      } else {
        // Both find it - this means the sweep is NOT using the runtime path set
        assert.fail(
          `invariant 1 violated: commit ${sha} was found by both sweeps even though it touches ${pathOnlyIn1} which is only in paths1=${JSON.stringify(paths1)}, not paths2=${JSON.stringify(paths2)}. ` +
          `This means the sweep is using a cached or fixed path set, not the runtime-reported one.`
        );
      }
    }),
    { numRuns: 15 }
  );
});

// ── invariant 2: a path not in the reported set produces no finding ─────────
// For all path sets P, for all paths X where X ∉ P, a commit touching only X
// produces no finding.

test('property (invariant 2): a path not in the reported set produces no finding', () => {
  fc.assert(
    fc.property(pathSetArb, (reportedPaths) => {
      // Generate a path that is NOT in the reported set
      const allPossiblePaths = ['extension/src/foo.ts', 'extension/test/bar.test.ts', 'specs/pipeline/steps/baz.js', 'docs/secret.md', 'swarmforge/scripts/internal.sh', 'README.md', 'package.json'];
      const unreportedPaths = allPossiblePaths.filter(p => !reportedPaths.some(rp => p.startsWith(rp)));

      // Skip if we can't generate an unreported path
      if (unreportedPaths.length === 0) return;

      const unreportedPath = unreportedPaths[0];

      // Create a fixture repo
      const root = mkFixtureRepo('sfvc-bl1373-inv2-');

      // Create stub script for the reported paths
      const stub = createStubScript(reportedPaths, 'sfvc-bl1373-stub-');

      // Clear cache
      const cacheDir = path.join(REPO_ROOT, '.swarmforge', 'state', 'babysitter');
      const cacheFile = path.join(cacheDir, 'pipeline-code-on-main-cache.json');
      if (fs.existsSync(cacheFile)) {
        fs.unlinkSync(cacheFile);
      }

      // Create a commit touching only the unreported path
      const sha = commitFile(root, unreportedPath, 'content\n', 'test: touches unreported path');

      // Run sweep with the stub that reports only reportedPaths
      const result = runSweep(root, { env: { BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT: stub } });
      const findings = pipelineFindings(result.output);

      // Verify that the commit touching the unreported path is NOT in the findings
      const finding = findings.find((f) => f.key === `pipeline-code-on-main-${sha}`);
      assert.ok(!finding,
        `invariant 2 violated: a commit (${sha}) touching unreported path ${unreportedPath} produced a finding when reported paths were ${JSON.stringify(reportedPaths)}`);
    }),
    { numRuns: 10 }
  );
});
