// BL-602: handoff queue-wait latency from enqueued_at to dequeued_at per recipient.

import {
  parseHandoffHeaders,
  readHandoffHeaderRecordsFlat,
  readHandoffHeaderRecordsWithBatches,
} from './swarmMetrics';
import { splitOutliers } from './stageDwell';
import { computeTrend, TrendResult, TrendSeriesPoint } from './trend';
import { mailboxDir, RoleEntry } from '../swarm/swarmState';

export type HandoffLatencyStatus = 'processed' | 'open';

export interface HandoffLatencyRecord {
  recipient: string;
  status: HandoffLatencyStatus;
  latencyMs?: number;
  openWaitMs?: number;
  enqueuedAtMs: number;
  dequeuedAtMs?: number;
}

export interface HandoffLatencyWindow {
  startMs: number;
  endMs: number;
  bucketMs?: number;
}

export interface HandoffLatencyBucketStats {
  periodStart: string;
  medianMs: number | null;
  outliersMs: number[];
  processedCount: number;
}

export interface HandoffLatencyRoleAggregation {
  role: string;
  buckets: HandoffLatencyBucketStats[];
  openWaits: HandoffLatencyRecord[];
  medianTrend: TrendResult;
}

function parseMsOrNull(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function recipientFromHeaders(headers: Record<string, string>): string | null {
  const to = headers.to?.trim();
  if (to) {
    return to;
  }
  const recipient = headers.recipient?.trim();
  return recipient || null;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function bucketStartMs(enqueuedAtMs: number, windowStartMs: number, bucketMs: number): number {
  return Math.floor((enqueuedAtMs - windowStartMs) / bucketMs) * bucketMs + windowStartMs;
}

function statsForLatencies(latenciesMs: number[], periodStart: string): HandoffLatencyBucketStats {
  const { normal, outliers } = splitOutliers(latenciesMs);
  const sorted = [...normal].sort((a, b) => a - b);
  return {
    periodStart,
    medianMs: median(sorted),
    outliersMs: outliers,
    processedCount: latenciesMs.length,
  };
}

/** Pure derivation from one handoff header record. */
export function deriveHandoffLatency(
  headers: Record<string, string>,
  nowMs: number = Date.now()
): HandoffLatencyRecord | null {
  const recipient = recipientFromHeaders(headers);
  const enqueuedAtMs = parseMsOrNull(headers.enqueued_at);
  if (!recipient || enqueuedAtMs === null) {
    return null;
  }
  const dequeuedAtMs = parseMsOrNull(headers.dequeued_at);
  if (dequeuedAtMs !== null && dequeuedAtMs >= enqueuedAtMs) {
    return {
      recipient,
      status: 'processed',
      latencyMs: dequeuedAtMs - enqueuedAtMs,
      enqueuedAtMs,
      dequeuedAtMs,
    };
  }
  return {
    recipient,
    status: 'open',
    openWaitMs: Math.max(0, nowMs - enqueuedAtMs),
    enqueuedAtMs,
  };
}

export function deriveHandoffLatencyRecords(
  headerRecords: Array<Record<string, string>>,
  nowMs: number = Date.now()
): HandoffLatencyRecord[] {
  return headerRecords
    .map((headers) => deriveHandoffLatency(headers, nowMs))
    .filter((record): record is HandoffLatencyRecord => record !== null);
}

function bucketMsFor(window: HandoffLatencyWindow): number {
  return window.bucketMs ?? 24 * 60 * 60 * 1000;
}

function aggregateRoleRecords(
  role: string,
  processed: HandoffLatencyRecord[],
  openWaits: HandoffLatencyRecord[],
  window: HandoffLatencyWindow
): HandoffLatencyRoleAggregation {
  const bucketMs = bucketMsFor(window);
  const buckets = new Map<number, number[]>();
  for (const record of processed) {
    const anchorMs = record.dequeuedAtMs ?? record.enqueuedAtMs;
    if (anchorMs < window.startMs || anchorMs > window.endMs) {
      continue;
    }
    const key = bucketStartMs(anchorMs, window.startMs, bucketMs);
    const list = buckets.get(key) ?? [];
    list.push(record.latencyMs ?? 0);
    buckets.set(key, list);
  }
  const bucketStats = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, latencies]) => statsForLatencies(latencies, new Date(start).toISOString()));
  const trendPoints: TrendSeriesPoint[] = bucketStats
    .filter((b) => b.medianMs !== null)
    .map((b) => ({ periodStart: b.periodStart, value: b.medianMs as number }));
  return {
    role,
    buckets: bucketStats,
    openWaits: openWaits.filter((r) => r.recipient === role),
    medianTrend: computeTrend(trendPoints),
  };
}

/** Pure per-role median + outlier aggregation — no filesystem access. */
export function aggregateHandoffLatencyByRole(
  records: HandoffLatencyRecord[],
  window: HandoffLatencyWindow
): HandoffLatencyRoleAggregation[] {
  const processed = records.filter((r) => r.status === 'processed');
  const openWaits = records.filter((r) => r.status === 'open');
  const roles = [...new Set(records.map((r) => r.recipient))];
  return roles.map((role) =>
    aggregateRoleRecords(
      role,
      processed.filter((r) => r.recipient === role),
      openWaits,
      window
    )
  );
}

function readMailboxHeaders(dir: string, useBatches: boolean): Array<Record<string, string>> {
  return useBatches ? readHandoffHeaderRecordsWithBatches(dir) : readHandoffHeaderRecordsFlat(dir);
}

function gatherHeadersFromEntry(
  entry: Pick<RoleEntry, 'role' | 'worktreeName' | 'worktreePath'>
): Array<Record<string, string>> {
  const newDir = mailboxDir(entry, 'inbox', 'new');
  const inProcessDir = mailboxDir(entry, 'inbox', 'in_process');
  const completedDir = mailboxDir(entry, 'inbox', 'completed');
  return [
    ...readMailboxHeaders(newDir, false),
    ...readMailboxHeaders(inProcessDir, true),
    ...readMailboxHeaders(completedDir, true),
  ];
}

/** Read master-resident and worktree mailboxes for one role entry. */
export function gatherRoleHandoffLatencyRecords(
  entry: Pick<RoleEntry, 'role' | 'worktreeName' | 'worktreePath'>,
  nowMs: number = Date.now()
): HandoffLatencyRecord[] {
  return deriveHandoffLatencyRecords(gatherHeadersFromEntry(entry), nowMs);
}

/** Read one mailbox subdirectory (acceptance fixtures). */
export function readMailboxHandoffLatencyRecords(
  mailboxDirPath: string,
  useBatches: boolean,
  nowMs: number = Date.now()
): HandoffLatencyRecord[] {
  const headers = readMailboxHeaders(mailboxDirPath, useBatches);
  return deriveHandoffLatencyRecords(headers, nowMs);
}

export function deriveHandoffLatencyFromText(text: string, nowMs?: number): HandoffLatencyRecord | null {
  return deriveHandoffLatency(parseHandoffHeaders(text), nowMs ?? Date.now());
}
