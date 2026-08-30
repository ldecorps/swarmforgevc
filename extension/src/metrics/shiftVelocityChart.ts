import { Resvg } from '@resvg/resvg-js';
import {
  escapeXmlForSvg,
  niceChartAxisMax,
  pickLabelIndicesByPixelGap,
  MIN_DATE_LABEL_GAP_PX,
} from './briefingChartSvgCommon';
import { ShiftVelocitySeries } from './shiftVelocity';

// BL-1184: briefing shift-velocity chart — non-linear time axis (recent precision).
export const SHIFT_VELOCITY_DIAGRAM_NAME = 'shift-velocity';
export const SHIFT_VELOCITY_RENDER_WIDTH = 1920;

/**
 * How hard the time axis warps. `k` is the whole of the knob: at k → 0 the axis
 * is linear, and the larger k is the more of the plot the recent end takes.
 * 9 gives the newest day-to-day hop roughly a quarter of a thirty-day plot -
 * visibly more room than an old one, and nowhere near owning the chart.
 */
export const TIME_WARP_K = 9;

/**
 * Non-linear x: logarithmic age warp — older days cluster left, recent days
 * spread across more of the plot (greater recent precision).
 *
 * BL-1232: the warp is applied to age RELATIVE TO THE SPAN, not to raw
 * milliseconds. `log(1 + ageMs) / log(1 + maxAgeMs)` looks normalized because
 * it divides by the span, but the division happens OUTSIDE the log, so the
 * curve's shape depends on the units age is measured in. Over a thirty-day
 * series that put the one-day-old point at 16% of the plot width and today at
 * 100%: one hop consumed 84% of the chart and the other twenty-nine days were
 * packed into the leftmost sixth. That is BL-1232's failures 2 and 3, both of
 * them, from this one line.
 *
 * Normalizing age into 0..1 first makes the warp a property of the shape of the
 * series rather than of the clock's units. Oldest still plots leftmost, newest
 * rightmost, the mapping stays monotonic, and `hasNonLinearTimeSpacing` still
 * reports true - BL-1184's locked contract is that the axis is non-linear, not
 * that it is violent.
 */
export function nonLinearTimeX(
  dayMs: number,
  minMs: number,
  maxMs: number,
  padL: number,
  plotW: number
): number {
  const age = maxMs - dayMs;
  // Floor at 1 so a single-day series (minMs === maxMs) stays finite.
  const maxAge = Math.max(maxMs - minMs, 1);
  const normalizedAge = Math.min(Math.max(age / maxAge, 0), 1);
  const t = Math.log(1 + TIME_WARP_K * normalizedAge) / Math.log(1 + TIME_WARP_K);
  return padL + (1 - t) * plotW;
}

/** A value's position in the sorted series, 0..1. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

export interface ShiftVelocityAxisPlan {
  /** The Y axis maximum actually drawn. */
  axisMax: number;
  /** True when at least one value sits above `axisMax` and is drawn clipped. */
  clipped: boolean;
  /** Indices of the values drawn as clipped markers on the cap line. */
  clippedIndices: number[];
}

/**
 * BL-1232: how tall to draw the Y axis, given the series.
 *
 * A single outlier used to set the axis for everyone: one ~415 day forced a
 * 0-500 axis and left ordinary sub-30 days as a flat line on the floor, so the
 * chart's subtitle promised "recent detail" and the plot delivered none.
 *
 * The body bound is robust rather than extreme - the 90th percentile, doubled -
 * so it tracks how busy an ordinary day is and one freak day cannot drag it.
 * A peak that does NOT materially exceed that bound changes nothing: the axis
 * covers the true peak exactly as before, and nothing is clipped or marked. It
 * is only the genuinely off-scale day that gets pinned to the cap, and it is
 * never silently flattened - the caller draws it as a distinct marker carrying
 * its true value (invariant 1).
 */
export function shiftVelocityAxisPlan(values: readonly number[]): ShiftVelocityAxisPlan {
  const peak = Math.max(...values, 1);
  const sorted = [...values].sort((a, b) => a - b);
  // Two robust bounds, whichever is larger. The median times three is what
  // survives a single freak day - a high percentile alone does NOT, because on
  // a short series the 90th percentile IS the outlier and the cap then tracks
  // the very value it exists to contain (found by the invariant-1 property, on
  // its first run, at a five-day series). The 75th percentile doubled is what
  // survives the opposite shape: a genuinely bimodal week, where half the days
  // really are busy and clipping them all would be the misreading.
  const body = Math.max(percentile(sorted, 0.5) * 3, percentile(sorted, 0.75) * 2, 1);
  if (peak <= body) {
    return { axisMax: niceChartAxisMax(peak, 5), clipped: false, clippedIndices: [] };
  }
  const axisMax = niceChartAxisMax(body, 5);
  const clippedIndices = values.map((v, i) => (v > axisMax ? i : -1)).filter((i) => i >= 0);
  return { axisMax, clipped: clippedIndices.length > 0, clippedIndices };
}

/** True when consecutive point spacing is materially unequal (not linear equal-day). */
export function hasNonLinearTimeSpacing(dayMsList: number[], minMs: number, maxMs: number, plotW: number): boolean {
  if (dayMsList.length < 3) {
    return false;
  }
  const padL = 0;
  const xs = dayMsList.map((d) => nonLinearTimeX(d, minMs, maxMs, padL, plotW));
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  const first = gaps[0];
  const last = gaps[gaps.length - 1];
  return Math.abs(last - first) > plotW * 0.02;
}

export function buildShiftVelocitySvg(data: ShiftVelocitySeries): string {
  const width = 960;
  const height = 420;
  const padL = 64;
  const padR = 24;
  const padT = 72;
  const padB = 48;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const points = data.series;
  if (points.length === 0) {
    throw new Error('shift-velocity series is empty');
  }
  const minMs = points[0].dayMs;
  const maxMs = points[points.length - 1].dayMs;
  const axis = shiftVelocityAxisPlan(points.map((p) => p.landedMax));
  const maxY = axis.axisMax;
  const clipped = new Set(axis.clippedIndices);

  // A clipped day is drawn ON the cap line, never above the plot: the marker
  // and its printed value are what keep it findable (invariant 1), and letting
  // the polyline run off the top would be the silent flattening this forbids.
  const xy = (dayMs: number, landedMax: number): [number, number] => {
    const x = nonLinearTimeX(dayMs, minMs, maxMs, padL, plotW);
    const y = padT + plotH - (Math.min(landedMax, maxY) / maxY) * plotH;
    return [x, y];
  };

  const gridSteps = 5;
  const gridLines: string[] = [];
  for (let i = 0; i <= gridSteps; i++) {
    const v = (maxY / gridSteps) * i;
    const y = padT + plotH - (v / maxY) * plotH;
    gridLines.push(
      `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" stroke="#d8d2c8" stroke-width="1"/>` +
        `<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#666" font-family="ui-monospace,Menlo,monospace">${Math.round(v)}</text>`
    );
  }

  const poly = points
    .map((p) => {
      const [x, y] = xy(p.dayMs, p.landedMax);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const dots = points
    .map((p, i) => {
      const [x, y] = xy(p.dayMs, p.landedMax);
      if (!clipped.has(i)) {
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="#2a5a4a"/>`;
      }
      // A distinct marker, not a bigger dot: an over-cap day must not read as
      // an ordinary one that happened to be busy.
      const half = 5.2;
      const tri = `${x.toFixed(1)},${(y - half).toFixed(1)} ${(x - half).toFixed(1)},${(y + half * 0.7).toFixed(1)} ${(x + half).toFixed(1)},${(y + half * 0.7).toFixed(1)}`;
      return (
        `<polygon points="${tri}" fill="#b4451f"/>` +
        `<text x="${x.toFixed(1)}" y="${(y - half - 5).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="#b4451f" font-family="ui-monospace,Menlo,monospace">${p.landedMax}</text>`
      );
    })
    .join('\n');

  // BL-1232: picked by where the points actually PLOT, through the shared
  // picker, never by index thirds - under a warped axis "first, middle, last"
  // can be three labels within a few pixels of each other.
  const labelIdxs = pickLabelIndicesByPixelGap(
    points.map((p) => nonLinearTimeX(p.dayMs, minMs, maxMs, padL, plotW)),
    MIN_DATE_LABEL_GAP_PX
  );
  const xLabels = labelIdxs
    .map((i) => {
      const [x] = xy(points[i].dayMs, 0);
      return `<text x="${x.toFixed(1)}" y="${height - 16}" text-anchor="middle" font-size="11" fill="#555" font-family="ui-monospace,Menlo,monospace">${escapeXmlForSvg(points[i].label)}</text>`;
    })
    .join('\n');

  const peak = Math.max(...points.map((p) => p.landedMax));
  const subtitle = `Peak ${peak} tickets / ${data.windowHours}h stretch · non-linear time (recent detail)`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="#f7f5f0"/>`,
    `<text x="${padL}" y="26" font-size="18" font-weight="700" fill="#1a3a4a" font-family="system-ui,sans-serif">Shift velocity — max tickets landed per ${data.windowHours}h</text>`,
    `<text x="${padL}" y="44" font-size="12" fill="#555" font-family="system-ui,sans-serif">${escapeXmlForSvg(subtitle)}</text>`,
    ...gridLines,
    `<polyline fill="none" stroke="#2a5a4a" stroke-width="2.6" points="${poly}"/>`,
    dots,
    xLabels,
    `</svg>`,
  ].join('\n');
}

export function renderShiftVelocityPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: SHIFT_VELOCITY_RENDER_WIDTH },
    background: 'white',
  });
  return resvg.render().asPng();
}
