'use strict';

// BL-2049's two declared invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  A runner the selector cannot read, or whose load-file
//                closure it cannot compute, is reported reached, never
//                dropped.
//   invariant 2  The runners reached by several changed paths are
//                exactly the union of the runners each path reaches
//                alone.
//
// Both drive the REAL property_runner_reach.bb, shelled out to against a
// real mkdtemp fixture - the selector reads real files on disk, so a
// mock could not prove either invariant.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fc = require('fast-check');
const { execFileSync } = require('node:child_process');
const { assertReachFloor } = require('./helpers/reachFloors');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const REACH_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'property_runner_reach.bb');

function runReach(scriptsDir, changedPaths) {
  const out = execFileSync('bb', [REACH_CLI, scriptsDir, ...changedPaths], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

function buildFixture() {
  const root = mkTmpDir('bl2049-inv-');
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  const testDir = path.join(scriptsDir, 'test');
  fs.mkdirSync(testDir, { recursive: true });
  return { root, scriptsDir, testDir };
}

// ── invariant 1: fail-open on an unreadable runner ───────────────────────

const INV1_FLOOR = 15;

test('property (BL-2049 invariant 1): a runner that cannot be read is always reported reached, whatever the changed path', () => {
  const coverage = {};
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 12 }).map((s) => s.replace(/[^a-zA-Z0-9]/g, 'x') || 'x'), (suffix) => {
      const cell = 'unreadable-runner';
      coverage[cell] = (coverage[cell] || 0) + 1;
      const fx = buildFixture();
      try {
        const runnerName = 'unreadable_property_runner.bb';
        const runnerPath = path.join(fx.testDir, runnerName);
        fs.writeFileSync(runnerPath, '; a runner this process cannot read\n');
        // A changed path clearly NOT the runner's own path - rule 1 (exact
        // path equality) must not be what makes this pass; the failure has
        // to come from rule 3's own read attempt.
        const otherFile = `other-${suffix}.bb`;
        fs.writeFileSync(path.join(fx.scriptsDir, otherFile), '; unrelated\n');
        fs.chmodSync(runnerPath, 0o000);
        const reached = runReach(fx.scriptsDir, [`swarmforge/scripts/${otherFile}`]);
        assert.ok(
          reached.includes(runnerName),
          `an unreadable runner must still be reported reached (fail-open), got: ${JSON.stringify(reached)}`
        );
        return true;
      } finally {
        fs.chmodSync(path.join(fx.testDir, 'unreadable_property_runner.bb'), 0o644);
        fs.rmSync(fx.root, { recursive: true, force: true });
      }
    }),
    { numRuns: INV1_FLOOR }
  );
  assertReachFloor(coverage, ['unreadable-runner'], INV1_FLOOR, 'BL-2049 invariant 1 cell');
});

// ── invariant 2: reach by several paths is the union of each alone ──────

const INV2_RUNS = 60;
const INV2_FLOOR = 10;

test('property (BL-2049 invariant 2): the runners reached by several changed paths together are exactly the union of what each reaches alone', () => {
  const coverage = {};
  fc.assert(
    fc.property(fc.integer({ min: 2, max: 4 }), (n) => {
      const cell = `n=${n}`;
      coverage[cell] = (coverage[cell] || 0) + 1;
      const fx = buildFixture();
      try {
        // n independent libs, each named ONLY by its own runner's text
        // (rule 3) - no two runners share a reach, so the union is
        // trivially distinguishable from any single path's own reach.
        const libFiles = [];
        const runnerNames = [];
        for (let i = 0; i < n; i += 1) {
          const lib = `lib${i}.bb`;
          const runnerName = `r${i}_property_runner.bb`;
          fs.writeFileSync(path.join(fx.scriptsDir, lib), `; lib ${i}\n`);
          fs.writeFileSync(path.join(fx.testDir, runnerName), `; names ${lib}\n`);
          libFiles.push(lib);
          runnerNames.push(runnerName);
        }
        // One extra runner no path reaches, to prove it stays OUT of the
        // union too (the union property cuts both ways).
        fs.writeFileSync(path.join(fx.testDir, 'unreached_property_runner.bb'), '; reaches nothing here\n');

        const changedPaths = libFiles.map((lib) => `swarmforge/scripts/${lib}`);
        const separateReach = changedPaths.map((p) => new Set(runReach(fx.scriptsDir, [p])));
        const expectedUnion = new Set();
        for (const s of separateReach) {
          for (const r of s) expectedUnion.add(r);
        }
        const together = new Set(runReach(fx.scriptsDir, changedPaths));
        assert.deepEqual(
          [...together].sort(),
          [...expectedUnion].sort(),
          `reach-together must equal the union of each path's own reach (n=${n})`
        );
        assert.ok(!together.has('unreached_property_runner.bb'), 'the untouched runner must never appear in the union');
        return true;
      } finally {
        fs.rmSync(fx.root, { recursive: true, force: true });
      }
    }),
    { numRuns: INV2_RUNS }
  );
  assertReachFloor(coverage, ['n=2', 'n=3', 'n=4'], INV2_FLOOR, 'BL-2049 invariant 2 cell');
});
