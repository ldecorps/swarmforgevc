// BL-595: pure human-loop reliability records + window aggregation.
// Measuring never invents classifications — every outcome string is one the
// emitting front-desk code already computed. Aggregation is file-free: it
// folds an in-memory record list into trend.ts series points.

import { computeTrend, TrendResult, TrendSeriesPoint } from './trend';

export type ApprovalTapOutcome = 'recorded' | 'silently-dropped' | 'repaint-failed';
export type ApprovalDropReason = 'not-my-chat' | 'not-principal' | 'unrecognized-data';
export type SteeringOutcome = 'delivered' | 'no-pane' | 'undelivered' | 'menu-blocked';
export type PollHealthOutcome = 'degraded' | 'conflict-409';

export type HumanLoopOutcomeSeries = 'approval-tap' | 'steering-delivery' | 'poll-health';

export interface HumanLoopOutcomeRecord {
  at: string;
  series: HumanLoopOutcomeSeries;
  outcome: string;
  reason?: string;
}

export interface HumanLoopTickRecord {
  at: string;
  series: 'tick-duration';
  durationMs: number;
}

export type HumanLoopRecord = HumanLoopOutcomeRecord | HumanLoopTickRecord;

const SUCCESS_OUTCOMES = new Set(['recorded', 'delivered']);

export function isOutcomeRecord(record: HumanLoopRecord): record is HumanLoopOutcomeRecord {
  return record.series !== 'tick-duration';
}

export function isTickRecord(record: HumanLoopRecord): record is HumanLoopTickRecord {
  return record.series === 'tick-duration';
}

export interface WindowSummary {
  periodStart: string;
  value: number;
  count: number;
}

function bucketStartMs(atMs: number, windowMs: number): number {
  return Math.floor(atMs / windowMs) * windowMs;
}

function sortedBuckets(map: Map<number, number[]>): WindowSummary[] {
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, values]) => ({
      periodStart: new Date(start).toISOString(),
      value: values.reduce((s, v) => s + v, 0) / values.length,
      count: values.length,
    }));
}

/** Per-window success rate (successes / total) for categorical outcome records. */
export function aggregateOutcomeSuccessRate(
  records: HumanLoopOutcomeRecord[],
  windowMs: number
): TrendSeriesPoint[] {
  const buckets = new Map<number, number[]>();
  for (const record of records) {
    const atMs = Date.parse(record.at);
    if (Number.isNaN(atMs)) continue;
    const key = bucketStartMs(atMs, windowMs);
    const list = buckets.get(key) ?? [];
    list.push(SUCCESS_OUTCOMES.has(record.outcome) ? 1 : 0);
    buckets.set(key, list);
  }
  return sortedBuckets(buckets).map(({ periodStart, value }) => ({ periodStart, value }));
}

/** Per-window mean duration for tick-duration records. */
export function aggregateTickDurationMean(
  records: HumanLoopTickRecord[],
  windowMs: number
): TrendSeriesPoint[] {
  const buckets = new Map<number, number[]>();
  for (const record of records) {
    const atMs = Date.parse(record.at);
    if (Number.isNaN(atMs) || !Number.isFinite(record.durationMs)) continue;
    const key = bucketStartMs(atMs, windowMs);
    const list = buckets.get(key) ?? [];
    list.push(record.durationMs);
    buckets.set(key, list);
  }
  return sortedBuckets(buckets).map(({ periodStart, value }) => ({ periodStart, value }));
}

export function trendForOutcomeRecords(
  records: HumanLoopOutcomeRecord[],
  windowMs: number
): TrendResult {
  return computeTrend(aggregateOutcomeSuccessRate(records, windowMs));
}

export function trendForTickRecords(
  records: HumanLoopTickRecord[],
  windowMs: number
): TrendResult {
  return computeTrend(aggregateTickDurationMean(records, windowMs));
}
