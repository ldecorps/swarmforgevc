import { computeTrend, TrendResult, TrendSeriesPoint } from './trend';

// BL-601: context-compaction cadence — structured context-events with
// compaction:true only (never pane spinner text). Pure aggregation over
// derived {role, model, tokens-at-compaction, ts} records.

export interface ContextCompactionEvent {
  role: string;
  model: string;
  timestamp: string;
  compaction: boolean;
  contextUtilizationPct: number;
  inputTokens: number;
}

export interface CompactionRecord {
  role: string;
  model: string;
  tokensAtCompaction: number;
  timestamp: string;
  timestampMs: number;
}

export interface PaneSpinnerCompactionInput {
  spinnerText?: string;
  contextEvents: ContextCompactionEvent[];
}

export interface TokenAtCompactionDistribution {
  min: number | null;
  max: number | null;
  median: number | null;
  values: number[];
}

export interface RoleWindowCompactionPoint {
  periodStart: string;
  compactionsPerHour: number | null;
  tokenDistribution: TokenAtCompactionDistribution;
  compactionCount: number;
}

export interface RoleCompactionCadence {
  role: string;
  applicable: boolean;
  windows: RoleWindowCompactionPoint[];
  trend: TrendResult | null;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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

function tokenDistribution(values: number[]): TokenAtCompactionDistribution {
  if (values.length === 0) {
    return { min: null, max: null, median: null, values: [] };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: medianOf(sorted),
    values: sorted,
  };
}

export function deriveCompactionRecordFromContextEvent(
  event: ContextCompactionEvent
): CompactionRecord | null {
  if (!event.compaction) {
    return null;
  }
  return {
    role: event.role,
    model: event.model,
    tokensAtCompaction: event.inputTokens,
    timestamp: event.timestamp,
    timestampMs: Date.parse(event.timestamp),
  };
}

export function deriveCompactionRecords(input: PaneSpinnerCompactionInput): CompactionRecord[] {
  return input.contextEvents
    .map(deriveCompactionRecordFromContextEvent)
    .filter((record): record is CompactionRecord => record !== null);
}

function windowPointForDay(
  day: number,
  roleRecords: CompactionRecord[],
  bucketMs: number
): RoleWindowCompactionPoint {
  const count = roleRecords.length;
  const hours = bucketMs / HOUR_MS;
  const tokens = roleRecords.map((record) => record.tokensAtCompaction);
  return {
    periodStart: new Date(day).toISOString(),
    compactionsPerHour: count === 0 ? 0 : count / hours,
    tokenDistribution: tokenDistribution(tokens),
    compactionCount: count,
  };
}

function buildApplicableRoleSeries(
  role: string,
  records: CompactionRecord[],
  nowMs: number,
  bucketMs: number
): RoleCompactionCadence {
  const roleRecords = records.filter((record) => record.role === role);
  const byDay = new Map<number, CompactionRecord[]>();
  for (const record of roleRecords) {
    const day = bucketStartMs(record.timestampMs, bucketMs);
    const list = byDay.get(day) ?? [];
    list.push(record);
    byDay.set(day, list);
  }

  const dayKeys = [...byDay.keys()].sort((a, b) => a - b);
  const nowDay = bucketStartMs(nowMs, bucketMs);
  const startDay = dayKeys.length > 0 ? dayKeys[0] : nowDay;
  const windows: RoleWindowCompactionPoint[] = [];

  for (let day = startDay; day <= nowDay; day += bucketMs) {
    windows.push(windowPointForDay(day, byDay.get(day) ?? [], bucketMs));
  }

  const rateSeries: TrendSeriesPoint[] = windows.map((window) => ({
    periodStart: window.periodStart,
    value: window.compactionsPerHour ?? 0,
  }));

  return {
    role,
    applicable: true,
    windows,
    trend: computeTrend(rateSeries),
  };
}

export function aggregateCompactionCadence(
  records: CompactionRecord[],
  detectableRoles: string[],
  nowMs: number,
  bucketMs: number = DAY_MS
): RoleCompactionCadence[] {
  const roles = [...new Set([...detectableRoles, ...records.map((record) => record.role)])];
  return roles.map((role) => {
    if (!detectableRoles.includes(role)) {
      return { role, applicable: false, windows: [], trend: null };
    }
    return buildApplicableRoleSeries(role, records, nowMs, bucketMs);
  });
}

export function queryCompactionCadenceForRole(
  role: string,
  records: CompactionRecord[],
  detectableRoles: string[],
  nowMs: number,
  bucketMs: number = DAY_MS
): RoleCompactionCadence {
  const match = aggregateCompactionCadence(records, detectableRoles, nowMs, bucketMs).find(
    (series) => series.role === role
  );
  return match ?? { role, applicable: false, windows: [], trend: null };
}

export function trendForCompactionCadencePerHour(
  windows: RoleWindowCompactionPoint[]
): TrendResult {
  const series: TrendSeriesPoint[] = windows.map((window) => ({
    periodStart: window.periodStart,
    value: window.compactionsPerHour ?? 0,
  }));
  return computeTrend(series);
}
