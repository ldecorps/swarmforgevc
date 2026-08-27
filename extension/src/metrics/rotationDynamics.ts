// BL-596: pure rotation dynamics aggregation over append-only rotation events.
// Drives trend.ts series for mono-router health (dwell, thrash, stranded).

import { computeTrend, TrendResult, TrendSeriesPoint } from './trend';

export const DEFAULT_THRASH_WINDOW_MS = 30_000;

export interface RotationEvent {
  at: string;
  from: string;
  to: string;
  reason: string;
}

export interface RotationDynamicsWindow {
  startMs: number;
  endMs: number;
  homeRole: string;
  thrashWindowMs?: number;
}

export interface RotationDynamicsAggregate {
  dwellShares: Record<string, number>;
  dwellMs: Record<string, number>;
  rotationsPerDay: number;
  thrashRotations: number;
  ordinaryRotations: number;
  strandedOffHomeMs: number;
  rotationsTrend: TrendResult;
}

function parseAtMs(at: string): number | null {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
}

function sortedEvents(events: RotationEvent[]): RotationEvent[] {
  return [...events].sort((a, b) => {
    const am = parseAtMs(a.at) ?? 0;
    const bm = parseAtMs(b.at) ?? 0;
    return am - bm;
  });
}

function eventsInWindow(events: RotationEvent[], startMs: number, endMs: number): RotationEvent[] {
  return sortedEvents(events).filter((e) => {
    const ms = parseAtMs(e.at);
    return ms !== null && ms >= startMs && ms <= endMs;
  });
}

function isThrashRotation(
  events: RotationEvent[],
  index: number,
  thrashWindowMs: number
): boolean {
  if (index <= 0) return false;
  const cur = events[index];
  const prev = events[index - 1];
  const curMs = parseAtMs(cur.at);
  const prevMs = parseAtMs(prev.at);
  if (curMs === null || prevMs === null) return false;
  return prev.to === cur.from && curMs - prevMs <= thrashWindowMs;
}

function addDwell(
  dwellMs: Record<string, number>,
  role: string,
  ms: number
): void {
  if (ms <= 0) return;
  dwellMs[role] = (dwellMs[role] ?? 0) + ms;
}

function accumulateDwell(
  events: RotationEvent[],
  startMs: number,
  endMs: number
): Record<string, number> {
  const dwellMs: Record<string, number> = {};
  if (events.length === 0) return dwellMs;

  const firstMs = parseAtMs(events[0].at);
  if (firstMs !== null && firstMs > startMs) {
    addDwell(dwellMs, events[0].from, firstMs - startMs);
  }

  for (let i = 0; i < events.length; i++) {
    const atMs = parseAtMs(events[i].at);
    if (atMs === null) continue;
    const nextMs =
      i + 1 < events.length ? parseAtMs(events[i + 1].at) : endMs;
    if (nextMs === null) continue;
    addDwell(dwellMs, events[i].to, Math.max(0, nextMs - atMs));
  }
  return dwellMs;
}

function sharesFromDwell(dwellMs: Record<string, number>): Record<string, number> {
  const total = Object.values(dwellMs).reduce((s, v) => s + v, 0);
  if (total <= 0) return {};
  const shares: Record<string, number> = {};
  for (const [role, ms] of Object.entries(dwellMs)) {
    shares[role] = ms / total;
  }
  return shares;
}

function strandedMsForEvent(
  events: RotationEvent[],
  index: number,
  homeRole: string
): number {
  const ev = events[index];
  if (ev.to !== homeRole || ev.from === homeRole) return 0;
  if (ev.reason !== 'rotate-home') return 0;
  const atMs = parseAtMs(ev.at);
  const prevMs = index > 0 ? parseAtMs(events[index - 1].at) : null;
  if (atMs === null || prevMs === null) return 0;
  return Math.max(0, atMs - prevMs);
}

function dailyRotationPoints(
  events: RotationEvent[],
  startMs: number,
  endMs: number
): TrendSeriesPoint[] {
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets = new Map<number, number>();
  for (const ev of events) {
    const ms = parseAtMs(ev.at);
    if (ms === null) continue;
    const key = Math.floor(ms / dayMs) * dayMs;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, count]) => ({
      periodStart: new Date(start).toISOString(),
      value: count,
    }));
}

/** Pure aggregation over an in-memory rotation event list. */
export function aggregateRotationDynamics(
  events: RotationEvent[],
  window: RotationDynamicsWindow
): RotationDynamicsAggregate {
  const thrashWindowMs = window.thrashWindowMs ?? DEFAULT_THRASH_WINDOW_MS;
  const inWindow = eventsInWindow(events, window.startMs, window.endMs);
  const dwellMs = accumulateDwell(inWindow, window.startMs, window.endMs);
  const windowDays = Math.max((window.endMs - window.startMs) / (24 * 60 * 60 * 1000), 1 / 24);

  let thrashRotations = 0;
  let ordinaryRotations = 0;
  let strandedOffHomeMs = 0;
  for (let i = 0; i < inWindow.length; i++) {
    if (isThrashRotation(inWindow, i, thrashWindowMs)) {
      thrashRotations++;
    } else {
      ordinaryRotations++;
    }
    strandedOffHomeMs += strandedMsForEvent(inWindow, i, window.homeRole);
  }

  const daily = dailyRotationPoints(inWindow, window.startMs, window.endMs);
  const rotationsPerDay = inWindow.length / windowDays;

  return {
    dwellShares: sharesFromDwell(dwellMs),
    dwellMs,
    rotationsPerDay,
    thrashRotations,
    ordinaryRotations,
    strandedOffHomeMs,
    rotationsTrend: computeTrend(daily),
  };
}

export interface RotationDynamicsQueryResult {
  applicable: boolean;
  aggregate: RotationDynamicsAggregate | null;
}

/** Non-mono-router packs yield NA without error (mono_router_lib posture). */
export function queryRotationDynamics(
  events: RotationEvent[],
  window: RotationDynamicsWindow,
  monoRouterPack: boolean
): RotationDynamicsQueryResult {
  if (!monoRouterPack) {
    return { applicable: false, aggregate: null };
  }
  return {
    applicable: true,
    aggregate: aggregateRotationDynamics(events, window),
  };
}
