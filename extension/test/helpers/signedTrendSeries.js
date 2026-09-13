'use strict';

// BL-1533 invariant 1: a generator that CHOOSES the sign of a trendable
// series' final delta, the way BL-604's length buckets already choose their
// length, rather than sampling for it. computeTrend (../../out/metrics/trend)
// derives direction from only the LAST two points, so this arbitrary fixes
// those two points to the requested ordering and leaves every earlier point
// free. Exported so the property test's constructed sign runs and the
// BL-1533 step handler's direct sampling (scenario 02) draw from the SAME
// generator, never two restatements of it.

const fc = require('fast-check');

const VALUE_MIN = -50;
const VALUE_MAX = 200;

const FILLER_ARB = fc.integer({ min: VALUE_MIN, max: VALUE_MAX });

function tailArb(sign) {
  if (sign === 'flat') {
    return fc.integer({ min: VALUE_MIN, max: VALUE_MAX }).map((value) => [value, value]);
  }
  if (sign === 'up') {
    return fc
      .integer({ min: VALUE_MIN, max: VALUE_MAX - 1 })
      .chain((prior) => fc.integer({ min: prior + 1, max: VALUE_MAX }).map((current) => [prior, current]));
  }
  if (sign === 'down') {
    return fc
      .integer({ min: VALUE_MIN + 1, max: VALUE_MAX })
      .chain((prior) => fc.integer({ min: VALUE_MIN, max: prior - 1 }).map((current) => [prior, current]));
  }
  throw new Error(`signedTrendSeries: unknown sign "${sign}" (expected up, down, or flat)`);
}

/**
 * A fast-check arbitrary yielding a trendable series (2..8 points, BL-604's
 * TrendSeriesPoint shape) whose final two points give computeTrend the
 * requested direction on every draw.
 */
function signedSeriesArb(sign) {
  return fc.integer({ min: 2, max: 8 }).chain((length) =>
    fc
      .tuple(fc.array(FILLER_ARB, { minLength: length - 2, maxLength: length - 2 }), tailArb(sign))
      .map(([fillers, tail]) =>
        [...fillers, ...tail].map((value, i) => ({
          periodStart: `2026-08-${String(i + 1).padStart(2, '0')}`,
          value,
        }))
      )
  );
}

module.exports = { signedSeriesArb };
