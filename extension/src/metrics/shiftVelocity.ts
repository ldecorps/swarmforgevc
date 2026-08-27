import { runGitLog, deriveTicketLifecycles, TicketLifecycleEvent } from './gitHistoryAdapter';

// BL-1184: tickets landed (moved to backlog/done/) per rolling 8-hour window.
// Pure over TicketLifecycleEvent[] from deriveTicketLifecycles — no second
// backlog history reader.

export const EIGHT_HOUR_MS = 8 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Adapter label for acceptance / invariant checks — single git lifecycle path. */
export const SHIFT_VELOCITY_LIFECYCLE_ADAPTER = 'deriveTicketLifecycles';

export interface ShiftVelocityDayPoint {
  dayMs: number;
  label: string;
  landedMax: number;
}

export interface ShiftVelocitySeries {
  series: ShiftVelocityDayPoint[];
  windowHours: number;
}

function yyyyMmDd(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function dayStartMs(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

export function closedTimesMsFromLifecycles(lifecycles: TicketLifecycleEvent[]): number[] {
  return lifecycles
    .map((l) => (l.closeDateIso !== null ? Date.parse(l.closeDateIso) : NaN))
    .filter((ms) => !Number.isNaN(ms));
}

/** Count done/ closes in one eight-hour window [windowStartMs, windowStartMs + 8h). */
export function countLandedInEightHourWindow(closeTimesMs: number[], windowStartMs: number): number {
  const endMs = windowStartMs + EIGHT_HOUR_MS;
  return closeTimesMs.filter((ms) => ms >= windowStartMs && ms < endMs).length;
}

/** Max landed count over every rolling eight-hour window overlapping a calendar day. */
export function maxRollingEightHourLandedForDay(closeTimesMs: number[], dayStartMs: number): number {
  let max = 0;
  const dayEndMs = dayStartMs + DAY_MS;
  for (let start = dayStartMs; start < dayEndMs; start += 60 * 60 * 1000) {
    const count = countLandedInEightHourWindow(closeTimesMs, start);
    if (count > max) {
      max = count;
    }
  }
  return max;
}

export function computeDailyShiftVelocitySeries(
  lifecycles: TicketLifecycleEvent[],
  nowMs: number
): ShiftVelocitySeries {
  const closeTimes = closedTimesMsFromLifecycles(lifecycles);
  if (closeTimes.length === 0) {
    return { series: [], windowHours: 8 };
  }
  const earliestDay = dayStartMs(Math.min(...closeTimes));
  const latestDay = dayStartMs(nowMs);
  const series: ShiftVelocityDayPoint[] = [];
  for (let day = earliestDay; day <= latestDay; day += DAY_MS) {
    series.push({
      dayMs: day,
      label: yyyyMmDd(day),
      landedMax: maxRollingEightHourLandedForDay(closeTimes, day),
    });
  }
  return { series, windowHours: 8 };
}

/** Git history path: runGitLog + deriveTicketLifecycles only (BL-1184). */
export function buildShiftVelocityFromGitHistory(
  targetPath: string,
  ref: string = 'main',
  nowMs: number = Date.now()
): ShiftVelocitySeries {
  const lifecycles = [...deriveTicketLifecycles(runGitLog(targetPath, 'backlog/', ref)).values()];
  return computeDailyShiftVelocitySeries(lifecycles, nowMs);
}
