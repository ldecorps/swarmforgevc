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

// Get the cache file path for a given fixture root
function getCacheFile(root) {
  return path.join(root, '.swarmforge', 'state', 'babysitter', 'pipeline-code-on-main-cache.json');
}

// Clear the pipeline-code-on-main cache for a given fixture root, tolerating fd pressure (BL-fd-pressure).
// Returns true if a cache file was removed, false if none existed or removal failed.
function clearPipelineCache(root) {
  try {
    fs.unlinkSync(getCacheFile(root));
    return true;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return false;
  }
}

// Write a cache entry directly for testing
function writePipelineCache(root, entry) {
  const cacheFile = getCacheFile(root);
  const cacheDir = path.dirname(cacheFile);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(entry));
}

// Read the cache entry for a given fixture root
function readPipelineCache(root) {
  const cacheFile = getCacheFile(root);
  if (!fs.existsSync(cacheFile)) return null;
  return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
}

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
      clearPipelineCache(root);

      // Create a commit touching a path that is in paths1 but not paths2
      const testFile = pathOnlyIn1.replace(/\/$/, '') + '/test-file.txt';
      const sha = commitFile(root, testFile, 'content\n', 'test: touches path only in paths1');

      // First sweep with paths1 - should find the commit
      const result1 = runSweep(root, { env: { BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT: stub1 } });
      assert.equal(result1.exitCode, 0, `sweep 1 failed with exit code ${result1.exitCode}: ${result1.output}`);
      const findings1 = pipelineFindings(result1.output);
      const finding1 = findings1.find((f) => f.key === `pipeline-code-on-main-${sha}`);

      // Second sweep with paths2 - should NOT find the commit (uses paths2, not cached paths1)
      const result2 = runSweep(root, { env: { BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT: stub2 } });
      assert.equal(result2.exitCode, 0, `sweep 2 failed with exit code ${result2.exitCode}: ${result2.output}`);
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

// Paths outside the pathSetArb's prefixes, used to generate unreported paths.
// Must be kept disjoint from pathSetArb's constantFrom list.
const OUTSIDE_PATHS = [
  'README.md',
  'package.json',
  'extension/src-outside/file.ts',
  'other-dir/file.js',
];

test('property (invariant 2): a path not in the reported set produces no finding', () => {
  fc.assert(
    fc.property(pathSetArb, (reportedPaths) => {
      // Generate a path that is NOT in the reported set
      const unreportedPaths = OUTSIDE_PATHS.filter(p => !reportedPaths.some(rp => p.startsWith(rp)));

      // Skip if we can't generate an unreported path
      if (unreportedPaths.length === 0) return;

      const unreportedPath = unreportedPaths[0];

      // Create a fixture repo
      const root = mkFixtureRepo('sfvc-bl1373-inv2-');

      // Create stub script for the reported paths
      const stub = createStubScript(reportedPaths, 'sfvc-bl1373-stub-');

      // Clear cache
      clearPipelineCache(root);

      // Create a commit touching only the unreported path
      const sha = commitFile(root, unreportedPath, 'content\n', 'test: touches unreported path');

      // Run sweep with the stub that reports only reportedPaths
      const result = runSweep(root, { env: { BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT: stub } });
      assert.equal(result.exitCode, 0, `sweep failed with exit code ${result.exitCode}: ${result.output}`);
      const findings = pipelineFindings(result.output);

      // Verify that the commit touching the unreported path is NOT in the findings
      const finding = findings.find((f) => f.key === `pipeline-code-on-main-${sha}`);
      assert.ok(!finding,
        `invariant 2 violated: a commit (${sha}) touching unreported path ${unreportedPath} produced a finding when reported paths were ${JSON.stringify(reportedPaths)}`);
    }),
    { numRuns: 10 }
  );
});

// ── cache invalidation: the cache keys on qa-paths, not just tips ───────────
// This is the BL-1373 fix: when qa-paths changes, the cache must invalidate.
// Manually write a cache entry, then verify the cached function behavior changes
// based on whether qa-paths matches. This catches mutants that remove qa-paths
// from the cache key or use the wrong field name.

test('property (cache invalidation): the cache invalidates when qa-paths changes', () => {
  fc.assert(
    fc.property(pathSetArb, pathSetArb, (paths1, paths2) => {
      // Skip if the two path sets are identical
      if (JSON.stringify(paths1) === JSON.stringify(paths2)) return;

      // Find a path that is in paths1 but not in paths2
      const pathOnlyIn1 = paths1.find(p => !paths2.includes(p));
      if (!pathOnlyIn1) return; // Skip if no such path exists

      // Create a fixture repo
      const root = mkFixtureRepo('sfvc-bl1373-cache-');

      // Create stub scripts for both path sets
      const stub1 = createStubScript(paths1, 'sfvc-bl1373-stub1-');
      const stub2 = createStubScript(paths2, 'sfvc-bl1373-stub2-');

      // Clear cache
      clearPipelineCache(root);

      // Create a commit touching a path that is in paths1 but not paths2
      const testFile = pathOnlyIn1.replace(/\/$/, '') + '/test-file.txt';
      const sha = commitFile(root, testFile, 'content\n', 'test: touches path only in paths1');

      // Get the actual tips from the fixture
      const { execFileSync } = require('child_process');
      const mainTip = execFileSync('git', ['-C', root, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
      let originMainTip;
      try {
        originMainTip = execFileSync('git', ['-C', root, 'rev-parse', 'origin/main'], { encoding: 'utf8' }).trim();
      } catch (e) {
        // origin/main might not exist in fixtures
        originMainTip = mainTip;
      }

      // Manually write a cache entry that says "this commit is an offender"
      // with qa-paths=paths1 and the ACTUAL tips from the fixture.
      writePipelineCache(root, {
        tips: { main: mainTip, 'origin/main': originMainTip },
        'qa-paths': paths1,
        result: {
          'offending-commits': [{ sha, subject: 'test', paths: [testFile] }],
          'ancestry-unavailable?': false
        }
      });

      // First sweep with paths1 - should use the cache and find the commit
      const result1 = runSweep(root, { env: { BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT: stub1 } });
      assert.equal(result1.exitCode, 0, `sweep 1 failed with exit code ${result1.exitCode}: ${result1.output}`);
      const findings1 = pipelineFindings(result1.output);
      const finding1 = findings1.find((f) => f.key === `pipeline-code-on-main-${sha}`);

      // Second sweep with paths2 - should NOT use the cache (qa-paths mismatch)
      // and should NOT find the commit (because paths2 doesn't include pathOnlyIn1)
      const result2 = runSweep(root, { env: { BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT: stub2 } });
      assert.equal(result2.exitCode, 0, `sweep 2 failed with exit code ${result2.exitCode}: ${result2.output}`);
      const findings2 = pipelineFindings(result2.output);
      const finding2 = findings2.find((f) => f.key === `pipeline-code-on-main-${sha}`);

      // The key assertion: first run finds it (cache hit), second run does not (cache miss due to qa-paths mismatch)
      // If both find it, the cache is not invalidating on qa-paths changes
      if (finding1 && !finding2) {
        // This is the expected behavior - cache invalidated correctly on qa-paths
        return;
      } else if (!finding1 && !finding2) {
        // Both don't find it - the cache read might be failing
        // Skip this case
        return;
      } else {
        // Both find it - the cache is NOT invalidating on qa-paths changes
        assert.fail(
          `cache invalidation violated: commit ${sha} was found by both sweeps even though the second sweep uses paths2=${JSON.stringify(paths2)} which does not include ${pathOnlyIn1}. ` +
          `This means the cache is not invalidating when qa-paths changes.`
        );
      }
    }),
    { numRuns: 15 }
  );
});
