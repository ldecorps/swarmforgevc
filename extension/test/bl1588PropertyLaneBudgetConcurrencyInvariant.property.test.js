'use strict';

// BL-1588's declared invariant (property authorship rests with the coder,
// first pass - BL-654): "A property test that runs alone on a quiet host
// (1-minute load at or under the quiet ceiling, one fork) receives the same
// 20 s budget before and after this change: the budget grows only with
// measured concurrency or load, never by a bare raise."
//
// Pure in-process check of propertyLaneTimeoutMs (BL-1541 shape, same as
// scenario 03's own budget check) - no subprocess, no git fixture, no lane
// spawn: the function under test IS the mechanism the invariant quantifies
// over, and both its inputs (forks, load) are injected via its own DI seams
// (forksFn/loadavg1mFn) rather than sampled from this host, so the drawn
// cases are exactly the states the invariant is about, not a hoped-for
// approximation of them.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { propertyLaneTimeoutMs, QUIET_LOAD_CEILING } = require('./helpers/propertyLaneContentionBudget');

const BASE_MS = 20000;

test('BL-1588/BL-654 invariant: one fork on a quiet host keeps the strict base; the budget never grows without measured concurrency or load', () => {
  // A file run alone (one fork) on a quiet host (load at or under the
  // ceiling) receives EXACTLY the base - the literal invariant, for the
  // whole quiet band, not one sampled point in it.
  fc.assert(
    fc.property(fc.float({ min: 0, max: QUIET_LOAD_CEILING, noNaN: true }), (load) => {
      const ms = propertyLaneTimeoutMs(BASE_MS, {
        forksFn: () => 1,
        loadavg1mFn: () => load,
      });
      assert.equal(ms, BASE_MS, `forks=1, load=${load} (quiet) raised the budget to ${ms}`);
    }),
    { numRuns: 50 },
  );

  // The budget is never BELOW base for any forks/load - "grows only", never
  // a bare lowering either.
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 64 }),
      fc.float({ min: 0, max: 100, noNaN: true }),
      (forks, load) => {
        const ms = propertyLaneTimeoutMs(BASE_MS, {
          forksFn: () => forks,
          loadavg1mFn: () => load,
        });
        assert.ok(ms >= BASE_MS, `forks=${forks}, load=${load} dropped the budget below base: ${ms}`);
      },
    ),
    { numRuns: 100 },
  );

  // Busier than the quiet ceiling STRICTLY raises the budget above base, and
  // MORE forks strictly raises it further - growth tracks the measured
  // concurrency, so a broken implementation that folds forks in as a no-op
  // (a bare raise independent of the input, or none at all) cannot pass
  // this: with a quiet load held fixed, only the forks term can be moving
  // the number at all. The [5, 24] band keeps both sides clear of the
  // absolute ceiling, where the linear step would otherwise clamp and two
  // draws could tie for a reason unrelated to the defect this guards.
  fc.assert(
    fc.property(
      fc.integer({ min: 5, max: 24 }),
      fc.integer({ min: 5, max: 24 }),
      (a, b) => {
        fc.pre(a !== b);
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const loMs = propertyLaneTimeoutMs(BASE_MS, { forksFn: () => lo, loadavg1mFn: () => 1.8 });
        const hiMs = propertyLaneTimeoutMs(BASE_MS, { forksFn: () => hi, loadavg1mFn: () => 1.8 });
        assert.ok(loMs > BASE_MS, `${lo} forks past the quiet ceiling did not raise the budget above base: ${loMs}`);
        assert.ok(hiMs > loMs, `${hi} forks (${hiMs}ms) did not budget more than ${lo} forks (${loMs}ms)`);
      },
    ),
    { numRuns: 50 },
  );
});
