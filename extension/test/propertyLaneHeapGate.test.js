'use strict';

const assert = require('node:assert/strict');
const { heapCeilingVerdict } = require('../out/tools/property-lane-heap-gate');

// BL-1651: plain unit coverage for heapCeilingVerdict's own decision table -
// the property test (bl1651PropertyLaneHeapCeilingInvariants.property.test.js)
// generalizes this over many inputs but runs only via `npm run test:properties`
// and never feeds the unit/coverage/mutation lanes (engineering.prompt: keep
// property tests separate from normal verification). Fixed-example coverage
// here so the function's own file has a real killing test in the lane the
// hardener's mutation pass actually reads.

test('below the ceiling: not exceeded', () => {
  const verdict = heapCeilingVerdict(100, 200);
  assert.equal(verdict.exceeded, false);
  assert.equal(verdict.message, undefined);
});

test('exactly at the ceiling: not exceeded (<=, not <)', () => {
  const verdict = heapCeilingVerdict(200, 200);
  assert.equal(verdict.exceeded, false);
});

test('above the ceiling: exceeded, with a named message carrying both numbers', () => {
  const verdict = heapCeilingVerdict(250.4, 200);
  assert.equal(verdict.exceeded, true);
  assert.match(verdict.message, /PROPERTY_LANE_HEAP_CEILING_EXCEEDED/);
  assert.match(verdict.message, /250\.4MB/);
  assert.match(verdict.message, /200MB/);
});

test('ceiling <= 0 (unconfigured): never exceeded regardless of heap used', () => {
  assert.equal(heapCeilingVerdict(999999, 0).exceeded, false);
  assert.equal(heapCeilingVerdict(999999, -1).exceeded, false);
});

test('non-finite ceiling (NaN): never exceeded', () => {
  assert.equal(heapCeilingVerdict(999999, NaN).exceeded, false);
});

test('non-finite heapUsedMB: never exceeded', () => {
  assert.equal(heapCeilingVerdict(NaN, 200).exceeded, false);
  assert.equal(heapCeilingVerdict(Infinity, 200).exceeded, false);
});
