import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { chaserTelemetryDir, readChaserTelemetryEvents, ChaserTelemetryEvent } from './swarmMetrics';
import { computeTrend, TrendResult, TrendSeriesPoint } from './trend';

// BL-100 cost-04: CPU/RAM per role, sampled on a slow timer and folded into
// the BL-096 trend framework. resource_sample events join the existing
// BL-098 chaser-*.jsonl monthly telemetry family (its reader already
// tolerates unknown `type` values) rather than inventing a second file
// convention.

export interface ResourceSampleEvent {
  role: string;
  rssBytes: number;
  cpuPercent: number;
  atMs: number;
}

// Pure: validates and narrows already-read raw telemetry events (of every
// type - chase/nudge/dead-letter/respawn/resource_sample all share one
// reader) down to well-formed resource_sample ones. Fully testable without
// touching a real telemetry file.
export function filterResourceSampleEvents(rawEvents: ChaserTelemetryEvent[]): ResourceSampleEvent[] {
  const events: ResourceSampleEvent[] = [];
  for (const raw of rawEvents) {
    if (raw.type !== 'resource_sample') {
      continue;
    }
    const unknownRaw = raw as unknown as Record<string, unknown>;
    const rssBytes = Number(unknownRaw.rssBytes);
    const cpuPercent = Number(unknownRaw.cpuPercent);
    const atMs = Date.parse(raw.at);
    if (!Number.isFinite(rssBytes) || !Number.isFinite(cpuPercent) || Number.isNaN(atMs)) {
      continue;
    }
    events.push({ role: raw.role, rssBytes, cpuPercent, atMs });
  }
  return events;
}

export function readResourceSampleEvents(targetPath: string): ResourceSampleEvent[] {
  return filterResourceSampleEvents(readChaserTelemetryEvents(targetPath));
}

const HOUR_MS = 60 * 60 * 1000;

function bucketStartMs(ms: number, bucketMs: number): number {
  return Math.floor(ms / bucketMs) * bucketMs;
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function seriesFor(byBucket: Map<number, number[]>): TrendSeriesPoint[] {
  return [...byBucket.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, values]) => ({ periodStart: new Date(bucket).toISOString(), value: average(values) }));
}

export interface RoleResourceTrend {
  currentRssBytes: number | null;
  currentCpuPercent: number | null;
  rssSeries: TrendSeriesPoint[];
  rssTrend: TrendResult;
  cpuSeries: TrendSeriesPoint[];
  cpuTrend: TrendResult;
}

function emptyRoleTrend(): RoleResourceTrend {
  return {
    currentRssBytes: null,
    currentCpuPercent: null,
    rssSeries: [],
    rssTrend: computeTrend([]),
    cpuSeries: [],
    cpuTrend: computeTrend([]),
  };
}

function trendForRole(roleEvents: ResourceSampleEvent[], bucketMs: number): RoleResourceTrend {
  if (roleEvents.length === 0) {
    return emptyRoleTrend();
  }
  const sorted = [...roleEvents].sort((a, b) => a.atMs - b.atMs);
  const rssByBucket = new Map<number, number[]>();
  const cpuByBucket = new Map<number, number[]>();
  for (const event of sorted) {
    const bucket = bucketStartMs(event.atMs, bucketMs);
    if (!rssByBucket.has(bucket)) {
      rssByBucket.set(bucket, []);
    }
    rssByBucket.get(bucket)!.push(event.rssBytes);
    if (!cpuByBucket.has(bucket)) {
      cpuByBucket.set(bucket, []);
    }
    cpuByBucket.get(bucket)!.push(event.cpuPercent);
  }
  const latest = sorted[sorted.length - 1];
  const rssSeries = seriesFor(rssByBucket);
  const cpuSeries = seriesFor(cpuByBucket);
  return {
    currentRssBytes: latest.rssBytes,
    currentCpuPercent: latest.cpuPercent,
    rssSeries,
    rssTrend: computeTrend(rssSeries),
    cpuSeries,
    cpuTrend: computeTrend(cpuSeries),
  };
}

// Pure: a role with no samples at all (absent telemetry, or a role that
// never ran here) reads as nulls/empty series, never an error (cost-07).
export function computeResourceTrends(
  events: ResourceSampleEvent[],
  roleNames: string[],
  // nowMs is accepted for interface symmetry with the rest of the delivery
  // metrics surface (every windowed computation takes an explicit "now"),
  // though bucketing here only depends on the events' own timestamps.
  _nowMs: number,
  bucketMs: number = HOUR_MS
): Record<string, RoleResourceTrend> {
  const result: Record<string, RoleResourceTrend> = {};
  for (const role of roleNames) {
    result[role] = trendForRole(
      events.filter((e) => e.role === role),
      bucketMs
    );
  }
  return result;
}

// ── writer (thin adapter) ────────────────────────────────────────────────

function monthlyTelemetryFile(targetPath: string, atMs: number): string {
  const monthKey = new Date(atMs).toISOString().slice(0, 7); // YYYY-MM
  return path.join(chaserTelemetryDir(targetPath), `chaser-${monthKey}.jsonl`);
}

// Never throws - a telemetry write failure must not break the sampler or
// its caller (same "recording never breaks the caller" spirit as BL-078's
// appendRecord).
export function appendResourceSample(targetPath: string, role: string, rssBytes: number, cpuPercent: number, atMs: number = Date.now()): void {
  try {
    const filePath = monthlyTelemetryFile(targetPath, atMs);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const line = JSON.stringify({ type: 'resource_sample', role, rssBytes, cpuPercent, at: new Date(atMs).toISOString() });
    fs.appendFileSync(filePath, line + '\n');
  } catch {
    // swallow - telemetry recording must never break the caller
  }
}

// ── thin OS adapter + injectable sampler orchestration ──────────────────

// `ps`'s rss is reported in KB; converted to bytes for a stable unit across
// this metrics surface (matches Node's own process.memoryUsage() convention).
export function sampleProcessStats(pid: number): { rssBytes: number; cpuPercent: number } | null {
  try {
    const output = execFileSync('ps', ['-o', 'rss=,%cpu=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    const [rssKb, cpuPercent] = output.split(/\s+/).map(Number);
    if (!Number.isFinite(rssKb) || !Number.isFinite(cpuPercent)) {
      return null;
    }
    return { rssBytes: rssKb * 1024, cpuPercent };
  } catch {
    return null;
  }
}

export interface SampledRole {
  role: string;
  getPid: () => number | null;
}

const DEFAULT_SAMPLER_INTERVAL_MS = 5 * 60 * 1000;

// scheduleTick/getStats are both injectable so the orchestration (does every
// tracked role get sampled and appended on each tick, does a role with an
// unresolvable pid get skipped without throwing) is testable with a fake
// clock and fake stats - no real timer, no real OS process inspection.
export function startResourceSampler(
  targetPath: string,
  roles: SampledRole[],
  getStats: (pid: number) => { rssBytes: number; cpuPercent: number } | null = sampleProcessStats,
  scheduleTick: (fn: () => void, ms: number) => NodeJS.Timeout = setInterval,
  intervalMs: number = DEFAULT_SAMPLER_INTERVAL_MS
): NodeJS.Timeout {
  return scheduleTick(() => {
    const nowMs = Date.now();
    for (const { role, getPid } of roles) {
      const pid = getPid();
      if (pid === null) {
        continue;
      }
      const stats = getStats(pid);
      if (!stats) {
        continue;
      }
      appendResourceSample(targetPath, role, stats.rssBytes, stats.cpuPercent, nowMs);
    }
  }, intervalMs);
}

export function stopResourceSampler(intervalId: NodeJS.Timeout | null, clearTick: (handle: NodeJS.Timeout) => void = clearInterval): void {
  if (intervalId) {
    clearTick(intervalId);
  }
}
