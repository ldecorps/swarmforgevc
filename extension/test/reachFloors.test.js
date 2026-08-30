'use strict';

// BL-1062: direct unit coverage for the shared reach-floor helpers. Both
// exports were previously only exercised indirectly through the two property
// files that assemble a real fast-check coverage map and let it pass or fail
// - which never independently proved assertReachFloor's own per-value logic
// (message shape, the "missing key defaults to 0" path) or runsPerCell's
// floor behavior, and never called runsPerCell at all: both property files
// hardcode their own RUNS_PER_CELL constant instead of deriving it here.
const assert = require('node:assert/strict');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

test('assertReachFloor passes when every value meets its floor', () => {
  assertReachFloor({ a: 5, b: 5 }, ['a', 'b'], 5, 'class');
});

test('assertReachFloor throws naming the value and the counts when one falls short', () => {
  assert.throws(
    () => assertReachFloor({ a: 5, b: 3 }, ['a', 'b'], 5, 'class'),
    /reach floor: class b drawn 3 < 5/
  );
});

test('assertReachFloor treats a value absent from the coverage map as zero, not as unchecked', () => {
  assert.throws(
    () => assertReachFloor({ a: 5 }, ['a', 'b'], 5, 'class'),
    /reach floor: class b drawn 0 < 5/
  );
});

test('assertReachFloor reports the FIRST short value, not merely that one exists', () => {
  assert.throws(
    () => assertReachFloor({ a: 1, b: 1 }, ['a', 'b'], 5, 'depth'),
    /reach floor: depth a drawn 1 < 5/
  );
});

test('runsPerCell divides the total budget evenly across cells', () => {
  assert.equal(runsPerCell(24, 6), 4);
  assert.equal(runsPerCell(12, 3), 4);
});

test('runsPerCell floors a non-exact division rather than rounding up past budget', () => {
  // 25 / 6 = 4.1(6); rounding up would authorize a total run count the
  // caller's own budget did not actually grant.
  assert.equal(runsPerCell(25, 6), 4);
});

test('runsPerCell never returns fewer than one run per cell, even for a starved budget', () => {
  assert.equal(runsPerCell(2, 6), 1);
  assert.equal(runsPerCell(0, 6), 1);
});
