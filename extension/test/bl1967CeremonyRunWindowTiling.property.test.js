'use strict';

// BL-1967's declared invariant (property authorship rests with the coder,
// first pass - BL-654): consecutive ceremony runs record windows that tile
// the timeline - each starts exactly where the previous run's window ended
// and ends at the real instant the run happened, never a synthetic
// midnight. Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { propertyLaneTimeoutMs } = require('./helpers/propertyLaneContentionBudget');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const { runClosingCeremony } = require('../out/metrics/closingCeremonyRun');
const { appendLeanLedgerEventIfNew } = require('../out/metrics/leanLedgerStore');

function mkTmp() {
  return mkTmpDir('sfvc-bl1967-window-tiling-');
}

// A send that never throws, so every generated run lands delivered or
// auto-no-change, never failed - the BL-1528 failed-send shape is this
// invariant's own neighbor, not this property's reach.
function noThrowDeps() {
  return { sendNote: () => {} };
}

function dayInstant(dayOffset) {
  return new Date(Date.UTC(2026, 0, 1 + dayOffset, 4, 25, 0)).toISOString();
}

// Each shape is reached BY CONSTRUCTION, not by a weighted draw: the
// pre-hotfix defect (a synthetic T00:00:00Z) is exactly as able to hide
// behind an all-empty sequence (the auto_no_change path) as an all-non-empty
// one (the pending/created path), so both, plus a genuine mix, each get
// their own dedicated pass rather than competing for a shared random draw.
const SHAPES = {
  allEmpty: (n) => Array.from({ length: n }, () => true),
  allNonEmpty: (n) => Array.from({ length: n }, () => false),
  mixed: (n) => Array.from({ length: n }, (_, i) => i % 2 === 0),
};
const SHAPE_KEYS = Object.keys(SHAPES);
const SHAPE_CELL_RUNS = runsPerCell(30, SHAPE_KEYS.length);

function runSequence(target, isEmptyFlags) {
  const instants = isEmptyFlags.map((_, i) => dayInstant(i));
  const runs = [];
  for (let i = 0; i < isEmptyFlags.length; i += 1) {
    if (!isEmptyFlags[i]) {
      appendLeanLedgerEventIfNew(target, {
        ticket: `BL-${9000 + i}`,
        type: 'stage_transition',
        source: 'stage-dwell',
        at: `${instants[i].slice(0, 10)}T01:00:00.000Z`,
        role: 'coder',
        data: { processingMs: 1000 },
      });
    }
    runs.push(runClosingCeremony(target, instants[i], noThrowDeps()).run);
  }
  return { runs, instants };
}

test(
  'BL-1967 invariant: consecutive ceremony runs tile the timeline - each starts where the previous ended, ends at the real instant, never a synthetic midnight',
  () => {
    const reach = { allEmpty: 0, allNonEmpty: 0, mixed: 0 };

    for (const [shape, buildFlags] of Object.entries(SHAPES)) {
      fc.assert(
        fc.property(fc.integer({ min: 2, max: 6 }), (n) => {
          reach[shape] += 1;
          const target = mkTmp();
          const { runs, instants } = runSequence(target, buildFlags(n));

          assert.equal(runs[0].windowStart, null, 'the first run on record must start from nothing, never a synthetic bound');
          for (let i = 0; i < n; i += 1) {
            assert.equal(runs[i].windowEnd, instants[i], `run ${i}'s window must end at the real instant it ran`);
            if (i > 0) {
              assert.equal(runs[i].windowStart, runs[i - 1].windowEnd, `run ${i} must start exactly where run ${i - 1} ended`);
            }
          }
          return true;
        }),
        { numRuns: SHAPE_CELL_RUNS }
      );
    }

    assertReachFloor(reach, SHAPE_KEYS, SHAPE_CELL_RUNS, 'shape');
  },
  propertyLaneTimeoutMs(20000)
);
