// BL-598: pure false-alarm alert records + per-type window aggregation.
// Verdict strings are never re-judged here — they are whatever the emitting
// sweep already classified at fire time.

import { computeTrend, TrendResult, TrendSeriesPoint } from './trend';

export type AlertVerdict = 'false-positive' | 'actionable';

export interface AlertTelemetryRecord {
  at: string;
  alertType: string;
  verdict: AlertVerdict;
  fired: boolean;
}

function bucketStartMs(atMs: number, windowMs: number): number {
  return Math.floor(atMs / windowMs) * windowMs;
}

function pushBucketRate(
  buckets: Map<number, number[]>,
  atIso: string,
  windowMs: number,
  isFalsePositive: boolean
): void {
  const atMs = Date.parse(atIso);
  if (Number.isNaN(atMs)) return;
  const key = bucketStartMs(atMs, windowMs);
  const list = buckets.get(key) ?? [];
  list.push(isFalsePositive ? 1 : 0);
  buckets.set(key, list);
}

function meanSeries(buckets: Map<number, number[]>): TrendSeriesPoint[] {
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, values]) => ({
      periodStart: new Date(start).toISOString(),
      value: values.reduce((s, v) => s + v, 0) / values.length,
    }));
}

/** Per-window false-positive rate for one alert type's records. */
export function aggregateFalsePositiveRate(
  records: AlertTelemetryRecord[],
  windowMs: number
): TrendSeriesPoint[] {
  const buckets = new Map<number, number[]>();
  for (const record of records) {
    if (!record.fired) continue;
    pushBucketRate(buckets, record.at, windowMs, record.verdict === 'false-positive');
  }
  return meanSeries(buckets);
}

export function trendForAlertType(
  records: AlertTelemetryRecord[],
  windowMs: number
): TrendResult {
  return computeTrend(aggregateFalsePositiveRate(records, windowMs));
}

/** Group records by alertType, aggregate each series independently. */
export function aggregateFalsePositiveRateByType(
  records: AlertTelemetryRecord[],
  windowMs: number
): Record<string, TrendSeriesPoint[]> {
  const byType = new Map<string, AlertTelemetryRecord[]>();
  for (const record of records) {
    const list = byType.get(record.alertType) ?? [];
    list.push(record);
    byType.set(record.alertType, list);
  }
  const out: Record<string, TrendSeriesPoint[]> = {};
  for (const [alertType, typed] of byType.entries()) {
    out[alertType] = aggregateFalsePositiveRate(typed, windowMs);
  }
  return out;
}
