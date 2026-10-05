'use strict';

// BL-1983's declared invariant (coder-authored per BL-654): "A run measured
// below the load threshold gets exactly BL-1599's verdict and exit code."
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Encoded against decideSuiteWorkExit, the one pure function BL-1983 added:
// below the threshold (half the host's logical cores), its exit code must
// equal BL-1599's own rule (over-budget -> 1, else 0) and unmeasuredUnderLoad
// must be false - never just for the ticket's four worked examples, for
// EVERY verdict and EVERY (cores, load) pair below the line. A second
// property covers the complementary half: at or above the threshold, only
// an over-budget verdict is ever marked, and the exit code is always 0.
//
// GENERATOR REACH is constructed, not hoped for: cores is drawn from a
// small pool so "half the cores" lands on both whole and fractional
// thresholds, the below/at/above regions are each reached by an explicit
// offset from that threshold (never a wide random draw hoping to land near
// a boundary), and every verdict is paired with every region via a nested
// loop rather than a single combined random draw, so a verdict this
// property forgets to pair with the boundary region can never hide behind
// the other verdicts' coverage.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { propertyLaneTimeoutMs } = require('./helpers/propertyLaneContentionBudget');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const { decideSuiteWorkExit, isUnderHostLoad } = require('../out/tools/check-suite-duration-budget');

const VERDICTS = ['ok', 'over-tolerance', 'over-budget'];
const CORE_POOL = [1, 2, 7, 8, 20, 64];

const REGIONS = {
  // Half an epsilon below the threshold - never exactly on it, so this
  // region can never accidentally land "at or above" on a float rounding.
  below: (cores) => cores / 2 - 0.01,
  atBoundary: (cores) => cores / 2,
  above: (cores) => cores / 2 + 5,
};
const REGION_KEYS = Object.keys(REGIONS);
const CELL_RUNS = runsPerCell(60, REGION_KEYS.length * VERDICTS.length);

test(
  "BL-1983 invariant: below the load threshold, decideSuiteWorkExit's exit code and mark are exactly BL-1599's own, whatever the verdict",
  () => {
    const reach = {};
    for (const region of REGION_KEYS) {
      for (const verdict of VERDICTS) {
        reach[`${region}:${verdict}`] = 0;
      }
    }

    for (const region of REGION_KEYS) {
      for (const verdict of VERDICTS) {
        fc.assert(
          fc.property(fc.constantFrom(...CORE_POOL), (cores) => {
            reach[`${region}:${verdict}`] += 1;
            const load = REGIONS[region](cores);
            const underLoad = isUnderHostLoad(load, cores);
            const decision = decideSuiteWorkExit(verdict, load, cores);

            if (region === 'below') {
              assert.equal(underLoad, false, `region "below" drew a load that reads as under load: load=${load} cores=${cores}`);
              const bl1599ExitCode = verdict === 'over-budget' ? 1 : 0;
              assert.equal(decision.exitCode, bl1599ExitCode, `below threshold: expected BL-1599's own exit code ${bl1599ExitCode} for verdict ${verdict}, got ${decision.exitCode}`);
              assert.equal(decision.unmeasuredUnderLoad, false, 'below threshold: must never be marked');
            } else {
              // atBoundary and above both read as under load (>=).
              assert.equal(underLoad, true, `region "${region}" did not read as under load: load=${load} cores=${cores}`);
              assert.equal(decision.exitCode, 0, `at or above threshold: exit code must always be 0 (never refused), got ${decision.exitCode}`);
              const shouldMark = verdict === 'over-budget';
              assert.equal(decision.unmeasuredUnderLoad, shouldMark, `at or above threshold: unmeasuredUnderLoad must be ${shouldMark} for verdict ${verdict}`);
            }
            return true;
          }),
          { numRuns: CELL_RUNS }
        );
      }
    }

    assertReachFloor(reach, Object.keys(reach), CELL_RUNS, 'region:verdict');
  },
  propertyLaneTimeoutMs(10000)
);
