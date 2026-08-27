import { deriveIntakeBalanceEvents } from './deliveryMetrics';
import type { GitLogEntry } from './gitHistoryAdapter';

export const EIGHT_HOUR_MS = 8 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export interface ShiftVelocityDayPoint {
  periodStart: string;
  landedMax: number;
}

export interface ShiftVelocityHistory {
  closedAtMs: number[];
  adapter: 'deriveIntakeBalanceEvents';
}

function bucketStartMs(dateMs: number, bucketMs: number): number {
  return Math.floor(dateMs / bucketMs) * bucketMs;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

export function countLandedInWindow(closedAtMs: number[], windowStartMs: number, windowMs: number = EIGHT_HOUR_MS): number {
  const windowEnd = windowStartMs + windowMs;
  return closedAtMs.filter((ms) => ms >= windowStartMs && ms < windowEnd).length;
}

function windowStartCandidates(closedAtMs: number[], dayStartMs: number): number[] {
  const dayEnd = dayStartMs + DAY_MS;
  const starts = new Set<number>([dayStartMs]);
  for (const ms of closedAtMs) {
    if (ms < dayStartMs - EIGHT_HOUR_MS || ms >= dayEnd) {
      continue;
    }
    starts.add(ms);
    starts.add(Math.max(dayStartMs, ms - EIGHT_HOUR_MS + 1));
  }
  return [...starts];
}

export function maxEightHourLandedForDay(closedAtMs: number[], dayStartMs: number): number {
  let max = 0;
  for (const start of windowStartCandidates(closedAtMs, dayStartMs)) {
    max = Math.max(max, countLandedInWindow(closedAtMs, start, EIGHT_HOUR_MS));
  }
  return max;
}

export function computeDailyShiftVelocitySeries(closedAtMs: number[], nowMs: number): ShiftVelocityDayPoint[] {
  const nowDay = bucketStartMs(nowMs, DAY_MS);
  const earliestDay =
    closedAtMs.length > 0 ? bucketStartMs(Math.min(...closedAtMs), DAY_MS) : nowDay;
  const series: ShiftVelocityDayPoint[] = [];
  for (let day = earliestDay; day <= nowDay; day += DAY_MS) {
    series.push({ periodStart: toIso(day), landedMax: maxEightHourLandedForDay(closedAtMs, day) });
  }
  return series;
}

export function buildShiftVelocityHistoryFromGitEntries(entries: GitLogEntry[]): ShiftVelocityHistory {
  const events = deriveIntakeBalanceEvents(entries);
  return { closedAtMs: events.closedAtMs, adapter: 'deriveIntakeBalanceEvents' };
}
