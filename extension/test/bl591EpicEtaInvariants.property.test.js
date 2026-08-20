'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { estimateEpicEta, childBlocked } = require('../out/metrics/epicEta');

// BL-591 declared invariants (property authorship rests with the coder,
// first pass - BL-654), over the pure estimator with an injected clock.
//
// Invariant 1: every velocity-derived ETA is a RANGE (low strictly below
// high) carrying a non-empty pace assumption naming pack and trailing
// window - no code path emits a single-point date or duration.
//
// Invariant 2: weight from a child that cannot start never contributes to
// any velocity-derived duration - every range is a function of buildable
// weight only. Encoded the strong way: for ANY generated input, appending
// ANY set of blocked children leaves the ranged bounds exactly unchanged
// (and only blockedCount moves). The blocked additions are constructed
// with the HEAVIEST costs, so a leak of blocked weight cannot hide.
//
// Invariant 3: the estimator is total and pure - for every input (zero
// velocity, zero children, empty window, NaN clock included) it returns a
// typed state, never throws, and no NaN or Infinity reaches the feed.
// Degenerate inputs are drawn by construction alongside ordinary ones.
//
// Non-vacuity proven 2026-08-20 against the compiled estimator, each
// break restored by recompile. The estimator guards each invariant at TWO
// layers, so a single-guard break is NOT a broken implementation (verified:
// each single break stays green) - the proven breaks disable BOTH layers:
//   - point-emitting implementation (strict-band widening AND the return's
//     Math.max band both dropped) -> invariant 1 failed on a steady draw
//     ("not a strict band: 14..14");
//   - blocked children folded into the weighted remainder (buildable
//     filter removed) -> invariant 2 failed ("blocked weight leaked into
//     the low bound") - this one is single-layer;
//   - Infinity-leaking implementation (zero-events guard AND the finite()
//     post-division guard both dropped) -> invariant 3 failed ("NaN/
//     Infinity reached the state: {...lowDays:'NaN'...}").

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const costArb = fc.constantFrom('low', 'medium', 'high', undefined);

const buildableChildArb = fc.record({ mutationCost: costArb }, { requiredKeys: [] });

const blockedChildArb = fc.oneof(
  fc.constant({ mutationCost: 'high', held: true }),
  fc.constant({ mutationCost: 'high', statusText: 'blocked' }),
  fc.constant({ mutationCost: 'high', statusText: 'needs_design' }),
  fc.constant({ mutationCost: 'high', blockUntil: ['GH-22'] }),
  fc.constant({ mutationCost: 'high', promotionBlockers: ['awaiting ruling'] })
);

const completionsArb = fc.oneof(
  { arbitrary: fc.constant([]), weight: 1 },
  {
    arbitrary: fc.array(fc.integer({ min: 0, max: 28 * DAY }).map((back) => NOW - back), { minLength: 1, maxLength: 60 }),
    weight: 6,
  }
);

const windowArb = fc.oneof(
  { arbitrary: fc.constant(28 * DAY), weight: 9 },
  { arbitrary: fc.constant(0), weight: 1 },
  { arbitrary: fc.constant(-DAY), weight: 1 },
  { arbitrary: fc.constant(Number.NaN), weight: 1 }
);

const inputArb = fc.record({
  // At least one buildable child in most draws (ranged outputs must be
  // common); the empty/all-blocked degenerate shapes keep their own arm.
  children: fc.oneof(
    { arbitrary: fc.array(fc.oneof(buildableChildArb, blockedChildArb), { maxLength: 8 }), weight: 1 },
    {
      arbitrary: fc
        .tuple(fc.array(buildableChildArb, { minLength: 1, maxLength: 6 }), fc.array(blockedChildArb, { maxLength: 3 }))
        .map(([b, x]) => [...b, ...x]),
      weight: 3,
    }
  ),
  completionsMs: completionsArb,
  nowMs: fc.oneof(
    { arbitrary: fc.constant(NOW), weight: 8 },
    { arbitrary: fc.constantFrom(0, Number.NaN), weight: 1 }
  ),
  windowMs: windowArb,
  packLabel: fc.constantFrom('full-forge', 'mono-router', ''),
});

function assertNoNanOrInfinity(state) {
  const flat = JSON.stringify(state, (_k, v) => (typeof v === 'number' ? String(v) : v));
  assert.ok(!/"(NaN|Infinity|-Infinity)"/.test(flat), `NaN/Infinity reached the state: ${flat}`);
}

test('BL-591 invariants 1+3 (property): every output is a typed state, never a throw, no NaN/Infinity - and every ranged output is a strict band naming pack and window', () => {
  let rangedDraws = 0;
  fc.assert(
    fc.property(inputArb, (input) => {
      const state = estimateEpicEta(input);
      assert.ok(['complete', 'blocked', 'no-recent-pace', 'ranged'].includes(state.kind));
      assertNoNanOrInfinity(state);
      if (state.kind === 'ranged') {
        rangedDraws += 1;
        assert.ok(state.lowDays < state.highDays, `not a strict band: ${state.lowDays}..${state.highDays}`);
        assert.ok(state.lowDays > 0);
        assert.ok(typeof state.paceAssumption === 'string' && state.paceAssumption.length > 0);
        assert.ok(
          state.paceAssumption.includes(input.packLabel || 'unknown-pack'),
          `pace assumption must name the pack: ${state.paceAssumption}`
        );
        assert.ok(/\d+d window/.test(state.paceAssumption), `pace assumption must name the trailing window: ${state.paceAssumption}`);
      }
      return true;
    }),
    { numRuns: 400 }
  );
  assert.ok(rangedDraws >= 40, `ranged outputs must be common by construction, got ${rangedDraws}/400`);
});

test('BL-591 invariant 2 (property): appending ANY blocked children leaves the ranged bounds exactly unchanged', () => {
  let comparedDraws = 0;
  fc.assert(
    fc.property(
      fc.array(buildableChildArb, { minLength: 1, maxLength: 6 }),
      fc.array(blockedChildArb, { minLength: 1, maxLength: 6 }),
      fc.array(fc.integer({ min: 0, max: 28 * DAY }).map((back) => NOW - back), { minLength: 1, maxLength: 60 }),
      (buildable, blockedExtras, completionsMs) => {
        const base = { completionsMs, nowMs: NOW, windowMs: 28 * DAY, packLabel: 'full-forge' };
        const withOut = estimateEpicEta({ ...base, children: buildable });
        const withBlocked = estimateEpicEta({ ...base, children: [...buildable, ...blockedExtras] });
        assert.ok(blockedExtras.every(childBlocked), 'generator sanity: every extra must be blocked');
        if (withOut.kind === 'ranged') {
          comparedDraws += 1;
          assert.equal(withBlocked.kind, 'ranged');
          assert.equal(withBlocked.lowDays, withOut.lowDays, 'blocked weight leaked into the low bound');
          assert.equal(withBlocked.highDays, withOut.highDays, 'blocked weight leaked into the high bound');
          assert.equal(withBlocked.blockedCount, withOut.blockedCount + blockedExtras.length);
        }
        return true;
      }
    ),
    { numRuns: 300 }
  );
  assert.ok(comparedDraws >= 100, `ranged comparisons must be common by construction, got ${comparedDraws}/300`);
});
