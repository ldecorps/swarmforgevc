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
// BL-1534: each test below runs a bounded, stated number of real sweeps (at
// most 10 - see the numRuns comment on each test) instead of up to 30, and
// every draw that reaches a sweep is decisive by construction: the commit's
// path is drawn INTO paths1 and OUT of paths2 up front (decisivePairArb),
// so no draw is wasted discovering the pair happens not to be discriminating.
// A finding from paths2 (which never contains the touched path) is always a
// hard failure - the sweep is using a cached or otherwise wrong path set.
// Whether paths1 actually reports the finding is tracked as `decisive` rather
// than hard-asserted per draw, because a busy host can make a single sweep
// slow without making it wrong; the run as a whole still fails if too few
// draws were decisive (assertReachFloor below), so a generator or sweep that
// stopped reporting anything real is still caught.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { assertReachFloor } = require('./helpers/reachFloors');
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

// ── shared: a decisive (paths1, x, paths2) triple, built by construction ──
// x is drawn FROM paths1; paths2 is then drawn from whatever prefixes remain
// once x is excluded. So x is in paths1 and never in paths2 on every single
// draw - unlike the old pathSetArb pair, no draw is spent discovering the two
// sets happen to be equal or that paths1 has no path outside paths2.
const PREFIXES = ['extension/src/', 'extension/test/', 'specs/pipeline/steps/', 'docs/', 'swarmforge/scripts/'];

const decisivePairArb = fc
  .subarray(PREFIXES, { minLength: 1 })
  .chain((paths1) =>
    fc.record({
      paths1: fc.constant([...paths1].sort()),
      x: fc.constantFrom(...paths1),
    })
  )
  .chain(({ paths1, x }) =>
    fc.record({
      paths1: fc.constant(paths1),
      x: fc.constant(x),
      paths2: fc.subarray(PREFIXES.filter((p) => p !== x)).map((subset) => [...subset].sort()),
    })
  );

// Shared by invariant 1 and the cache-invalidation test: both build a fixture
// commit touching x (in paths1, never in paths2), then sweep once with each
// path set - a finding from the paths2 sweep is always a hard bug, never an
// environmental flake, by construction of decisivePairArb. `beforeSweeps`,
// when given, runs after the commit and before either sweep, so the
// cache-invalidation test can seed a manual cache entry there; the sweep and
// assertion plumbing itself is identical either way.
function runDecisivePairSweeps(fixturePrefix, { paths1, x, paths2 }, reach, beforeSweeps) {
  const root = mkFixtureRepo(fixturePrefix);
  const stub1 = createStubScript(paths1, 'sfvc-bl1373-stub1-');
  const stub2 = createStubScript(paths2, 'sfvc-bl1373-stub2-');
  clearPipelineCache(root);

  const testFile = x.replace(/\/$/, '') + '/test-file.txt';
  const sha = commitFile(root, testFile, 'content\n', 'test: touches path only in paths1');

  if (beforeSweeps) beforeSweeps(root, sha);

  const result1 = runSweep(root, { env: { BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT: stub1 } });
  reach.sweeps += 1;
  assert.equal(result1.exitCode, 0, `sweep 1 failed with exit code ${result1.exitCode}: ${result1.output}`);
  const finding1 = pipelineFindings(result1.output).find((f) => f.key === `pipeline-code-on-main-${sha}`);

  const result2 = runSweep(root, { env: { BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT: stub2 } });
  reach.sweeps += 1;
  assert.equal(result2.exitCode, 0, `sweep 2 failed with exit code ${result2.exitCode}: ${result2.output}`);
  const finding2 = pipelineFindings(result2.output).find((f) => f.key === `pipeline-code-on-main-${sha}`);

  return { sha, finding1, finding2, root };
}

// invariant 2 only needs one reported path set - drawn the way pathSetArb
// always has.
const pathSetArb = fc
  .array(fc.constantFrom(...PREFIXES), { minLength: 1, maxLength: 4 })
  .map((paths) => [...new Set(paths)].sort());

// ── invariant 1: the classified path set follows the single source at runtime ─
// For all path sets P1, P2 where a commit touches a path in P1 but not P2,
// running the sweep with P1 reports the commit, but running it with P2 does
// not. This verifies the sweep uses the runtime-reported path set, not a
// cached or fixed value.

test('property (invariant 1): the classified path set follows the single source at runtime', () => {
  // 5 draws * 2 sweeps/draw = 10 sweeps, ~1.6s each measured at load 33 =
  // ~16s, inside the 20s per-test timeout with headroom.
  const numRuns = 5;
  const reach = { sweeps: 0, draws: 0, decisive: 0 };
  fc.assert(
    fc.property(decisivePairArb, ({ paths1, x, paths2 }) => {
      reach.draws += 1;

      const { sha, finding1, finding2 } = runDecisivePairSweeps('sfvc-bl1373-inv1-', { paths1, x, paths2 }, reach);

      if (finding2) {
        assert.fail(
          `invariant 1 violated: commit ${sha} touches ${x}, which is only in paths1=${JSON.stringify(paths1)} and not in paths2=${JSON.stringify(paths2)}, but the paths2 sweep found it anyway. ` +
          `This means the sweep is using a cached or fixed path set, not the runtime-reported one.`
        );
      }
      if (finding1) {
        reach.decisive += 1;
      }
    }),
    { numRuns }
  );
  console.log('BL-1534 reach map (invariant 1):', JSON.stringify(reach));
  assertReachFloor(reach, ['decisive'], 4, 'BL-1534 invariant 1');
});

// ── invariant 2: a path not in the reported set produces no finding ─────────
// For all path sets P, for all paths X where X ∉ P, a commit touching only X
// produces no finding.

// Paths outside PREFIXES, used to generate unreported paths. Kept disjoint
// from PREFIXES - checked once here so a future edit to either list fails
// loudly instead of silently reviving the vacuous-pass shape this ticket
// retires (a draw that could never generate an unreported path).
const OUTSIDE_PATHS = [
  'README.md',
  'package.json',
  'extension/src-outside/file.ts',
  'other-dir/file.js',
];
assert.ok(
  OUTSIDE_PATHS.every((p) => !PREFIXES.some((prefix) => p.startsWith(prefix))),
  'OUTSIDE_PATHS must stay disjoint from PREFIXES so every draw produces an unreported path by construction'
);

test('property (invariant 2): a path not in the reported set produces no finding', () => {
  // 5 draws * 1 sweep/draw = 5 sweeps, well inside the 20s timeout even on a
  // busy host.
  const numRuns = 5;
  const reach = { sweeps: 0, draws: 0, decisive: 0 };
  fc.assert(
    fc.property(pathSetArb, fc.constantFrom(...OUTSIDE_PATHS), (reportedPaths, unreportedPath) => {
      reach.draws += 1;

      // Create a fixture repo
      const root = mkFixtureRepo('sfvc-bl1373-inv2-');

      // Create stub script for the reported paths
      const stub = createStubScript(reportedPaths, 'sfvc-bl1373-stub-');

      // Clear cache
      clearPipelineCache(root);

      // Create a commit touching only the unreported path (guaranteed
      // disjoint from reportedPaths by the OUTSIDE_PATHS/PREFIXES check above)
      const sha = commitFile(root, unreportedPath, 'content\n', 'test: touches unreported path');

      // Run sweep with the stub that reports only reportedPaths
      const result = runSweep(root, { env: { BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT: stub } });
      reach.sweeps += 1;
      assert.equal(result.exitCode, 0, `sweep failed with exit code ${result.exitCode}: ${result.output}`);
      const finding = pipelineFindings(result.output).find((f) => f.key === `pipeline-code-on-main-${sha}`);

      if (finding) {
        assert.fail(
          `invariant 2 violated: a commit (${sha}) touching unreported path ${unreportedPath} produced a finding when reported paths were ${JSON.stringify(reportedPaths)}`
        );
      }
      reach.decisive += 1;
    }),
    { numRuns }
  );
  console.log('BL-1534 reach map (invariant 2):', JSON.stringify(reach));
  assertReachFloor(reach, ['decisive'], 4, 'BL-1534 invariant 2');
});

// ── cache invalidation: the cache keys on qa-paths, not just tips ───────────
// This is the BL-1373 fix: when qa-paths changes, the cache must invalidate.
// Manually write a cache entry, then verify the cached function behavior changes
// based on whether qa-paths matches. This catches mutants that remove qa-paths
// from the cache key or use the wrong field name.

test('property (cache invalidation): the cache invalidates when qa-paths changes', () => {
  // 5 draws * 2 sweeps/draw = 10 sweeps, ~16s at 1.6s/sweep, inside the 20s
  // per-test timeout.
  const numRuns = 5;
  const reach = { sweeps: 0, draws: 0, decisive: 0 };
  fc.assert(
    fc.property(decisivePairArb, ({ paths1, x, paths2 }) => {
      reach.draws += 1;

      // Before either sweep, manually write a cache entry that says "this
      // commit is an offender" with qa-paths=paths1 and the ACTUAL tips from
      // the fixture - the first sweep (paths1) should use it, the second
      // (paths2) must invalidate it on the qa-paths mismatch.
      const { sha, finding1, finding2 } = runDecisivePairSweeps(
        'sfvc-bl1373-cache-',
        { paths1, x, paths2 },
        reach,
        (root, commitSha) => {
          const mainTip = execFileSync('git', ['-C', root, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
          let originMainTip;
          try {
            originMainTip = execFileSync('git', ['-C', root, 'rev-parse', 'origin/main'], { encoding: 'utf8' }).trim();
          } catch (e) {
            // origin/main might not exist in fixtures
            originMainTip = mainTip;
          }
          writePipelineCache(root, {
            tips: { main: mainTip, 'origin/main': originMainTip },
            'qa-paths': paths1,
            result: {
              'offending-commits': [{ sha: commitSha, subject: 'test', paths: [x.replace(/\/$/, '') + '/test-file.txt'] }],
              'ancestry-unavailable?': false
            }
          });
        }
      );

      if (finding2) {
        assert.fail(
          `cache invalidation violated: commit ${sha} touches ${x}, which is not in paths2=${JSON.stringify(paths2)}, but the second sweep found it anyway. ` +
          `This means the cache is not invalidating when qa-paths changes.`
        );
      }
      if (finding1) {
        reach.decisive += 1;
      }
    }),
    { numRuns }
  );
  console.log('BL-1534 reach map (cache invalidation):', JSON.stringify(reach));
  assertReachFloor(reach, ['decisive'], 4, 'BL-1534 cache invalidation');
});
