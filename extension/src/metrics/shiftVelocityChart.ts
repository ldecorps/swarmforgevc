import { Resvg } from '@resvg/resvg-js';
import { ShiftVelocityDayPoint } from './shiftVelocity';

export const SHIFT_VELOCITY_DIAGRAM_NAME = 'shift-velocity';
export const SHIFT_VELOCITY_RENDER_WIDTH = 1920;

export interface ShiftVelocityChartSeries {
  points: ShiftVelocityDayPoint[];
  windowDays: number;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function niceMax(value: number): number {
  if (value <= 0) {
    return 5;
  }
  const padded = value * 1.1;
  const mag = 10 ** Math.floor(Math.log10(padded));
  const norm = padded / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

/** Pure: recent calendar days occupy more horizontal space than older ones. */
export function nonLinearTimePositions(count: number): number[] {
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [1];
  }
  const weights = Array.from({ length: count }, (_, index) => (index + 1) ** 2);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cumulative = 0;
  return weights.map((weight) => {
    cumulative += weight / total;
    return cumulative;
  });
}

export function recentAxisHasFinerPrecision(positions: number[]): boolean {
  if (positions.length < 3) {
    return false;
  }
  const gaps = positions.slice(1).map((pos, index) => pos - positions[index]);
  return gaps[gaps.length - 1] > gaps[0] * 1.2;
}

export function axisIsNonLinearEqualSpacing(positions: number[]): boolean {
  if (positions.length < 3) {
    return false;
  }
  const gaps = positions.slice(1).map((pos, index) => pos - positions[index]);
  const first = gaps[0];
  return gaps.every((gap) => Math.abs(gap - first) <= first * 0.05);
}

export function buildShiftVelocitySvg(data: ShiftVelocityChartSeries): string {
  const width = 960;
  const height = 420;
  const padL = 64;
  const padR = 24;
  const padT = 72;
  const padB = 48;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const points = data.points;
  const maxY = niceMax(Math.max(...points.map((point) => point.landedMax), 1));
  const xPositions = nonLinearTimePositions(points.length);

  const xy = (index: number, landedMax: number): [number, number] => {
    const x = padL + (index === 0 ? 0 : xPositions[index - 1]) * plotW;
    const y = padT + plotH - (landedMax / maxY) * plotH;
    return [x, y];
  };

  const gridSteps = 5;
  const gridLines: string[] = [];
  for (let step = 0; step <= gridSteps; step += 1) {
    const value = (maxY / gridSteps) * step;
    const y = padT + plotH - (value / maxY) * plotH;
    gridLines.push(
      `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" stroke="#d8d2c8" stroke-width="1"/>` +
        `<text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#666" font-family="ui-monospace,Menlo,monospace">${Math.round(value)}</text>`
    );
  }

  const poly = points
    .map((point, index) => {
      const [x, y] = xy(index, point.landedMax);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const dots = points
    .map((point, index) => {
      const [x, y] = xy(index, point.landedMax);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="#1a3a4a"/>`;
    })
    .join('\n');

  const labelIndexes = new Set<number>([0, points.length - 1]);
  if (points.length >= 5) {
    labelIndexes.add(Math.floor((points.length - 1) / 2));
  }
  if (points.length >= 10) {
    labelIndexes.add(Math.floor((points.length - 1) * 0.75));
    labelIndexes.add(Math.floor((points.length - 1) * 0.25));
  }

  const xLabels = [...labelIndexes]
    .sort((left, right) => left - right)
    .map((index) => {
      const [x] = xy(index, 0);
      const label = points[index].periodStart.slice(0, 10);
      return `<text x="${x.toFixed(1)}" y="${height - 16}" text-anchor="middle" font-size="11" fill="#555" font-family="ui-monospace,Menlo,monospace">${escapeXml(label)}</text>`;
    })
    .join('\n');

  const subtitle = `Max tickets landed in any 8h window per day · non-linear time axis · last ${data.windowDays} day(s) shown`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="#f7f5f0"/>`,
    `<text x="${padL}" y="26" font-size="18" font-weight="700" fill="#1a3a4a" font-family="system-ui,sans-serif">Shift velocity — tickets landed per 8-hour stretch</text>`,
    `<text x="${padL}" y="44" font-size="12" fill="#555" font-family="system-ui,sans-serif">${escapeXml(subtitle)}</text>`,
    ...gridLines,
    `<polyline fill="none" stroke="#1a3a4a" stroke-width="2.6" points="${poly}"/>`,
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
