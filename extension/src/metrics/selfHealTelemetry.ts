// BL-597: pure self-heal event aggregation for behaviour trends.

import { computeTrend, TrendResult, TrendSeriesPoint } from './trend';

export interface SelfHealEvent {
  type: string;
  subject: string;
  reason: string;
  at: string;
}

export interface SelfHealCountWindow {
  startMs: number;
  endMs: number;
  bucketMs?: number;
}

function parseAtMs(at: string): number | null {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
}

function bucketMs(window: SelfHealCountWindow): number {
  return window.bucketMs ?? 24 * 60 * 60 * 1000;
}

function eventsInWindow(events: SelfHealEvent[], startMs: number, endMs: number): SelfHealEvent[] {
  return events.filter((e) => {
    const ms = parseAtMs(e.at);
    return ms !== null && ms >= startMs && ms <= endMs;
  });
}

function seriesForType(
  events: SelfHealEvent[],
  type: string,
  window: SelfHealCountWindow
): TrendSeriesPoint[] {
  const bucket = bucketMs(window);
  const buckets = new Map<number, number>();
  for (const ev of eventsInWindow(events, window.startMs, window.endMs)) {
    if (ev.type !== type) continue;
    const ms = parseAtMs(ev.at);
    if (ms === null) continue;
    const key = Math.floor((ms - window.startMs) / bucket) * bucket + window.startMs;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, count]) => ({
      periodStart: new Date(start).toISOString(),
      value: count,
    }));
}

/** Pure per-type count series over a window — no filesystem access. */
export function aggregateSelfHealCounts(
  events: SelfHealEvent[],
  window: SelfHealCountWindow
): Record<string, TrendResult> {
  const types = [...new Set(events.map((e) => e.type))];
  const out: Record<string, TrendResult> = {};
  for (const type of types) {
    out[type] = computeTrend(seriesForType(events, type, window));
  }
  return out;
}
