'use strict';

// BL-1232: the briefing shift-velocity chart is readable at ordinary velocity.
// Three failures, two of them one root cause - see the ticket. These are the
// unit tests for the three pure pieces; the acceptance drives the whole SVG.

const assert = require('node:assert/strict');
const {
  pickLabelIndicesByPixelGap,
  MIN_DATE_LABEL_GAP_PX,
} = require('../out/metrics/briefingChartSvgCommon');
const {
  nonLinearTimeX,
  hasNonLinearTimeSpacing,
  shiftVelocityAxisPlan,
  buildShiftVelocitySvg,
} = require('../out/metrics/shiftVelocityChart');

const DAY = 86400000;
const PAD_L = 64;
const PLOT_W = 872;

function thirtyDays(valueFor) {
  const end = Date.UTC(2026, 7, 30);
  return {
    windowHours: 8,
    series: Array.from({ length: 30 }, (_, i) => {
      const dayMs = end - (29 - i) * DAY;
      return {
        dayMs,
        label: new Date(dayMs).toISOString().slice(0, 10),
        landedMax: valueFor(i),
      };
    }),
  };
}

describe('BL-1232 label picking is by pixel gap, not by index', () => {
  it('always keeps the most recent point', () => {
    assert.deepEqual(pickLabelIndicesByPixelGap([0, 1, 2], 100), [2]);
  });

  it('accepts only candidates that clear the gap, and returns them in series order', () => {
    // Walking right to left from 400: 90 clears it, 80 does not (10px from 90),
    // 10 clears it (80px from 90), 0 does not. The oldest point is NOT
    // privileged - a label crammed against its neighbour is worth less than the
    // gap it costs, and the newest is the one a reader looks for first.
    assert.deepEqual(pickLabelIndicesByPixelGap([0, 10, 80, 90, 400], 72), [1, 3, 4]);
  });

  it('keeps every point when they are all far apart', () => {
    assert.deepEqual(pickLabelIndicesByPixelGap([0, 100, 200], 72), [0, 1, 2]);
  });

  it('returns nothing for an empty series', () => {
    assert.deepEqual(pickLabelIndicesByPixelGap([], 72), []);
  });

  it('picks a gap wide enough for a rendered YYYY-MM-DD label', () => {
    // 10 chars at font-size 11 monospace is ~66px; the constant must clear it.
    assert.ok(MIN_DATE_LABEL_GAP_PX >= 66, `${MIN_DATE_LABEL_GAP_PX} is narrower than the label it must fit`);
  });
});

describe('BL-1232 the Y axis fits the body of the series', () => {
  it('tracks the ordinary days when one outlier dwarfs them', () => {
    const values = [...Array(29).fill(0).map((_, i) => 5 + (i % 20)), 415];

    const plan = shiftVelocityAxisPlan(values);

    assert.ok(plan.axisMax < 100, `axis ${plan.axisMax} is still set by the outlier`);
    assert.equal(plan.clipped, true);
    assert.deepEqual(plan.clippedIndices, [29]);
  });

  it('covers the true peak and clips nothing when no day is far out', () => {
    const values = [10, 12, 14, 16, 18, 20];

    const plan = shiftVelocityAxisPlan(values);

    assert.ok(plan.axisMax >= 20, `axis ${plan.axisMax} does not cover the peak`);
    assert.equal(plan.clipped, false);
    assert.deepEqual(plan.clippedIndices, []);
  });

  it('stays finite for an all-zero series', () => {
    const plan = shiftVelocityAxisPlan([0, 0, 0]);
    assert.ok(plan.axisMax > 0);
    assert.equal(plan.clipped, false);
  });
});

describe('BL-1232 the time warp is normalized', () => {
  it('no longer lets one hop own most of the plot', () => {
    const end = Date.UTC(2026, 7, 30);
    const xs = Array.from({ length: 30 }, (_, i) =>
      nonLinearTimeX(end - (29 - i) * DAY, end - 29 * DAY, end, PAD_L, PLOT_W)
    );
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);

    assert.ok(Math.max(...gaps) <= PLOT_W / 2, `one hop takes ${Math.max(...gaps)} of ${PLOT_W}px`);
    assert.ok(
      gaps.every((g) => g > 0),
      'the mapping must stay monotonic'
    );
    assert.equal(Math.round(xs[0]), PAD_L, 'the oldest day plots leftmost');
    assert.equal(Math.round(xs[xs.length - 1]), PAD_L + PLOT_W, 'the newest day plots rightmost');
  });

  it('still reports non-linear spacing, which is BL-1184 locked contract', () => {
    const end = Date.UTC(2026, 7, 30);
    const days = Array.from({ length: 30 }, (_, i) => end - (29 - i) * DAY);
    assert.equal(hasNonLinearTimeSpacing(days, days[0], end, PLOT_W), true);
  });

  it('still gives recent days more room than older ones', () => {
    const end = Date.UTC(2026, 7, 30);
    const xs = Array.from({ length: 30 }, (_, i) =>
      nonLinearTimeX(end - (29 - i) * DAY, end - 29 * DAY, end, PAD_L, PLOT_W)
    );
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    assert.ok(gaps[gaps.length - 1] > gaps[0], 'the newest hop must be wider than the oldest');
  });
});

describe('BL-1232 the rendered SVG', () => {
  it('draws a clipped marker carrying the true value of an over-cap day', () => {
    const data = thirtyDays((i) => (i === 12 ? 415 : 5 + (i % 20)));

    const svg = buildShiftVelocitySvg(data);

    assert.match(svg, /<polygon points="/, 'the over-cap day needs a marker distinct from a dot');
    assert.match(svg, />415</, 'the marker must carry the true value as text');
    assert.match(svg, /Peak 415/, 'the subtitle still names the peak');
  });

  it('draws no clipped marker when nothing exceeds the cap', () => {
    const svg = buildShiftVelocitySvg(thirtyDays((i) => 5 + (i % 10)));

    assert.doesNotMatch(svg, /<polygon points="/);
  });

  it('never renders two date labels closer than the minimum gap', () => {
    const svg = buildShiftVelocitySvg(thirtyDays((i) => 5 + (i % 20)));
    const xs = [...svg.matchAll(/<text x="([\d.]+)" y="\d+" text-anchor="middle" font-size="11"[^>]*>(\d{4}-\d{2}-\d{2})</g)].map(
      (m) => Number(m[1])
    );

    assert.ok(xs.length >= 2, `expected several date labels, got ${xs.length}`);
    for (let i = 1; i < xs.length; i += 1) {
      assert.ok(
        xs[i] - xs[i - 1] >= MIN_DATE_LABEL_GAP_PX,
        `labels at ${xs[i - 1]} and ${xs[i]} are ${xs[i] - xs[i - 1]}px apart`
      );
    }
  });

  it('labels the most recent day', () => {
    const data = thirtyDays((i) => 5 + (i % 20));
    const svg = buildShiftVelocitySvg(data);

    assert.ok(svg.includes(`>${data.series[data.series.length - 1].label}<`), 'the newest date must be labelled');
  });
});
