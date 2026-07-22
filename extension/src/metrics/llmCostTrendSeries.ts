// BL-551 (trend-series-11 .. trend-surface-15): rolling 7-day per-origin spend
// series for the multi-line trend chart. Bucketed into three time bands that
// sample finely near nowMs and coarsely further back. Ranked by cost in the
// rightmost (latest) bucket to highlight recently expensive origins, not
// lifetime totals.

import { LlmInvocationRecord, LlmInvocationOriginDimension } from './llmCostLedger';

export type LlmCostHorizon = '3h' | '24h' | '7d';

export const LLM_COST_HORIZONS_MS: Record<string, number> = {
  '3h': 3 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export interface OriginCostTrendBand {
  name: LlmCostHorizon;
  sinceMs: number;
  bucketMs: number;
}

export const DEFAULT_ORIGIN_COST_TREND_BANDS: OriginCostTrendBand[] = [
  { name: '3h', sinceMs: LLM_COST_HORIZONS_MS['3h'], bucketMs: 15 * 60 * 1000 },
  { name: '24h', sinceMs: LLM_COST_HORIZONS_MS['24h'], bucketMs: 60 * 60 * 1000 },
  { name: '7d', sinceMs: LLM_COST_HORIZONS_MS['7d'], bucketMs: 6 * 60 * 60 * 1000 },
];

export interface OriginCostTrendBucket {
  bucketStartMs: number;
  bucketEndMs: number;
  costUsd: number;
}

export interface OriginCostTrendSeries {
  key: Record<string, string | null>;
  buckets: OriginCostTrendBucket[];
}

export interface BuildOriginCostTrendSeriesOptions {
  nowMs: number;
  groupBy?: LlmInvocationOriginDimension[];
  bands?: OriginCostTrendBand[];
  topN?: number;
}

interface TrendBucketRange {
  startMs: number;
  endMs: number;
}

function atMs(record: LlmInvocationRecord): number {
  return Date.parse(record.at);
}

function withinHorizon(record: LlmInvocationRecord, horizonMs: number, nowMs: number): boolean {
  const ms = atMs(record);
  if (Number.isNaN(ms)) {
    return false;
  }
  return ms > nowMs - horizonMs && ms <= nowMs;
}

function groupKey(record: LlmInvocationRecord, groupBy: LlmInvocationOriginDimension[]): string {
  return groupBy.map((dimension) => String(record.origin[dimension])).join('\0');
}

function buildTrendBucketRanges(nowMs: number, bands: OriginCostTrendBand[]): TrendBucketRange[] {
  const bySinceAsc = [...bands].sort((a, b) => a.sinceMs - b.sinceMs);
  const ranges: TrendBucketRange[] = [];
  for (let i = bySinceAsc.length - 1; i >= 0; i -= 1) {
    const band = bySinceAsc[i];
    const bandStartMs = nowMs - band.sinceMs;
    const bandEndMs = i === 0 ? nowMs : nowMs - bySinceAsc[i - 1].sinceMs;
    for (let bucketStart = bandStartMs; bucketStart < bandEndMs; bucketStart += band.bucketMs) {
      ranges.push({ startMs: bucketStart, endMs: Math.min(bucketStart + band.bucketMs, bandEndMs) });
    }
  }
  return ranges;
}

const DEFAULT_TREND_GROUP_BY: LlmInvocationOriginDimension[] = ['role', 'trigger', 'script'];
const DEFAULT_TREND_TOP_N = 5;

function latestBucketCost(series: OriginCostTrendSeries): number {
  return series.buckets.length > 0 ? series.buckets[series.buckets.length - 1].costUsd : 0;
}

export function buildOriginCostTrendSeries(records: LlmInvocationRecord[], options: BuildOriginCostTrendSeriesOptions): OriginCostTrendSeries[] {
  const bands = options.bands ?? DEFAULT_ORIGIN_COST_TREND_BANDS;
  const groupBy = options.groupBy ?? DEFAULT_TREND_GROUP_BY;
  const windowMs = Math.max(...bands.map((band) => band.sinceMs));
  const ranges = buildTrendBucketRanges(options.nowMs, bands);
  const inWindow = records.filter((record) => withinHorizon(record, windowMs, options.nowMs));

  const seriesByKey = new Map<string, OriginCostTrendSeries>();
  for (const record of inWindow) {
    const compositeKey = groupKey(record, groupBy);
    let series = seriesByKey.get(compositeKey);
    if (!series) {
      const key: Record<string, string | null> = {};
      for (const dimension of groupBy) {
        key[dimension] = record.origin[dimension] as string | null;
      }
      series = { key, buckets: ranges.map((range) => ({ bucketStartMs: range.startMs, bucketEndMs: range.endMs, costUsd: 0 })) };
      seriesByKey.set(compositeKey, series);
    }
    if (record.costUsd === null) {
      continue;
    }
    const ms = atMs(record);
    const bucketIndex = ranges.findIndex((range) => ms > range.startMs && ms <= range.endMs);
    if (bucketIndex !== -1) {
      series.buckets[bucketIndex].costUsd += record.costUsd;
    }
  }

  const all = Array.from(seriesByKey.values());
  all.sort((a, b) => latestBucketCost(b) - latestBucketCost(a));
  const topN = options.topN ?? DEFAULT_TREND_TOP_N;
  return all.slice(0, topN);
}

export function chooseCostTrendAxisScale(series: OriginCostTrendSeries[]): 'log' | 'linear' {
  let minCostUsd = Infinity;
  let maxCostUsd = 0;
  for (const s of series) {
    for (const bucket of s.buckets) {
      if (bucket.costUsd <= 0) {
        continue;
      }
      minCostUsd = Math.min(minCostUsd, bucket.costUsd);
      maxCostUsd = Math.max(maxCostUsd, bucket.costUsd);
    }
  }
  if (!Number.isFinite(minCostUsd) || maxCostUsd <= 0) {
    return 'linear';
  }
  return maxCostUsd / minCostUsd >= 10 ? 'log' : 'linear';
}
