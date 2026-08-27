// BL-605 pure aggregator: cumulative total and rate summed across roles per bucket.
import { TranscriptUsageRecord, UsageTotals } from './transcriptUsage';
import { computeTrend, TrendResult, TrendSeriesPoint } from './trend';
import type { LlmInvocationRecord } from './llmCostLedger';

const MS_PER_HOUR = 60 * 60 * 1000;

export function totalTokensFromUsage(usage: UsageTotals): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
}

export function totalTokensFromRecord(record: TranscriptUsageRecord): number {
  return totalTokensFromUsage(record.usage);
}

function bucketStartMs(ms: number, bucketMs: number): number {
  return Math.floor(ms / bucketMs) * bucketMs;
}

export interface GlobalTokenBucket {
  bucketStartMs: number;
  periodStart: string;
  totalTokens: number | null;
  incomplete: boolean;
}

export interface GlobalTokenWindowSummary {
  cumulativeTotalTokens: number;
  rateTokensPerHour: number;
  incomplete: boolean;
}

export interface AggregateGlobalTokenBucketsOptions {
  recordsByRole: Record<string, TranscriptUsageRecord[]>;
  expectedRoles: string[];
  bucketMs: number;
}

interface BucketAccumulator {
  tokens: number;
  rolesPresent: Set<string>;
}

function pushRecord(
  bucketMap: Map<number, BucketAccumulator>,
  role: string,
  record: TranscriptUsageRecord,
  bucketMs: number
): void {
  const start = bucketStartMs(record.timestampMs, bucketMs);
  const entry = bucketMap.get(start) ?? { tokens: 0, rolesPresent: new Set<string>() };
  entry.tokens += totalTokensFromRecord(record);
  entry.rolesPresent.add(role);
  bucketMap.set(start, entry);
}

function bucketFromAccumulator(start: number, acc: BucketAccumulator, expectedRoles: string[]): GlobalTokenBucket {
  const incomplete = expectedRoles.some((role) => !acc.rolesPresent.has(role));
  return {
    bucketStartMs: start,
    periodStart: new Date(start).toISOString(),
    totalTokens: incomplete ? null : acc.tokens,
    incomplete,
  };
}

export function aggregateGlobalTokenBuckets(options: AggregateGlobalTokenBucketsOptions): GlobalTokenBucket[] {
  const { recordsByRole, expectedRoles, bucketMs } = options;
  const bucketMap = new Map<number, BucketAccumulator>();
  for (const [role, records] of Object.entries(recordsByRole)) {
    for (const rec of records) {
      pushRecord(bucketMap, role, rec, bucketMs);
    }
  }
  return [...bucketMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, acc]) => bucketFromAccumulator(start, acc, expectedRoles));
}

export interface SummarizeGlobalTokenWindowOptions {
  recordsByRole: Record<string, TranscriptUsageRecord[]>;
  expectedRoles: string[];
  windowStartMs: number;
  windowEndMs: number;
}

function roleHasRecordsInWindow(records: TranscriptUsageRecord[], startMs: number, endMs: number): boolean {
  return records.some((rec) => rec.timestampMs >= startMs && rec.timestampMs <= endMs);
}

export function summarizeGlobalTokenWindow(options: SummarizeGlobalTokenWindowOptions): GlobalTokenWindowSummary {
  const { recordsByRole, expectedRoles, windowStartMs, windowEndMs } = options;
  let cumulativeTotalTokens = 0;
  for (const records of Object.values(recordsByRole)) {
    for (const rec of records) {
      if (rec.timestampMs >= windowStartMs && rec.timestampMs <= windowEndMs) {
        cumulativeTotalTokens += totalTokensFromRecord(rec);
      }
    }
  }
  const incomplete = expectedRoles.some((role) => !roleHasRecordsInWindow(recordsByRole[role] ?? [], windowStartMs, windowEndMs));
  const windowMs = Math.max(0, windowEndMs - windowStartMs);
  const rateTokensPerHour = windowMs > 0 ? cumulativeTotalTokens / (windowMs / MS_PER_HOUR) : 0;
  return { cumulativeTotalTokens, rateTokensPerHour, incomplete };
}

export function globalTokenTrendSeries(buckets: GlobalTokenBucket[]): TrendSeriesPoint[] {
  return buckets
    .filter((bucket) => !bucket.incomplete && bucket.totalTokens !== null)
    .map((bucket) => ({ periodStart: bucket.periodStart, value: bucket.totalTokens as number }));
}

export function trendForGlobalTokenConsumption(buckets: GlobalTokenBucket[]): TrendResult {
  return computeTrend(globalTokenTrendSeries(buckets));
}

export interface ComputeGlobalTokenConsumptionOptions extends AggregateGlobalTokenBucketsOptions {
  /** Present for authority-pin scenarios; transcript totals remain authoritative. */
  ledgerRecords?: LlmInvocationRecord[];
}

export function computeGlobalTokenConsumptionFromTranscripts(
  options: ComputeGlobalTokenConsumptionOptions
): { buckets: GlobalTokenBucket[]; trend: TrendResult } {
  void options.ledgerRecords;
  const buckets = aggregateGlobalTokenBuckets(options);
  return { buckets, trend: trendForGlobalTokenConsumption(buckets) };
}
