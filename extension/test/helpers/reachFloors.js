'use strict';

// BL-1062: the shared reach-floor assertion, used by every property test that
// declares one.
//
// A reach floor says "the generator must have exercised this value at least N
// times, or the property proved nothing about it". The floors are load-bearing
// - without them a generator that silently stopped producing a value would
// pass green forever - so BL-1062's remedy was never to drop them, only to
// make the coverage they demand reachable BY CONSTRUCTION rather than sampled.
//
// Extracted here so the acceptance can drive the SAME function the tests use,
// rather than a restatement of it: scenario 02 hands it a coverage map missing
// one value and asserts it fails, naming that value.

/**
 * Throws when any value in `values` was drawn fewer than `floor` times.
 * Pure: a coverage map in, an error or nothing out - no fast-check, no
 * filesystem, no randomness.
 */
function assertReachFloor(coverage, values, floor, label) {
  for (const value of values) {
    const drawn = (coverage && coverage[value]) || 0;
    if (drawn < floor) {
      throw new Error(`reach floor: ${label} ${value} drawn ${drawn} < ${floor}`);
    }
  }
}

/**
 * The number of draws each cell of an iterated space receives, given the total
 * run budget - the constructive alternative to hoping a uniform draw covered
 * the space. Exported so a test states its budget once and derives the rest.
 */
function runsPerCell(totalRuns, cellCount) {
  return Math.max(1, Math.floor(totalRuns / cellCount));
}

module.exports = { assertReachFloor, runsPerCell };
