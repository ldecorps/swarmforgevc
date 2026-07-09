import { runGitLog, deriveTicketLifecycles, TicketLifecycleEvent } from './gitHistoryAdapter';
import { computeTrend, TrendResult, TrendSeriesPoint } from './trend';
import { readBacklogFolders, BacklogFolders, BacklogItem } from '../panel/backlogReader';
import { RoleWorktree, readTestDurationRecords } from './swarmMetrics';

// BL-096: delivery-flow metrics (velocity, burndown, cycle time, forecasts)
// derived purely from git history + the current backlog/ folder state - see
// gitHistoryAdapter.ts for the git-log adapter these build on. Every
// computation below is a pure function over an already-provided
// TicketLifecycleEvent[]/BacklogItem[] - only computeDeliveryMetrics itself
// touches git/fs, so every derivation is independently unit-testable with
// fake history, no live git required (this ticket's own non-behavioral gate).

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MAX_PRIORITY = Number.MAX_SAFE_INTEGER;

function bucketStartMs(dateMs: number, bucketMs: number): number {
  return Math.floor(dateMs / bucketMs) * bucketMs;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

// ── velocity (metrics-01) ────────────────────────────────────────────────

export interface VelocityResult {
  weeklySeries: TrendSeriesPoint[];
  trend: TrendResult;
  rollingWindowCount: number;
  rollingWindowDays: number;
}

export const DEFAULT_VELOCITY_ROLLING_WINDOW_DAYS = 7;

function closedTimesMs(lifecycles: TicketLifecycleEvent[]): number[] {
  return lifecycles
    .map((l) => (l.closeDateIso !== null ? Date.parse(l.closeDateIso) : NaN))
    .filter((ms) => !Number.isNaN(ms));
}

function fillBuckets(counts: Map<number, number>, startBucket: number, endBucket: number, bucketMs: number): TrendSeriesPoint[] {
  const series: TrendSeriesPoint[] = [];
  for (let bucket = startBucket; bucket <= endBucket; bucket += bucketMs) {
    series.push({ periodStart: toIso(bucket), value: counts.get(bucket) ?? 0 });
  }
  return series;
}

export function computeVelocity(
  lifecycles: TicketLifecycleEvent[],
  nowMs: number,
  rollingWindowDays: number = DEFAULT_VELOCITY_ROLLING_WINDOW_DAYS
): VelocityResult {
  const closes = closedTimesMs(lifecycles);

  const counts = new Map<number, number>();
  for (const ms of closes) {
    const bucket = bucketStartMs(ms, WEEK_MS);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  const nowBucket = bucketStartMs(nowMs, WEEK_MS);
  const earliestBucket = counts.size > 0 ? Math.min(...counts.keys()) : nowBucket;
  const weeklySeries = fillBuckets(counts, earliestBucket, nowBucket, WEEK_MS);

  const windowStartMs = nowMs - rollingWindowDays * DAY_MS;
  const rollingWindowCount = closes.filter((ms) => ms >= windowStartMs && ms <= nowMs).length;

  return { weeklySeries, trend: computeTrend(weeklySeries), rollingWindowCount, rollingWindowDays };
}

// ── burndown (metrics-02) ────────────────────────────────────────────────

export interface MilestoneBurndownResult {
  milestone: string;
  dailySeries: TrendSeriesPoint[];
  trend: TrendResult;
  currentRemaining: number;
}

function isRemainingOnDay(member: TicketLifecycleEvent, dayEndMs: number): boolean {
  const specMs = Date.parse(member.specDateIso);
  if (Number.isNaN(specMs) || specMs >= dayEndMs) {
    return false; // not yet specced by this day
  }
  if (member.closeDateIso === null) {
    return true;
  }
  const closeMs = Date.parse(member.closeDateIso);
  return Number.isNaN(closeMs) || closeMs >= dayEndMs;
}

function burndownForMilestone(milestone: string, members: TicketLifecycleEvent[], nowMs: number): MilestoneBurndownResult | null {
  const specTimes = members.map((m) => Date.parse(m.specDateIso)).filter((ms) => !Number.isNaN(ms));
  if (specTimes.length === 0) {
    return null;
  }
  const earliestDay = bucketStartMs(Math.min(...specTimes), DAY_MS);
  const nowDay = bucketStartMs(nowMs, DAY_MS);

  const dailySeries: TrendSeriesPoint[] = [];
  for (let day = earliestDay; day <= nowDay; day += DAY_MS) {
    const remaining = members.filter((m) => isRemainingOnDay(m, day + DAY_MS)).length;
    dailySeries.push({ periodStart: toIso(day), value: remaining });
  }

  const currentRemaining = members.filter((m) => m.closeDateIso === null).length;
  return { milestone, dailySeries, trend: computeTrend(dailySeries), currentRemaining };
}

// Pure: reconstructs each milestone's remaining-count-over-time from the
// milestone's currently-existing member tickets (per milestoneByTicketId,
// built from the live backlog/ folder state), so the final daily point
// always matches that current state by construction.
export function computeBurndown(
  lifecycles: TicketLifecycleEvent[],
  milestoneByTicketId: Map<string, string>,
  nowMs: number
): MilestoneBurndownResult[] {
  const byMilestone = new Map<string, TicketLifecycleEvent[]>();
  for (const lifecycle of lifecycles) {
    const milestone = milestoneByTicketId.get(lifecycle.ticketId);
    if (!milestone) {
      continue;
    }
    if (!byMilestone.has(milestone)) {
      byMilestone.set(milestone, []);
    }
    byMilestone.get(milestone)!.push(lifecycle);
  }

  const results: MilestoneBurndownResult[] = [];
  for (const [milestone, members] of byMilestone) {
    const result = burndownForMilestone(milestone, members, nowMs);
    if (result) {
      results.push(result);
    }
  }
  return results.sort((a, b) => a.milestone.localeCompare(b.milestone));
}

// ── cycle time (metrics-03) ──────────────────────────────────────────────

export interface CycleTimeResult {
  medianMs: number | null;
  p85Ms: number | null;
  sampleCount: number;
  weeklySeries: TrendSeriesPoint[];
  trend: TrendResult;
}

export const DEFAULT_CYCLE_TIME_RECENT_WINDOW = 20;

// Linear-interpolated percentile over an already-sorted-ascending array,
// matching the conventional "R-7"/Excel PERCENTILE.INC method.
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }
  const rank = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) {
    return sortedValues[lower];
  }
  const frac = rank - lower;
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * frac;
}

interface ClosedDuration {
  closeMs: number;
  durationMs: number;
}

function closedDurations(lifecycles: TicketLifecycleEvent[]): ClosedDuration[] {
  return lifecycles
    .filter((l): l is TicketLifecycleEvent & { closeDateIso: string } => l.closeDateIso !== null)
    .map((l) => ({ closeMs: Date.parse(l.closeDateIso), durationMs: Date.parse(l.closeDateIso) - Date.parse(l.specDateIso) }))
    .filter((c) => !Number.isNaN(c.closeMs) && !Number.isNaN(c.durationMs) && c.durationMs >= 0)
    .sort((a, b) => b.closeMs - a.closeMs);
}

function weeklyMedianSeries(closed: ClosedDuration[]): TrendSeriesPoint[] {
  const byWeek = new Map<number, number[]>();
  for (const c of closed) {
    const bucket = bucketStartMs(c.closeMs, WEEK_MS);
    if (!byWeek.has(bucket)) {
      byWeek.set(bucket, []);
    }
    byWeek.get(bucket)!.push(c.durationMs);
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, durations]) => ({
      periodStart: toIso(bucket),
      value: percentile([...durations].sort((a, b) => a - b), 50),
    }));
}

export function computeCycleTime(
  lifecycles: TicketLifecycleEvent[],
  nowMs: number,
  recentWindow: number = DEFAULT_CYCLE_TIME_RECENT_WINDOW
): CycleTimeResult {
  const closed = closedDurations(lifecycles);
  const recent = closed.slice(0, recentWindow);

  if (recent.length === 0) {
    return { medianMs: null, p85Ms: null, sampleCount: 0, weeklySeries: [], trend: computeTrend([]) };
  }

  const sortedDurations = recent.map((c) => c.durationMs).sort((a, b) => a - b);
  const weeklySeries = weeklyMedianSeries(closed);

  return {
    medianMs: percentile(sortedDurations, 50),
    p85Ms: percentile(sortedDurations, 85),
    sampleCount: recent.length,
    weeklySeries,
    trend: computeTrend(weeklySeries),
  };
}

// ── forecasts (metrics-08) ───────────────────────────────────────────────

export interface OpenTicketInput {
  ticketId: string;
  milestone?: string;
  priority?: number;
  dependsOn?: string[];
}

export interface TicketForecast {
  ticketId: string;
  p50Iso: string | null;
  p85Iso: string | null;
}

export interface MilestoneForecast {
  milestone: string;
  p50Iso: string | null;
  p85Iso: string | null;
}

export interface ForecastResult {
  tickets: TicketForecast[];
  milestones: MilestoneForecast[];
  throughputPerDay: number;
}

export const DEFAULT_FORECAST_THROUGHPUT_WINDOW_DAYS = 30;

// depends_on in live ticket YAML is not consistently strict-list syntax
// (bracket lists, bare single ids, and bare comma-separated ids with
// trailing prose in parens all occur - see backlogReader.ts's own dual-path
// parser for the same reason). Split every entry on commas, then pull the
// leading BL-NNN-shaped token out of whatever prose surrounds it.
function normalizeDependsOnEntry(entry: string): string[] {
  return entry
    .split(',')
    .map((piece) => piece.match(/([A-Za-z]+-\d+)/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1]);
}

function normalizeDependsOn(dependsOn: string[] | undefined): string[] {
  return dependsOn ? dependsOn.flatMap(normalizeDependsOnEntry) : [];
}

// Trailing-window throughput (closes/day); falls back to lifetime throughput
// when the trailing window itself had no closes, rather than reporting a
// divide-by-zero (or a zero-throughput, infinite-ETA) forecast during a
// quiet period that followed an otherwise productive history.
function computeThroughputPerDay(lifecycles: TicketLifecycleEvent[], nowMs: number, windowDays: number): number {
  const windowStartMs = nowMs - windowDays * DAY_MS;
  const allCloseTimes = closedTimesMs(lifecycles);
  const closesInWindow = allCloseTimes.filter((ms) => ms >= windowStartMs && ms <= nowMs).length;
  if (closesInWindow > 0) {
    return closesInWindow / windowDays;
  }
  if (allCloseTimes.length === 0) {
    return 0;
  }
  const earliestCloseMs = Math.min(...allCloseTimes);
  const lifetimeDays = Math.max(1, (nowMs - earliestCloseMs) / DAY_MS);
  return allCloseTimes.length / lifetimeDays;
}

function queueOrder(openTickets: OpenTicketInput[]): OpenTicketInput[] {
  return [...openTickets].sort((a, b) => {
    const pa = a.priority ?? MAX_PRIORITY;
    const pb = b.priority ?? MAX_PRIORITY;
    return pa !== pb ? pa - pb : a.ticketId.localeCompare(b.ticketId);
  });
}

interface ForecastMs {
  p50: number;
  p85: number;
}

function naiveForecast(position: number, throughputPerDay: number, cycleTimeP50Ms: number, cycleTimeP85Ms: number, nowMs: number): ForecastMs {
  const queueDelayDays = throughputPerDay > 0 ? position / throughputPerDay : Number.POSITIVE_INFINITY;
  const queueDelayMs = Number.isFinite(queueDelayDays) ? queueDelayDays * DAY_MS : Number.POSITIVE_INFINITY;
  return { p50: nowMs + queueDelayMs + cycleTimeP50Ms, p85: nowMs + queueDelayMs + cycleTimeP85Ms };
}

// Relaxes one ticket's forecast to the max of its own current dates and its
// dependencies' current dates; returns whether it changed. Split out of
// applyDependencyConstraints so each function stays under the CRAP<=6 gate.
function relaxTicketForecast(ticketId: string, dependsOnIds: string[], finalById: Map<string, ForecastMs>): boolean {
  const current = finalById.get(ticketId)!;
  let maxP50 = current.p50;
  let maxP85 = current.p85;
  for (const depId of dependsOnIds) {
    const dep = finalById.get(depId);
    if (!dep) {
      continue; // already closed, or an unknown id - no constraint
    }
    maxP50 = Math.max(maxP50, dep.p50);
    maxP85 = Math.max(maxP85, dep.p85);
  }
  if (maxP50 === current.p50 && maxP85 === current.p85) {
    return false;
  }
  finalById.set(ticketId, { p50: maxP50, p85: maxP85 });
  return true;
}

// A ticket's forecast must never precede any of its own depends_on tickets'
// forecasts. Resolved via bounded relaxation (repeatedly taking the max of
// each ticket's own naive date and its dependencies' current dates) rather
// than a strict topological sort, so malformed/cyclic depends_on data
// degrades gracefully (the pass cap bounds it) instead of throwing.
function applyDependencyConstraints(
  queue: OpenTicketInput[],
  naiveById: Map<string, ForecastMs>
): Map<string, ForecastMs> {
  const dependsOnById = new Map(queue.map((t) => [t.ticketId, normalizeDependsOn(t.dependsOn)]));
  const finalById = new Map(naiveById);

  for (let pass = 0; pass < queue.length + 1; pass++) {
    let changed = false;
    for (const t of queue) {
      if (relaxTicketForecast(t.ticketId, dependsOnById.get(t.ticketId) ?? [], finalById)) {
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  return finalById;
}

function forecastToIso(ms: number): string | null {
  return Number.isFinite(ms) ? toIso(ms) : null;
}

function milestoneForecasts(queue: OpenTicketInput[], tickets: TicketForecast[]): MilestoneForecast[] {
  const byId = new Map(tickets.map((t) => [t.ticketId, t]));
  const groups = new Map<string, TicketForecast[]>();
  for (const t of queue) {
    if (!t.milestone) {
      continue;
    }
    if (!groups.has(t.milestone)) {
      groups.set(t.milestone, []);
    }
    groups.get(t.milestone)!.push(byId.get(t.ticketId)!);
  }

  const latestIso = (forecasts: TicketForecast[], key: 'p50Iso' | 'p85Iso'): string | null => {
    const times = forecasts.map((f) => (f[key] ? Date.parse(f[key] as string) : NaN)).filter((ms) => !Number.isNaN(ms));
    return times.length > 0 ? toIso(Math.max(...times)) : null;
  };

  return [...groups.entries()]
    .map(([milestone, forecasts]) => ({
      milestone,
      p50Iso: latestIso(forecasts, 'p50Iso'),
      p85Iso: latestIso(forecasts, 'p85Iso'),
    }))
    .sort((a, b) => a.milestone.localeCompare(b.milestone));
}

// Method: trailing-window throughput + the historical cycle-time
// distribution, applied to the current queue order (priority ascending,
// depends_on-aware). Count-based estimates, not false-precision single
// dates - every ticket reports both p50 and p85.
export function computeForecasts(
  lifecycles: TicketLifecycleEvent[],
  openTickets: OpenTicketInput[],
  nowMs: number,
  throughputWindowDays: number = DEFAULT_FORECAST_THROUGHPUT_WINDOW_DAYS
): ForecastResult {
  const cycleTime = computeCycleTime(lifecycles, nowMs);
  const cycleTimeP50Ms = cycleTime.medianMs ?? 0;
  const cycleTimeP85Ms = cycleTime.p85Ms ?? 0;
  const throughputPerDay = computeThroughputPerDay(lifecycles, nowMs, throughputWindowDays);

  const queue = queueOrder(openTickets);
  const naiveById = new Map<string, ForecastMs>();
  queue.forEach((t, index) => {
    naiveById.set(t.ticketId, naiveForecast(index + 1, throughputPerDay, cycleTimeP50Ms, cycleTimeP85Ms, nowMs));
  });

  const finalById = applyDependencyConstraints(queue, naiveById);
  const tickets: TicketForecast[] = queue.map((t) => {
    const dates = finalById.get(t.ticketId)!;
    return { ticketId: t.ticketId, p50Iso: forecastToIso(dates.p50), p85Iso: forecastToIso(dates.p85) };
  });

  return { tickets, milestones: milestoneForecasts(queue, tickets), throughputPerDay };
}

// ── suite duration trend (metrics-07) ───────────────────────────────────

export interface SuiteDurationTrendResult {
  hasLocalData: boolean;
  dailySeries: TrendSeriesPoint[];
  trend: TrendResult;
}

export function computeSuiteDurationTrend(targetPath: string, roles: RoleWorktree[], nowMs: number): SuiteDurationTrendResult {
  const worktreePaths = new Set<string>([targetPath, ...roles.map((r) => r.worktreePath)]);
  const allRecords = [...worktreePaths].flatMap(readTestDurationRecords);

  if (allRecords.length === 0) {
    return { hasLocalData: false, dailySeries: [], trend: computeTrend([]) };
  }

  const byDay = new Map<number, number[]>();
  for (const record of allRecords) {
    const bucket = bucketStartMs(record.finishedAtMs, DAY_MS);
    if (!byDay.has(bucket)) {
      byDay.set(bucket, []);
    }
    byDay.get(bucket)!.push(record.durationMs);
  }
  const dailySeries = [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, durations]) => ({
      periodStart: toIso(bucket),
      value: durations.reduce((sum, d) => sum + d, 0) / durations.length,
    }));

  return { hasLocalData: true, dailySeries, trend: computeTrend(dailySeries) };
}

// ── top-level aggregator ─────────────────────────────────────────────────

export interface DeliveryMetrics {
  velocity: VelocityResult;
  burndown: MilestoneBurndownResult[];
  cycleTime: CycleTimeResult;
  forecasts: ForecastResult;
  suiteDurationTrend: SuiteDurationTrendResult;
}

function flattenBacklogItems(folders: BacklogFolders): BacklogItem[] {
  return [...folders.active, ...folders.paused, ...folders.done];
}

function toOpenTicketInput(item: BacklogItem): OpenTicketInput {
  return { ticketId: item.id, milestone: item.milestone, priority: item.priority, dependsOn: item.dependsOn };
}

// The one impure entry point: shells out to git once (via runGitLog) and
// reads the current backlog/ folder state once, then delegates to the pure
// functions above. Read-only throughout (git log + fs reads only), so
// running this twice with no intervening git changes creates or modifies
// nothing (metrics-05).
export function computeDeliveryMetrics(targetPath: string, roles: RoleWorktree[], nowMs: number = Date.now()): DeliveryMetrics {
  const lifecycles = [...deriveTicketLifecycles(runGitLog(targetPath, 'backlog')).values()];

  const folders = readBacklogFolders(targetPath);
  const milestoneByTicketId = new Map<string, string>();
  for (const item of flattenBacklogItems(folders)) {
    if (item.milestone) {
      milestoneByTicketId.set(item.id, item.milestone);
    }
  }
  const openTickets = [...folders.active, ...folders.paused].map(toOpenTicketInput);

  return {
    velocity: computeVelocity(lifecycles, nowMs),
    burndown: computeBurndown(lifecycles, milestoneByTicketId, nowMs),
    cycleTime: computeCycleTime(lifecycles, nowMs),
    forecasts: computeForecasts(lifecycles, openTickets, nowMs),
    suiteDurationTrend: computeSuiteDurationTrend(targetPath, roles, nowMs),
  };
}
