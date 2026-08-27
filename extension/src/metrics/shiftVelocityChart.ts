import { Resvg } from '@resvg/resvg-js';
import { ShiftVelocitySeries } from './shiftVelocity';

// BL-1184: briefing shift-velocity chart — non-linear time axis (recent precision).
export const SHIFT_VELOCITY_DIAGRAM_NAME = 'shift-velocity';
export const SHIFT_VELOCITY_RENDER_WIDTH = 1920;

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function niceMax(value: number): number {
  if (value <= 0) {
    return 5;
  }
  const padded = value * 1.1;
  const mag = Math.pow(10, Math.floor(Math.log10(padded)));
  const norm = padded / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

/**
 * Non-linear x: logarithmic age warp — older days cluster left, recent days
 * spread across more of the plot (greater recent precision).
 */
export function nonLinearTimeX(
  dayMs: number,
  minMs: number,
  maxMs: number,
  padL: number,
  plotW: number
): number {
  const span = Math.max(maxMs - minMs, 1);
  const age = maxMs - dayMs;
  const maxAge = maxMs - minMs;
  const t = Math.log(1 + age) / Math.log(1 + maxAge);
  return padL + (1 - t) * plotW;
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
  const maxY = niceMax(Math.max(...points.map((p) => p.landedMax), 1));

  const xy = (dayMs: number, landedMax: number): [number, number] => {
    const x = nonLinearTimeX(dayMs, minMs, maxMs, padL, plotW);
    const y = padT + plotH - (landedMax / maxY) * plotH;
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
    .map((p) => {
      const [x, y] = xy(p.dayMs, p.landedMax);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="#2a5a4a"/>`;
    })
    .join('\n');

  const labelIdxs = new Set<number>([0, points.length - 1]);
  if (points.length >= 5) {
    labelIdxs.add(Math.floor((points.length - 1) / 2));
  }
  const xLabels = [...labelIdxs]
    .sort((a, b) => a - b)
    .map((i) => {
      const [x] = xy(points[i].dayMs, 0);
      return `<text x="${x.toFixed(1)}" y="${height - 16}" text-anchor="middle" font-size="11" fill="#555" font-family="ui-monospace,Menlo,monospace">${escapeXml(points[i].label)}</text>`;
    })
    .join('\n');

  const peak = Math.max(...points.map((p) => p.landedMax));
  const subtitle = `Peak ${peak} tickets / ${data.windowHours}h stretch · non-linear time (recent detail)`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="#f7f5f0"/>`,
    `<text x="${padL}" y="26" font-size="18" font-weight="700" fill="#1a3a4a" font-family="system-ui,sans-serif">Shift velocity — max tickets landed per ${data.windowHours}h</text>`,
    `<text x="${padL}" y="44" font-size="12" fill="#555" font-family="system-ui,sans-serif">${escapeXml(subtitle)}</text>`,
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
