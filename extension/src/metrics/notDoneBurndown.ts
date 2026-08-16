import { Resvg } from '@resvg/resvg-js';
import { TicketLifecycleEvent, isTicketRemainingAtDayEnd } from './gitHistoryAdapter';

// Not-done (open) ticket burndown for the daily briefing email: remaining
// count over a fixed trailing window, rendered as SVG then rasterized to
// cid-PNG the same way BL-260/BL-286 architecture diagrams are. Pure over
// already-derived TicketLifecycleEvent[] so unit tests never need live git;
// the CLI (render-briefing-burndown.ts) is the only place that shells.

export const DEFAULT_NOT_DONE_BURNDOWN_WINDOW_DAYS = 30;
export const NOT_DONE_BURNDOWN_DIAGRAM_NAME = 'not-done-burndown';
// Chart SVG is 960px wide; 2x is enough for email/high-DPI without the
// multi-second cost of the architecture diagrams' 3200px width.
export const BURNDOWN_RENDER_WIDTH = 1920;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface NotDoneBurndownDayPoint {
  dayMs: number;
  label: string;
  remaining: number;
  filed: number;
  closed: number;
}

export interface NotDoneBurndownSeries {
  windowDays: number;
  open0: number;
  openN: number;
  net: number;
  totalClosed: number;
  totalFiled: number;
  closePerDay: number;
  mintPerDay: number;
  series: NotDoneBurndownDayPoint[];
}

function localDayStartMs(dateMs: number): number {
  const d = new Date(dateMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function mmDd(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

function onLocalDay(iso: string | null, dayStartMs: number): boolean {
  if (iso === null) {
    return false;
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return false;
  }
  return localDayStartMs(ms) === dayStartMs;
}

/**
 * Pure: remaining (not-yet-closed) ticket count per local calendar day.
 *
 * `currentOpenTicketIds`, when given, is the live set of ticket ids actually
 * sitting in backlog/active + backlog/paused + backlog/hold today (BL-896
 * F3). `deriveTicketLifecycles` never assigns a close date to a ticket
 * retired by deleting its YAML rather than moving it under backlog/done/, so
 * without this the lifecycle-only heuristic below can count such a ticket as
 * remaining forever. That is an adapter-level gap shared by every
 * `deriveTicketLifecycles` consumer, not fixed at the source here (wide
 * blast radius - see gitHistoryAdapter.ts's isTicketRemainingAtDayEnd). Only
 * TODAY's point can be reconciled against a live disk read, so only it is
 * corrected; the rest of the window keeps the lifecycle estimate since past
 * disk state cannot be reconstructed.
 */
export function computeNotDoneBurndownSeries(
  lifecycles: TicketLifecycleEvent[],
  nowMs: number,
  windowDays: number = DEFAULT_NOT_DONE_BURNDOWN_WINDOW_DAYS,
  currentOpenTicketIds?: ReadonlySet<string>
): NotDoneBurndownSeries {
  const todayStart = localDayStartMs(nowMs);
  const start = todayStart - (windowDays - 1) * DAY_MS;
  const series: NotDoneBurndownDayPoint[] = [];
  let totalFiled = 0;
  let totalClosed = 0;

  for (let day = start; day <= todayStart; day += DAY_MS) {
    const dayEnd = day + DAY_MS;
    const remaining = lifecycles.filter((m) => isTicketRemainingAtDayEnd(m, dayEnd)).length;
    const filed = lifecycles.filter((m) => onLocalDay(m.specDateIso, day)).length;
    const closed = lifecycles.filter((m) => onLocalDay(m.closeDateIso, day)).length;
    totalFiled += filed;
    totalClosed += closed;
    series.push({ dayMs: day, label: mmDd(day), remaining, filed, closed });
  }

  if (currentOpenTicketIds && series.length > 0) {
    series[series.length - 1] = { ...series[series.length - 1], remaining: currentOpenTicketIds.size };
  }

  const open0 = series.length > 0 ? series[0].remaining : 0;
  const openN = series.length > 0 ? series[series.length - 1].remaining : 0;
  const days = Math.max(series.length, 1);
  return {
    windowDays,
    open0,
    openN,
    net: openN - open0,
    totalClosed,
    totalFiled,
    closePerDay: totalClosed / days,
    mintPerDay: totalFiled / days,
    series,
  };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function niceMax(value: number): number {
  if (value <= 0) {
    return 10;
  }
  const padded = value * 1.1;
  const mag = Math.pow(10, Math.floor(Math.log10(padded)));
  const norm = padded / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

/** Pure: SVG line chart matching the hand-built briefing burndown style. */
export function buildNotDoneBurndownSvg(data: NotDoneBurndownSeries): string {
  const width = 960;
  const height = 420;
  const padL = 64;
  const padR = 24;
  const padT = 58;
  const padB = 48;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const points = data.series;
  const maxY = niceMax(Math.max(...points.map((p) => p.remaining), 1));
  const n = Math.max(points.length - 1, 1);

  const xy = (i: number, remaining: number): [number, number] => {
    const x = padL + (i / n) * plotW;
    const y = padT + plotH - (remaining / maxY) * plotH;
    return [x, y];
  };

  const gridSteps = 8;
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
    .map((p, i) => {
      const [x, y] = xy(i, p.remaining);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const dots = points
    .map((p, i) => {
      const [x, y] = xy(i, p.remaining);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="#1a3a4a"/>`;
    })
    .join('\n');

  const labelIdxs = new Set<number>([0, points.length - 1]);
  if (points.length >= 5) {
    labelIdxs.add(Math.floor((points.length - 1) / 2));
  }
  if (points.length >= 9) {
    labelIdxs.add(Math.floor((points.length - 1) / 4));
    labelIdxs.add(Math.floor((3 * (points.length - 1)) / 4));
  }
  const xLabels = [...labelIdxs]
    .sort((a, b) => a - b)
    .map((i) => {
      const [x] = xy(i, 0);
      return `<text x="${x.toFixed(1)}" y="${height - 16}" text-anchor="middle" font-size="11" fill="#555" font-family="ui-monospace,Menlo,monospace">${escapeXml(points[i].label)}</text>`;
    })
    .join('\n');

  const netSign = data.net >= 0 ? '+' : '';
  const subtitle = `Open ${data.open0} → ${data.openN} (net ${netSign}${data.net} / ${data.windowDays}d) · Close ${data.closePerDay.toFixed(1)}/d · Mint ${data.mintPerDay.toFixed(1)}/d`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="#f7f5f0"/>`,
    `<text x="${padL}" y="26" font-size="18" font-weight="700" fill="#1a3a4a" font-family="system-ui,sans-serif">Open tickets remaining — last ${data.windowDays} days</text>`,
    `<text x="${padL}" y="44" font-size="12" fill="#555" font-family="system-ui,sans-serif">${escapeXml(subtitle)}</text>`,
    ...gridLines,
    `<polyline fill="none" stroke="#1a3a4a" stroke-width="2.6" points="${poly}"/>`,
    dots,
    xLabels,
    `</svg>`,
  ].join('\n');
}

export function renderNotDoneBurndownPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: BURNDOWN_RENDER_WIDTH },
    background: 'white',
  });
  return resvg.render().asPng();
}
