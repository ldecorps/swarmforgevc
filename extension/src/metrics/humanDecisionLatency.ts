import { computeTrend, TrendResult, TrendSeriesPoint } from './trend';
import { splitOutliers } from './stageDwell';

// BL-600: human-decision latency — ask (ApprovalRequested) to verdict per gate.
// Pure over paired timestamps; stageDwell's splitOutliers supplies outlier
// honesty. Measurement only — never nudges or blocks approval flow.

export type DecisionGate = 'approve' | 'amend';

export interface DecisionAskVerdictInput {
  ticketId: string;
  gate: DecisionGate;
  askAtMs: number;
  verdictAtMs?: number;
}

export interface DerivedDecisionLatency {
  ticketId: string;
  gate: DecisionGate;
  latencyMs?: number;
  openAgeMs?: number;
}

export interface DecidedDecisionRecord {
  ticketId: string;
  gate: DecisionGate;
  latencyMs: number;
  verdictAtMs: number;
}

export interface DecisionLatencyWindowPoint {
  periodStart: string;
  medianMs: number | null;
  outliersMs: number[];
  decidedCount: number;
}

export interface DecisionLatencyAggregation {
  windows: DecisionLatencyWindowPoint[];
  openWaits: DerivedDecisionLatency[];
  trend: TrendResult;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function bucketStartMs(ms: number, bucketMs: number): number {
  return Math.floor(ms / bucketMs) * bucketMs;
}

function medianOf(sorted: number[]): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function deriveTicketDecisionLatency(
  input: DecisionAskVerdictInput,
  nowMs: number
): DerivedDecisionLatency {
  const { ticketId, gate, askAtMs, verdictAtMs } = input;
  if (verdictAtMs !== undefined && verdictAtMs >= askAtMs) {
    return { ticketId, gate, latencyMs: verdictAtMs - askAtMs };
  }
  return { ticketId, gate, openAgeMs: Math.max(0, nowMs - askAtMs) };
}

export function partitionDecisionLatencies(
  pairs: DecisionAskVerdictInput[],
  nowMs: number
): { decided: DecidedDecisionRecord[]; openWaits: DerivedDecisionLatency[] } {
  const decided: DecidedDecisionRecord[] = [];
  const openWaits: DerivedDecisionLatency[] = [];
  for (const pair of pairs) {
    const derived = deriveTicketDecisionLatency(pair, nowMs);
    if (derived.latencyMs !== undefined && pair.verdictAtMs !== undefined) {
      decided.push({
        ticketId: derived.ticketId,
        gate: derived.gate,
        latencyMs: derived.latencyMs,
        verdictAtMs: pair.verdictAtMs,
      });
    } else if (derived.openAgeMs !== undefined) {
      openWaits.push(derived);
    }
  }
  return { decided, openWaits };
}

function windowPointForDay(day: number, latencies: number[]): DecisionLatencyWindowPoint {
  const { normal, outliers } = splitOutliers(latencies);
  const sorted = [...normal].sort((a, b) => a - b);
  return {
    periodStart: new Date(day).toISOString(),
    medianMs: medianOf(sorted),
    outliersMs: outliers,
    decidedCount: latencies.length,
  };
}

export function aggregateDecisionLatency(
  decided: DecidedDecisionRecord[],
  openWaits: DerivedDecisionLatency[],
  nowMs: number,
  bucketMs: number = DAY_MS
): DecisionLatencyAggregation {
  const byDay = new Map<number, number[]>();
  for (const rec of decided) {
    const day = bucketStartMs(rec.verdictAtMs, bucketMs);
    const list = byDay.get(day) ?? [];
    list.push(rec.latencyMs);
    byDay.set(day, list);
  }

  const dayKeys = [...byDay.keys()].sort((a, b) => a - b);
  const nowDay = bucketStartMs(nowMs, bucketMs);
  const startDay = dayKeys.length > 0 ? dayKeys[0] : nowDay;
  const windows: DecisionLatencyWindowPoint[] = [];

  for (let day = startDay; day <= nowDay; day += bucketMs) {
    windows.push(windowPointForDay(day, byDay.get(day) ?? []));
  }

  const medianSeries: TrendSeriesPoint[] = windows
    .filter((w) => w.medianMs !== null)
    .map((w) => ({ periodStart: w.periodStart, value: w.medianMs as number }));

  return { windows, openWaits, trend: computeTrend(medianSeries) };
}

export function trendForDecisionLatencyMedian(windows: DecisionLatencyWindowPoint[]): TrendResult {
  const series: TrendSeriesPoint[] = windows
    .filter((w) => w.medianMs !== null)
    .map((w) => ({ periodStart: w.periodStart, value: w.medianMs as number }));
  return computeTrend(series);
}
