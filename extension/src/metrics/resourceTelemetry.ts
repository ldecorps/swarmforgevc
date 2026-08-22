import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { chaserTelemetryDir, readChaserTelemetryEvents, ChaserTelemetryEvent } from './swarmMetrics';
import { computeTrend, TrendResult, TrendSeriesPoint } from './trend';
import { readConfigValue } from '../util/swarmforgeConfig';

// BL-100 cost-04: CPU/RAM per role, sampled on a slow timer and folded into
// the BL-096 trend framework. resource_sample events join the existing
// BL-098 chaser-*.jsonl monthly telemetry family (its reader already
// tolerates unknown `type` values) rather than inventing a second file
// convention.
//
// BL-847 decision: samples recorded before that fix measured the pane's
// root shell, not the agent (~3 orders of magnitude off) - existing
// chaser-*.jsonl history is left as-is rather than tagged, so a trend
// series that spans the fix will show one discontinuity at the deploy
// point. Deliberate: retroactively tagging old samples would require
// guessing at a cutover time from outside the data itself.

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

// BL-350: exported (was DEFAULT_SAMPLER_INTERVAL_MS's own private const) so
// the headless CLI entrypoint can gate its own sampling cadence against the
// SAME interval the host-side setInterval sampler uses below - one shared
// notion of "how often is a sample due", not two independently-tuned ones.
export const DEFAULT_SAMPLER_INTERVAL_MS = 5 * 60 * 1000;

// BL-350: one sampling tick, extracted out of startResourceSampler's
// setInterval closure so a headless caller (no VS Code host, no timer) can
// invoke exactly the same tracked-roles-> pid -> stats -> append sequence
// on demand. Returns the count of roles actually sampled (a role whose pid
// or stats could not be resolved is skipped, not counted) so a caller can
// report what happened without re-deriving it.
//
// BL-822: also records a host-load sample on this SAME tick, independently
// of whether any role's pid resolved - the day a host is on fire but every
// role pid happens to be unresolvable is exactly the day this signal must
// not go silent (implementation shape 2). Both callers of this function
// (the host-side setInterval sampler and the headless CLI) get host-load
// coverage for free from this one shared tick, same as role sampling does.
export function sampleRolesOnce(
  targetPath: string,
  roles: SampledRole[],
  getStats: (pid: number) => { rssBytes: number; cpuPercent: number } | null = sampleProcessStats,
  nowMs: number = Date.now(),
  getHostLoadRatio: () => number | null = sampleHostLoadRatio
): number {
  const hostLoadRatio = getHostLoadRatio();
  if (hostLoadRatio !== null) {
    appendHostLoadSample(targetPath, hostLoadRatio, nowMs);
  }
  let sampledCount = 0;
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
    sampledCount++;
  }
  return sampledCount;
}

// Pure: the latest recorded sample's timestamp across every role, or null
// when no samples exist yet. Used to decide whether a sampling interval is
// still covered by an already-recorded sample (BL-350's headless/host
// dedup) without caring which caller wrote it.
export function latestSampleAtMs(events: ResourceSampleEvent[]): number | null {
  if (events.length === 0) {
    return null;
  }
  return events.reduce((max, e) => Math.max(max, e.atMs), -Infinity);
}

// Pure: true when enough time has passed since the last recorded sample
// (or none was ever recorded) that a new one is due. BL-350: shared by the
// headless CLI to skip sampling when the host-side sampler (an editor
// attached) already covered this interval - and vice versa, since neither
// caller knows about the other beyond this shared telemetry file.
export function shouldSampleThisInterval(
  lastSampleAtMs: number | null,
  nowMs: number,
  intervalMs: number = DEFAULT_SAMPLER_INTERVAL_MS
): boolean {
  return lastSampleAtMs === null || nowMs - lastSampleAtMs >= intervalMs;
}

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
    sampleRolesOnce(targetPath, roles, getStats, Date.now());
  }, intervalMs);
}

export function stopResourceSampler(intervalId: NodeJS.Timeout | null, clearTick: (handle: NodeJS.Timeout) => void = clearInterval): void {
  if (intervalId) {
    clearTick(intervalId);
  }
}

// ── host load (BL-822) ───────────────────────────────────────────────────
//
// Additive alongside per-role resource samples: host load average is a
// distinct signal, never folded into resourceAnomalies (see
// costHealthSidecar.ts's CostHealthSidecar.hostLoad for why - a
// ResourceAnomaly always carries {role, rssBytes}, and the static PWA
// renders those fields unconditionally; a role-less host measurement has
// neither).

export interface HostLoadSampleEvent {
  ratio: number;
  atMs: number;
}

// host_load_sample rows join the SAME chaser-*.jsonl family resource_sample
// rows already use (readChaserTelemetryEvents's reader already tolerates
// unknown `type` values). That reader's line parser still requires every
// row to carry a `role: string`, and a host-wide measurement has none -
// this sentinel satisfies the shared shape without claiming to BE a role.
// Safe: every consumer of readChaserTelemetryEvents switches on `type`
// first (chaserCountField/RELIABILITY_EVENT_TYPE_TO_FIELD), so an
// unrecognized type's sentinel role never reaches a real role's counts.
const HOST_LOAD_EVENT_ROLE = 'host';

export function filterHostLoadSampleEvents(rawEvents: ChaserTelemetryEvent[]): HostLoadSampleEvent[] {
  const events: HostLoadSampleEvent[] = [];
  for (const raw of rawEvents) {
    if (raw.type !== 'host_load_sample') {
      continue;
    }
    const unknownRaw = raw as unknown as Record<string, unknown>;
    const ratio = Number(unknownRaw.ratio);
    const atMs = Date.parse(raw.at);
    if (!Number.isFinite(ratio) || Number.isNaN(atMs)) {
      continue;
    }
    events.push({ ratio, atMs });
  }
  return events;
}

export function readHostLoadSampleEvents(targetPath: string): HostLoadSampleEvent[] {
  return filterHostLoadSampleEvents(readChaserTelemetryEvents(targetPath));
}

// Never throws - same "recording never breaks the caller" posture as
// appendResourceSample above. Must NOT touch resourceSamplesObserved (BL-822
// invariant 3): this writes a host_load_sample row, never a resource_sample
// one, so filterResourceSampleEvents (which only matches 'resource_sample')
// never sees it.
export function appendHostLoadSample(targetPath: string, ratio: number, atMs: number = Date.now()): void {
  try {
    const filePath = monthlyTelemetryFile(targetPath, atMs);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const line = JSON.stringify({ type: 'host_load_sample', role: HOST_LOAD_EVENT_ROLE, ratio, at: new Date(atMs).toISOString() });
    fs.appendFileSync(filePath, line + '\n');
  } catch {
    // swallow - telemetry recording must never break the caller
  }
}

// Thin OS adapter, injectable (loadavg1m/cpuCount) so the ratio computation
// is testable without a real host - same posture as sampleProcessStats
// above. Returns null when either reading is unusable (e.g. zero reported
// cores) rather than a fabricated ratio.
export function sampleHostLoadRatio(loadavg1m: () => number = () => os.loadavg()[0], cpuCount: () => number = () => os.cpus().length): number | null {
  try {
    const load1 = loadavg1m();
    const cores = cpuCount();
    if (!Number.isFinite(load1) || !Number.isFinite(cores) || cores <= 0) {
      return null;
    }
    return load1 / cores;
  } catch {
    return null;
  }
}

// BL-822 ruling 2: deliberately above mutation_cooldown_lib.bb's
// mutation_busy_load_multiplier default of 2 - "too busy to START mutation
// testing" is a lower bar than "this day was resource abnormal", and the
// two dials must not drift into contradiction.
export const DEFAULT_HOST_LOAD_SEVERE_RATIO = 4;
export const DEFAULT_HOST_LOAD_SUSTAINED_MINUTES = 15;

function parsePositiveNumber(raw: string | undefined): number | null {
  if (raw === undefined) {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Read fresh at decision time (never cached) - same `config <key> <value>,
// read fresh` posture as mutation_busy_load_multiplier. Absent/malformed
// degrades to the code default rather than throwing.
export function hostLoadSevereRatioThreshold(targetPath: string): number {
  return parsePositiveNumber(readConfigValue(targetPath, 'host_load_severe_ratio')) ?? DEFAULT_HOST_LOAD_SEVERE_RATIO;
}

export function hostLoadSustainedMs(targetPath: string): number {
  const minutes = parsePositiveNumber(readConfigValue(targetPath, 'host_load_sustained_minutes')) ?? DEFAULT_HOST_LOAD_SUSTAINED_MINUTES;
  return minutes * 60_000;
}

export interface HostLoadVerdict {
  severe: boolean;
  ratio: number | null;
  sustainedMinutes: number;
}

// Pure: "severe" requires BOTH a ratio past the threshold AND that ratio
// having held for the sustained window (BL-822 ruling 2) - a single spike
// clears the ratio dial but not the duration one, and a long ordinary-load
// stretch clears duration but not ratio. matchingSampleCount walks backward
// from the most recent sample so a stale spike earlier in the log cannot
// retroactively mark the CURRENT state severe once load has come back down;
// expressed as matchingSampleCount * samplingIntervalMs against the
// sustained-window dial (not a hardcoded sample count) so the dial keeps
// its meaning if DEFAULT_SAMPLER_INTERVAL_MS ever changes.
export function computeHostLoadVerdict(
  events: HostLoadSampleEvent[],
  severeRatioThreshold: number = DEFAULT_HOST_LOAD_SEVERE_RATIO,
  sustainedMs: number = DEFAULT_HOST_LOAD_SUSTAINED_MINUTES * 60_000,
  samplingIntervalMs: number = DEFAULT_SAMPLER_INTERVAL_MS
): HostLoadVerdict {
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);
  let matchingSampleCount = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].ratio < severeRatioThreshold) {
      break;
    }
    matchingSampleCount++;
  }
  return {
    severe: matchingSampleCount > 0 && matchingSampleCount * samplingIntervalMs >= sustainedMs,
    ratio: sorted.length > 0 ? sorted[sorted.length - 1].ratio : null,
    sustainedMinutes: (matchingSampleCount * samplingIntervalMs) / 60_000,
  };
}
