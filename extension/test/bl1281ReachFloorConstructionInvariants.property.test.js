'use strict';

// BL-1281's two declared invariants, coder-authored (BL-654), property lane
// only.
//
// Invariant 1 - "A declared reach floor is met by construction: whether the
// run clears it does not depend on the random seed."
//
//   Quantified over the SEED, because the seed is the whole of what the old
//   scheme left to chance: bl1048's floors are a function of the draw alone,
//   so replaying the draw and the shape-keyed counting is the right
//   instrument and needs no filesystem - which is what makes hundreds of
//   simulated runs affordable here.
//
//   The sensitivity half is DETERMINISTIC, not a second sample. Searching the
//   old sampled scheme for seeds that miss found six inside the first 205
//   (26, 142, 150, 169, 184, 205); those are asserted to miss. A control that
//   was itself a 2.5%-per-seed lottery would be the defect this ticket exists
//   to remove, wearing the costume of its own proof.
//
// Invariant 2 - "Every reach floor declared before this change is still
// declared after it, at the same or a higher value - the floors are
// load-bearing and are never lowered to make a run pass."
//
//   PRE_CHANGE_FLOORS below is the nine numbers as they stood in bl1048
//   before BL-1281, frozen here so the comparison has a fixed reference rather
//   than comparing the shipped list against itself. Drawn over the two ways a
//   floor can be weakened - lowered, and dropped - each exercised by
//   construction rather than by hoping a random mutation hit both.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const {
  SHAPES,
  BL1048_REACH_FLOORS,
  makeTicketArbitraries,
  shapeFloorCoverage,
  weakenedFloors,
} = require('./helpers/bl1048ReachFloors');

// bl1048's fixture has eight roles; only `baseIndex`'s range depends on it and
// neither at-risk floor reads `baseIndex`, so the count is a shape parameter
// here rather than a fact this file must keep in step with roles.tsv.
const { sampledDraw, drawForShape } = makeTicketArbitraries(fc, { roleCount: 8 });

const TOTAL_RUNS = 24;
const CELL_RUNS = runsPerCell(TOTAL_RUNS, SHAPES.length);
const AT_RISK = ['deliveredOnly', 'openedOnly'];

// One whole simulated run of bl1048 under the shipped scheme, counted the way
// bl1048 counts: every ticket of every draw of every cell.
function coverageForSeed(seed) {
  const coverage = { deliveredOnly: 0, openedOnly: 0 };
  SHAPES.forEach((shape, cell) => {
    for (const tickets of fc.sample(drawForShape(shape), { numRuns: CELL_RUNS, seed: seed * SHAPES.length + cell })) {
      const drawn = shapeFloorCoverage(tickets);
      coverage.deliveredOnly += drawn.deliveredOnly;
      coverage.openedOnly += drawn.openedOnly;
    }
  });
  return coverage;
}

// The same run under the OLD scheme: one unpinned array, every shape at p=1/6.
function sampledCoverageForSeed(seed) {
  const coverage = { deliveredOnly: 0, openedOnly: 0 };
  for (const tickets of fc.sample(sampledDraw(), { numRuns: TOTAL_RUNS, seed })) {
    const drawn = shapeFloorCoverage(tickets);
    coverage.deliveredOnly += drawn.deliveredOnly;
    coverage.openedOnly += drawn.openedOnly;
  }
  return coverage;
}

// Seeds on which the OLD scheme misses one of the two at-risk floors, found by
// search and pinned so the sensitivity check is deterministic.
const SEEDS_THE_OLD_SCHEME_MISSED = [26, 142, 150, 169, 184, 205];
const SEED_FLOOR = 200;

describe('BL-1281 invariant 1: the at-risk reach floors do not depend on the seed', () => {
  it('meets both at-risk floors on every drawn seed', () => {
    const coverage = {};
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000000 }), (seed) => {
        coverage.seed = (coverage.seed || 0) + 1;
        const drawn = coverageForSeed(seed);
        for (const value of AT_RISK) {
          assert.ok(
            drawn[value] >= BL1048_REACH_FLOORS[value],
            `seed ${seed}: ${value} reached ${drawn[value]}, floor ${BL1048_REACH_FLOORS[value]} - the floor still depends on the draw`
          );
        }
        return true;
      }),
      { numRuns: SEED_FLOOR }
    );
    assertReachFloor(coverage, ['seed'], SEED_FLOOR, 'seeds replayed');
  });

  it('misses on the seeds the old sampled scheme missed, so the fix is not cosmetic', () => {
    const coverage = {};
    for (const seed of SEEDS_THE_OLD_SCHEME_MISSED) {
      fc.assert(
        fc.property(fc.constant(seed), (drawnSeed) => {
          coverage[drawnSeed] = (coverage[drawnSeed] || 0) + 1;
          const before = sampledCoverageForSeed(drawnSeed);
          const missed = AT_RISK.filter((value) => before[value] < BL1048_REACH_FLOORS[value]);
          assert.notDeepEqual(
            missed,
            [],
            `seed ${drawnSeed} no longer misses under the OLD scheme - the control is stale, so the comparison proves nothing`
          );

          // ...and the shipped scheme clears the same seed.
          const after = coverageForSeed(drawnSeed);
          for (const value of AT_RISK) {
            assert.ok(after[value] >= BL1048_REACH_FLOORS[value], `seed ${drawnSeed}: ${value} still short after the fix`);
          }
          return true;
        }),
        { numRuns: 1 }
      );
    }
    assertReachFloor(coverage, SEEDS_THE_OLD_SCHEME_MISSED, 1, 'old-scheme miss seed');
  });
});

// The nine numbers as bl1048 declared them before BL-1281, frozen.
const PRE_CHANGE_FLOORS = {
  deliveredOnly: 8,
  openedOnly: 8,
  bothStatesSameRole: 4,
  crossRole: 6,
  deliveredNote: 4,
  deliveredBatched: 4,
  deliveredMasterResident: 2,
  noParcel: 4,
  closedButDelivered: 2,
};

const WEAKENINGS = ['lowered', 'dropped'];

describe('BL-1281 invariant 2: no declared floor was lowered or dropped', () => {
  it('still declares all nine, none below the value it had before', () => {
    assert.deepEqual(weakenedFloors(PRE_CHANGE_FLOORS, BL1048_REACH_FLOORS), []);
    assert.equal(Object.keys(BL1048_REACH_FLOORS).length, Object.keys(PRE_CHANGE_FLOORS).length);
  });

  it('catches either way a floor can be weakened, for every declared floor', () => {
    const coverage = {};
    for (const kind of WEAKENINGS) {
      fc.assert(
        fc.property(fc.constantFrom(...Object.keys(PRE_CHANGE_FLOORS)), (value) => {
          coverage[kind] = (coverage[kind] || 0) + 1;
          const mutated = { ...BL1048_REACH_FLOORS };
          if (kind === 'lowered') {
            mutated[value] = PRE_CHANGE_FLOORS[value] - 1;
          } else {
            delete mutated[value];
          }
          const offenders = weakenedFloors(PRE_CHANGE_FLOORS, mutated);
          assert.equal(offenders.length, 1, `a ${kind} ${value} floor was not caught: ${JSON.stringify(offenders)}`);
          assert.ok(offenders[0].startsWith(`${value}:`), `the refusal does not name ${value}: ${offenders[0]}`);
          return true;
        }),
        { numRuns: Object.keys(PRE_CHANGE_FLOORS).length * 2 }
      );
    }
    assertReachFloor(coverage, WEAKENINGS, Object.keys(PRE_CHANGE_FLOORS).length * 2, 'weakening kind');
  });
});
