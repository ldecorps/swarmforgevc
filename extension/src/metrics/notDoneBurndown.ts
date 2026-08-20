import { TicketLifecycleEvent, isTicketRemainingAtDayEnd } from './gitHistoryAdapter';

// Not-done (open) ticket series for the daily briefing email: remaining
// count over a fixed trailing window. Pure over already-derived
// TicketLifecycleEvent[] so unit tests never need live git; the CLI
// (render-briefing-burndown.ts) is the only place that shells. SVG/PNG
// rendering of this series lives in notDoneBurndownChart.ts (BL-896
// cleanup: data derivation and presentation are separate concerns).

export const DEFAULT_NOT_DONE_BURNDOWN_WINDOW_DAYS = 30;

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
  projection: NotDoneBurndownProjection;
}

// BL-910: projected ETA beside the counts it is derived from. The human's
// one hard condition (invariant 1): a date exists ONLY when the measured
// net burn is strictly positive - a growing or flat backlog gets the
// reason, never a date, an infinity, or a placeholder.
export type NotDoneBurndownProjection =
  | { kind: 'eta'; netBurnPerDay: number; etaDays: number; etaDateLabel: string }
  | { kind: 'no-eta'; netBurnPerDay: number; reason: string };

export const NOT_SHRINKING_REASON = 'no ETA — backlog still growing';

function yyyyMmDd(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Pure (BL-910): net-flow projection over the same three numbers the chart
 * subtitle prints. Both rates are rounded to the ONE DECIMAL the subtitle
 * shows before the division (integer tenths, so no float dust), which is
 * invariant 2: the shown ETA is recomputable by hand from the open count,
 * close rate and mint rate printed beside it - never from hidden precision.
 * Fractional days round UP to whole days for the calendar date.
 */
export function projectNotDoneEta(
  openN: number,
  closePerDay: number,
  mintPerDay: number,
  nowMs: number
): NotDoneBurndownProjection {
  const netBurnTenths = Math.round(closePerDay * 10) - Math.round(mintPerDay * 10);
  const netBurnPerDay = netBurnTenths / 10;
  if (netBurnTenths <= 0) {
    return { kind: 'no-eta', netBurnPerDay, reason: NOT_SHRINKING_REASON };
  }
  const etaDays = Math.ceil(openN / netBurnPerDay);
  return { kind: 'eta', netBurnPerDay, etaDays, etaDateLabel: yyyyMmDd(nowMs + etaDays * DAY_MS) };
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
  const closePerDay = totalClosed / days;
  const mintPerDay = totalFiled / days;
  return {
    windowDays,
    open0,
    openN,
    net: openN - open0,
    totalClosed,
    totalFiled,
    closePerDay,
    mintPerDay,
    series,
    projection: projectNotDoneEta(openN, closePerDay, mintPerDay, nowMs),
  };
}

