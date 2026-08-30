'use strict';

// BL-1232 acceptance: the briefing shift-velocity chart is readable at
// ordinary velocity. Rendering only - the metric and the non-linear time axis
// are BL-1184's locked contracts and this feature must leave them standing.
//
// Every scenario renders the REAL SVG through buildShiftVelocitySvg and reads
// the answer out of the rendered markup, not out of the functions that
// produced it: a chart that computes a correct axis and then draws something
// else is exactly the failure the reader of the briefing sees.

const assert = require('node:assert/strict');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OUT = path.join(REPO_ROOT, 'extension', 'out', 'metrics');
const { buildShiftVelocitySvg, nonLinearTimeX, hasNonLinearTimeSpacing } = require(
  path.join(OUT, 'shiftVelocityChart')
);
const { MIN_DATE_LABEL_GAP_PX } = require(path.join(OUT, 'briefingChartSvgCommon'));

const FEATURE_NAME = 'the briefing shift-velocity chart is readable at ordinary velocity';

const DAY_MS = 86400000;
const DAYS = 30;
// The chart's own geometry, restated here only so the scenarios can talk about
// the plot in pixels. Asserted against the rendered <svg> width below, so a
// change to the chart's layout fails loudly instead of silently making these
// scenarios measure the wrong rectangle.
const GEOMETRY = { width: 960, padL: 64, padR: 24 };
const PLOT_W = GEOMETRY.width - GEOMETRY.padL - GEOMETRY.padR;

// Scenario Outline placeholders, validated against known values.
const SERIES_SHAPES = {
  'ordinary days under thirty and one day at four hundred': (i) => (i === 12 ? 400 : 5 + (i % 20)),
  'no day more than double the busiest ordinary day': (i) => 10 + (i % 10),
};
const AXIS_OUTCOMES = new Set([
  'the axis maximum tracks the ordinary days, not the peak',
  'the axis maximum covers the true peak and no day is clipped',
]);

function seriesOf(valueFor) {
  const end = Date.UTC(2026, 7, 30);
  return {
    windowHours: 8,
    series: Array.from({ length: DAYS }, (_, i) => {
      const dayMs = end - (DAYS - 1 - i) * DAY_MS;
      return { dayMs, label: new Date(dayMs).toISOString().slice(0, 10), landedMax: valueFor(i) };
    }),
  };
}

// The Y axis maximum as DRAWN: the topmost gridline label the renderer emitted.
function renderedAxisMax(svg) {
  const values = [...svg.matchAll(/text-anchor="end" font-size="11"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
  assert.ok(values.length > 0, 'the chart rendered no Y gridline labels');
  return Math.max(...values);
}

function renderedDateLabelXs(svg) {
  return [...svg.matchAll(/<text x="([\d.]+)"[^>]*text-anchor="middle"[^>]*>(\d{4}-\d{2}-\d{2})</g)].map((m) => ({
    x: Number(m[1]),
    label: m[2],
  }));
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  scoped(/^the briefing shift-velocity chart renderer$/, (ctx) => {
    ctx.bl1232 = {};
    assert.equal(typeof buildShiftVelocitySvg, 'function');
  });

  scoped(/^a shift-velocity series spanning thirty days of history$/, (ctx) => {
    // The default body: ordinary days, no outlier. A scenario that needs a
    // different shape replaces it in its own Given.
    ctx.bl1232.data = seriesOf((i) => 5 + (i % 20));
  });

  scoped(/^(ordinary days under thirty and one day at four hundred|no day more than double the busiest ordinary day)$/, (ctx, shape) => {
    const valueFor = SERIES_SHAPES[shape];
    assert.ok(valueFor, `unknown series_shape example value "${shape}"`);
    ctx.bl1232.shape = shape;
    ctx.bl1232.data = seriesOf(valueFor);
  });

  scoped(/^the briefing chart is rendered$/, (ctx) => {
    const svg = buildShiftVelocitySvg(ctx.bl1232.data);
    const width = Number(/<svg[^>]*width="(\d+)"/.exec(svg)[1]);
    assert.equal(width, GEOMETRY.width, 'the chart geometry these scenarios measure against has moved');
    ctx.bl1232.svg = svg;
  });

  // ── 01 ────────────────────────────────────────────────────────────────
  scoped(/^(the axis maximum tracks the ordinary days, not the peak|the axis maximum covers the true peak and no day is clipped)$/, (ctx, outcome) => {
    assert.ok(AXIS_OUTCOMES.has(outcome), `unknown axis_outcome example value "${outcome}"`);
    const svg = ctx.bl1232.svg;
    const axisMax = renderedAxisMax(svg);
    const peak = Math.max(...ctx.bl1232.data.series.map((p) => p.landedMax));
    const body = Math.max(...ctx.bl1232.data.series.map((p) => p.landedMax).filter((v) => v !== peak));

    if (outcome.startsWith('the axis maximum tracks')) {
      assert.ok(axisMax < peak / 2, `the axis is still set by the peak: ${axisMax} against a peak of ${peak}`);
      assert.ok(axisMax >= body, `the axis ${axisMax} does not even cover the ordinary days (${body})`);
    } else {
      assert.ok(axisMax >= peak, `the axis ${axisMax} does not cover the true peak ${peak}`);
      assert.doesNotMatch(svg, /<polygon points="/, 'nothing should be clipped when no day is far out');
    }
  });

  // ── 02 ────────────────────────────────────────────────────────────────
  scoped(/^the peak day is drawn as a clipped marker at the axis cap$/, (ctx) => {
    const svg = ctx.bl1232.svg;
    const marker = /<polygon points="([\d.,\s]+)" fill="#b4451f"\/>/.exec(svg);
    assert.ok(marker, 'the over-cap day is not drawn as a marker distinct from an ordinary dot');
    const ys = marker[1].split(/\s+/).map((pair) => Number(pair.split(',')[1]));
    // The marker sits ON the cap line - never above the plot, which is what
    // "clipped rather than dropped" means geometrically.
    const capY = Math.min(...ys);
    assert.ok(capY > 0, `the marker is drawn off the top of the plot at y=${capY}`);
  });

  scoped(/^that marker carries the peak's true value as text$/, (ctx) => {
    const peak = Math.max(...ctx.bl1232.data.series.map((p) => p.landedMax));
    assert.ok(
      new RegExp(`fill="#b4451f"[^>]*>${peak}<`).test(ctx.bl1232.svg),
      `the clipped marker does not carry its true value ${peak}`
    );
  });

  // ── 03 ────────────────────────────────────────────────────────────────
  scoped(/^every pair of rendered date labels is at least the minimum label gap apart$/, (ctx) => {
    const xs = renderedDateLabelXs(ctx.bl1232.svg).map((l) => l.x).sort((a, b) => a - b);
    assert.ok(xs.length >= 2, `expected several date labels over ${DAYS} days, got ${xs.length}`);
    for (let i = 1; i < xs.length; i += 1) {
      assert.ok(
        xs[i] - xs[i - 1] >= MIN_DATE_LABEL_GAP_PX,
        `two labels are ${(xs[i] - xs[i - 1]).toFixed(1)}px apart, under the ${MIN_DATE_LABEL_GAP_PX}px minimum`
      );
    }
  });

  scoped(/^the most recent day carries a date label$/, (ctx) => {
    const newest = ctx.bl1232.data.series[ctx.bl1232.data.series.length - 1].label;
    assert.ok(
      renderedDateLabelXs(ctx.bl1232.svg).some((l) => l.label === newest),
      `the newest day ${newest} carries no label`
    );
  });

  // ── 04 ────────────────────────────────────────────────────────────────
  scoped(/^the oldest day plots leftmost and the newest day plots rightmost$/, (ctx) => {
    const xs = ctx.bl1232.data.series.map((p) =>
      nonLinearTimeX(
        p.dayMs,
        ctx.bl1232.data.series[0].dayMs,
        ctx.bl1232.data.series[DAYS - 1].dayMs,
        GEOMETRY.padL,
        PLOT_W
      )
    );
    ctx.bl1232.xs = xs;
    assert.equal(Math.round(xs[0]), GEOMETRY.padL);
    assert.equal(Math.round(xs[xs.length - 1]), GEOMETRY.padL + PLOT_W);
  });

  scoped(/^no consecutive pair of days is separated by more than half the plot width$/, (ctx) => {
    const gaps = ctx.bl1232.xs.slice(1).map((x, i) => x - ctx.bl1232.xs[i]);
    const worst = Math.max(...gaps);
    assert.ok(
      worst <= PLOT_W / 2,
      `one day-to-day hop takes ${worst.toFixed(1)}px of a ${PLOT_W}px plot`
    );
    assert.ok(gaps.every((g) => g > 0), 'the time mapping must stay monotonic');
  });

  // ── 05 ────────────────────────────────────────────────────────────────
  scoped(/^the time axis still reports non-linear spacing$/, (ctx) => {
    const days = ctx.bl1232.data.series.map((p) => p.dayMs);
    assert.equal(
      hasNonLinearTimeSpacing(days, days[0], days[days.length - 1], PLOT_W),
      true,
      'BL-1184 locked the axis as non-linear; flattening the warp is not a fix for the gap'
    );
  });

  scoped(/^recent days occupy more width than equally-spaced older days$/, (ctx) => {
    const days = ctx.bl1232.data.series.map((p) => p.dayMs);
    const xs = days.map((d) => nonLinearTimeX(d, days[0], days[days.length - 1], GEOMETRY.padL, PLOT_W));
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    assert.ok(
      gaps[gaps.length - 1] > gaps[0],
      `the newest hop (${gaps[gaps.length - 1].toFixed(1)}px) must be wider than the oldest (${gaps[0].toFixed(1)}px)`
    );
  });
}

module.exports = { registerSteps };
