'use strict';

// BL-1232's three declared invariants, coder-authored (BL-654), property lane
// only.
//
// Invariant 1 - "No series value is silently dropped or flattened - a value
// above the Y cap renders as a clipped marker carrying its true value."
//
//   The soft cap is the whole risk of this ticket: an axis that fits the body
//   of the series necessarily leaves the outlier off-scale, and the difference
//   between a readable chart and a lying one is whether that day is still
//   visible. So every draw CONSTRUCTS an over-cap day - the outlier is derived
//   from the drawn body, never drawn beside it - and the property reads the
//   rendered SVG for a marker carrying that exact value.
//
// Invariant 2 - "For any series length, no two rendered date labels are
// anchored closer together than the minimum label gap."
//
//   Two properties, because the end-to-end one alone is not enough and saying
//   so is the point. Rendering the real chart over drawn series lengths checks
//   the wiring - and it was measured against the ORIGINAL index-thirds picker
//   and stayed GREEN, because the normalized warp already spaces first/mid/last
//   comfortably. A property that cannot fail against the defect it names proves
//   nothing about it.
//
//   So the load-bearing half quantifies over the PICKER, against CLUSTERED x
//   layouts built to crowd: most points within a few pixels of a neighbour,
//   which is exactly the shape any index-based rule mishandles and the shape
//   the old warp produced. Each draw also checks the index-thirds rule WOULD
//   have violated the gap, so every run is a discriminating case by
//   construction rather than by luck.
//
// Invariant 3 - "The change is presentation-only - every plotted value equals
// the landedMax the series carries, and the time axis stays non-linear."
//
//   Two halves, both checkable: the renderer must not mutate the series it was
//   handed (a deep snapshot compared after), every point's rendered y must map
//   back to its own landedMax, and hasNonLinearTimeSpacing must still hold for
//   long history - BL-1184's locked contract, which "fix the gap by going
//   linear" would quietly break while making every other scenario greener.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { assertReachFloor } = require('./helpers/reachFloors');
const {
  buildShiftVelocitySvg,
  hasNonLinearTimeSpacing,
  shiftVelocityAxisPlan,
} = require('../out/metrics/shiftVelocityChart');
const { MIN_DATE_LABEL_GAP_PX, pickLabelIndicesByPixelGap } = require('../out/metrics/briefingChartSvgCommon');

const DAY_MS = 86400000;
const END = Date.UTC(2026, 7, 30);
const GEOMETRY = { width: 960, padL: 64, padR: 24, padT: 72, padB: 48, height: 420 };
const PLOT_W = GEOMETRY.width - GEOMETRY.padL - GEOMETRY.padR;
const PLOT_H = GEOMETRY.height - GEOMETRY.padT - GEOMETRY.padB;

function series(values) {
  return {
    windowHours: 8,
    series: values.map((landedMax, i) => {
      const dayMs = END - (values.length - 1 - i) * DAY_MS;
      return { dayMs, label: new Date(dayMs).toISOString().slice(0, 10), landedMax };
    }),
  };
}

function dateLabelXs(svg) {
  return [...svg.matchAll(/<text x="([\d.]+)"[^>]*text-anchor="middle"[^>]*>\d{4}-\d{2}-\d{2}</g)]
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

function dotYs(svg) {
  return [...svg.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)"/g)].map((m) => Number(m[1]));
}

// ── invariant 1 ────────────────────────────────────────────────────────────

const OUTLIER_MULTIPLES = [3, 8, 40];
const MULTIPLE_FLOOR = 8;

describe('BL-1232 invariant 1: an over-cap day is clipped, never dropped', () => {
  it('renders a marker carrying the true value, for every constructed outlier', () => {
    const coverage = {};
    // One fc.assert per multiple: the floor is then met by construction rather
    // than by hoping a uniform draw covered all three.
    for (const multiple of OUTLIER_MULTIPLES) {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 5, maxLength: 40 }),
          fc.nat(),
          (body, where) => {
            coverage[multiple] = (coverage[multiple] || 0) + 1;
            // DERIVED from the drawn body, so every draw is an over-cap case by
            // construction - an independently drawn "big number" would land
            // under the cap whenever the body happened to be large.
            const outlier = Math.max(...body, 1) * multiple + 10;
            const values = [...body];
            values[where % values.length] = outlier;

            const plan = shiftVelocityAxisPlan(values);
            const svg = buildShiftVelocitySvg(series(values));

            // The invariant is about VALUES ABOVE THE DRAWN AXIS, not about
            // the cap mechanism firing: niceChartAxisMax rounds the body bound
            // up, and when that rounding happens to cover the outlier there is
            // nothing off-scale and nothing to clip. What must never happen is
            // a value above the axis with no marker carrying it.
            const above = values.map((v, i) => (v > plan.axisMax ? i : -1)).filter((i) => i >= 0);
            assert.deepEqual(above, plan.clippedIndices, 'the plan disagrees with its own axis about what is off-scale');
            for (const i of above) {
              assert.ok(
                new RegExp(`fill="#b4451f"[^>]*>${values[i]}<`).test(svg),
                `the value ${values[i]} is above the axis ${plan.axisMax} and carries no marker text`
              );
            }
            if (above.length > 0) {
              coverage.clipped = (coverage.clipped || 0) + 1;
              assert.match(svg, /<polygon points="/, 'an off-scale day was drawn with no marker');
            } else {
              assert.doesNotMatch(svg, /<polygon points="/, 'a marker was drawn with nothing off-scale');
            }
            return true;
          }
        ),
        { numRuns: MULTIPLE_FLOOR }
      );
    }
    assertReachFloor(coverage, OUTLIER_MULTIPLES, MULTIPLE_FLOOR, 'outlier multiple');
    // ...and the clipping path itself must actually have been exercised, or
    // the loop above proved only that a chart with nothing off-scale draws no
    // markers - true, and not what invariant 1 is about.
    assertReachFloor(coverage, ['clipped'], MULTIPLE_FLOOR, 'draws with an off-scale day');
  });

  it('never draws an ordinary dot above the plot', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 500 }), { minLength: 2, maxLength: 40 }), (values) => {
        const svg = buildShiftVelocitySvg(series(values));
        for (const y of dotYs(svg)) {
          assert.ok(
            y >= GEOMETRY.padT - 0.5 && y <= GEOMETRY.padT + PLOT_H + 0.5,
            `a point is drawn outside the plot at y=${y}`
          );
        }
        return true;
      }),
      { numRuns: 40 }
    );
  });
});

// ── invariant 2 ────────────────────────────────────────────────────────────

const LENGTH_BUCKETS = { tiny: [1, 2], few: [3, 8], long: [20, 60] };
const BUCKET_FLOOR = 10;

// The rule that shipped, kept only as the control invariant 2 is measured
// against: first, middle, last, by index, with no idea where anything plots.
function indexThirds(count) {
  return [0, Math.floor((count - 1) / 2), count - 1].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
}

describe('BL-1232 invariant 2: the picker never anchors two labels inside the gap', () => {
  it('clears the gap on clustered layouts where index-thirds would not', () => {
    const coverage = {};
    fc.assert(
      fc.property(
        fc.integer({ min: 6, max: 60 }),
        fc.integer({ min: 1, max: 20 }),
        (count, clusterPx) => {
          // Built to crowd: all but the newest few points packed into a narrow
          // band, the way the un-normalized warp packed twenty-nine days into
          // the leftmost sixth of the plot.
          const xs = Array.from({ length: count }, (_, i) =>
            i < count - 3 ? i * clusterPx : PLOT_W - (count - 1 - i) * MIN_DATE_LABEL_GAP_PX * 1.5
          );
          const thirds = indexThirds(count);
          const thirdsCrowds = thirds.some((idx, i) => i > 0 && xs[idx] - xs[thirds[i - 1]] < MIN_DATE_LABEL_GAP_PX);
          if (thirdsCrowds) {
            coverage.discriminating = (coverage.discriminating || 0) + 1;
          }

          const picked = pickLabelIndicesByPixelGap(xs, MIN_DATE_LABEL_GAP_PX);

          for (let i = 1; i < picked.length; i += 1) {
            assert.ok(
              Math.abs(xs[picked[i]] - xs[picked[i - 1]]) >= MIN_DATE_LABEL_GAP_PX,
              `picked labels at ${xs[picked[i - 1]]} and ${xs[picked[i]]} are inside the ${MIN_DATE_LABEL_GAP_PX}px gap`
            );
          }
          assert.ok(picked.includes(count - 1), 'the most recent point lost its label');
          assert.deepEqual([...picked].sort((a, b) => a - b), picked, 'indices must come back in series order');
          return true;
        }
      ),
      { numRuns: 120 }
    );
    // If the clustered layouts stopped being ones index-thirds gets wrong, the
    // property above would still pass and would no longer be about anything.
    assertReachFloor(coverage, ['discriminating'], 40, 'layouts index-thirds would crowd');
  });

  it('keeps every rendered pair at least the minimum gap apart', () => {
    const coverage = {};
    for (const [bucket, [min, max]] of Object.entries(LENGTH_BUCKETS)) {
      fc.assert(
        fc.property(
          fc.integer({ min, max }).chain((n) =>
            fc.array(fc.integer({ min: 0, max: 60 }), { minLength: n, maxLength: n })
          ),
          (values) => {
            coverage[bucket] = (coverage[bucket] || 0) + 1;
            const data = series(values);
            const xs = dateLabelXs(buildShiftVelocitySvg(data));

            for (let i = 1; i < xs.length; i += 1) {
              assert.ok(
                xs[i] - xs[i - 1] >= MIN_DATE_LABEL_GAP_PX,
                `${values.length} points: labels ${(xs[i] - xs[i - 1]).toFixed(1)}px apart`
              );
            }
            // ...and the reader's first question is always answered.
            assert.ok(xs.length >= 1, 'no date label at all');
            return true;
          }
        ),
        { numRuns: BUCKET_FLOOR }
      );
    }
    assertReachFloor(coverage, Object.keys(LENGTH_BUCKETS), BUCKET_FLOOR, 'series length bucket');
  });
});

// ── invariant 3 ────────────────────────────────────────────────────────────

describe('BL-1232 invariant 3: the change is presentation-only', () => {
  it('plots each point at its own landedMax and mutates nothing', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 60 }), { minLength: 3, maxLength: 30 }), (values) => {
        const data = series(values);
        const before = JSON.stringify(data);

        const svg = buildShiftVelocitySvg(data);

        assert.equal(JSON.stringify(data), before, 'the renderer mutated the series it was handed');

        // With no outlier in range the axis covers everything, so every point
        // is an ordinary dot and its y must invert to its own value.
        const plan = shiftVelocityAxisPlan(values);
        if (!plan.clipped) {
          const ys = dotYs(svg);
          assert.equal(ys.length, values.length, 'a point went missing from the plot');
          ys.forEach((y, i) => {
            const recovered = ((GEOMETRY.padT + PLOT_H - y) / PLOT_H) * plan.axisMax;
            assert.ok(
              Math.abs(recovered - values[i]) < 0.5,
              `point ${i} plots as ${recovered.toFixed(2)}, not its landedMax ${values[i]}`
            );
          });
        }
        return true;
      }),
      { numRuns: 60 }
    );
  });

  it('keeps the time axis non-linear for long history', () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 60 }), (n) => {
        const days = Array.from({ length: n }, (_, i) => END - (n - 1 - i) * DAY_MS);
        assert.equal(
          hasNonLinearTimeSpacing(days, days[0], days[days.length - 1], PLOT_W),
          true,
          `${n} days of history reported linear spacing - BL-1184's locked contract is broken`
        );
        return true;
      }),
      { numRuns: 40 }
    );
  });
});
