'use strict';

// BL-1007 declared invariants (coder-authored).
const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  effectiveBudgetMs,
  UNIT_LANE_BUDGET_CEILING_MS,
  resolveUnitLaneTimeout,
  loadNormalizedDurationMs,
  evidenceTestsAreAttributable,
} = require('../../specs/pipeline/steps/lib/contentionBudget');

test('BL-1007 invariant 2: effective budget never exceeds the finite ceiling', () => {
  let reached = 0;
  fc.assert(
    fc.property(fc.integer({ min: 1000, max: 90000 }), fc.double({ min: 1, max: 1e6, noNaN: true }), (base, factor) => {
      reached += 1;
      const e = effectiveBudgetMs(base, factor);
      assert.ok(e <= UNIT_LANE_BUDGET_CEILING_MS);
    }),
    { numRuns: 40 }
  );
  assert.ok(reached >= 20);
});

test('BL-1007 invariant 1: resolveUnitLaneTimeout records factor and effective', () => {
  const d = resolveUnitLaneTimeout(20000, { factor: 2 });
  assert.equal(d.factor, 2);
  assert.equal(d.effectiveMs, 40000);
  assert.equal(d.baseMs, 20000);
});

test('BL-1007 invariant 1: all-null loadNormalizedDurationMs is not attributable after a completed run', () => {
  assert.equal(evidenceTestsAreAttributable([]), false);
  assert.equal(
    evidenceTestsAreAttributable([{ name: 'a', baseMs: 1, effectiveMs: 1, loadNormalizedDurationMs: null }]),
    false
  );
  assert.equal(
    evidenceTestsAreAttributable([{ name: 'a', baseMs: 1, effectiveMs: 1, loadNormalizedDurationMs: 12.5 }]),
    true
  );
});

test('BL-1007 invariant 1: loadNormalizedDurationMs is wall÷max(1,factor)', () => {
  fc.assert(
    fc.property(fc.double({ min: 0, max: 1e5, noNaN: true }), fc.double({ min: 0.01, max: 40, noNaN: true }), (wall, factor) => {
      const n = loadNormalizedDurationMs(wall, factor);
      assert.equal(typeof n, 'number');
      assert.ok(Number.isFinite(n));
      assert.equal(n, wall / Math.max(1, factor));
    }),
    { numRuns: 40 }
  );
});

test('BL-1007 invariant 3: unusable factor leaves the base unchanged', () => {
  assert.equal(effectiveBudgetMs(20000, null), 20000);
  assert.equal(effectiveBudgetMs(20000, 'unusable'), 20000);
  assert.equal(effectiveBudgetMs(20000, 0.25), 20000);
});

test('BL-1007 architect bounce: load-normalized duration is never left null after a timed run', () => {
  const { loadNormalizedDurationMs } = require('../../specs/pipeline/steps/lib/contentionBudget');
  let reached = 0;
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 60000 }),
      fc.oneof(fc.constant(null), fc.constant('unusable'), fc.double({ min: 0.1, max: 10, noNaN: true })),
      (wall, factor) => {
        reached += 1;
        const n = loadNormalizedDurationMs(wall, factor);
        assert.equal(typeof n, 'number');
        assert.ok(Number.isFinite(n));
        assert.notEqual(n, null);
      }
    ),
    { numRuns: 30 }
  );
  assert.ok(reached >= 15);
});

test('BL-1007: load-normalized duration floors the divisor at 1 (quiet factor must not inflate)', () => {
  const { loadNormalizedDurationMs } = require('../../specs/pipeline/steps/lib/contentionBudget');
  let reached = 0;
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 60000 }), fc.double({ min: 0.01, max: 0.99, noNaN: true }), (wall, factor) => {
      reached += 1;
      assert.equal(loadNormalizedDurationMs(wall, factor), wall);
    }),
    { numRuns: 20 }
  );
  assert.ok(reached >= 10);
  assert.equal(loadNormalizedDurationMs(40000, 2), 20000);
});
