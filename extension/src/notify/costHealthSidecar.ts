import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';
import { commitScopedFile } from '../util/gitCommitScopedFile';
import { computeTrend, TrendResult, TrendSeriesPoint } from '../metrics/trend';
import { computeCostTelemetry, RoleCostTelemetry } from '../metrics/costTelemetry';
import { readResourceSampleEvents, computeResourceTrends, RoleResourceTrend } from '../metrics/resourceTelemetry';
import { RoleWorktree, readChaserTelemetryEvents, ChaserTelemetryEvent } from '../metrics/swarmMetrics';
import { runGitLog, deriveTicketLifecycles, TicketLifecycleEvent } from '../metrics/gitHistoryAdapter';
import { computeSuiteDurationTrend, SuiteDurationTrendResult } from '../metrics/deliveryMetrics';
import { computeCostPerTicketSeries, CostPerTicketSeriesResult, COST_PER_TICKET_BASIS } from '../metrics/costPerTicket';

// BL-213: the daily cost & health sidecar - a deterministic, committed
// carrier (docs/briefings/<date>.json) for BL-100's producers, never
// hand-written by the LLM. buildCostHealthSidecar/renderCostHealthSection
// are pure over already-computed inputs; computeCostHealthSidecar is the
// one impure orchestrator wiring the real BL-100/BL-096 producers together;
// writeCostHealthSidecar/commitCostHealthSidecar are thin, scoped fs/git
// adapters (commit touches ONLY the sidecar file, never a broader `git add`).

export const COST_HEALTH_SIDECAR_SCHEMA_VERSION = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

function bucketStartMs(ms: number, bucketMs: number): number {
  return Math.floor(ms / bucketMs) * bucketMs;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

export interface TrendedNumber {
  value: number;
  trend: TrendResult;
}

export interface AgentDailyCost {
  role: string;
  tokens: TrendedNumber;
  costUsd: TrendedNumber | null;
}

export interface ExpensiveTicket {
  ticketId: string;
  costUsd: number;
}

// BL-338: additive - see costPerTicket.ts for the honesty properties this
// carries (rework included, unpriced tickets excluded not zeroed). `basis`
// rides on the data itself (not left to prose alone) so every surface that
// renders this figure - PWA, briefing email - shows the SAME accounting
// statement without re-deriving or re-typing it.
export interface CostPerTicketSummary {
  average: TrendedNumber | null;
  sampleCount: number;
  excludedCount: number;
  series: TrendSeriesPoint[];
  basis: string;
}

export interface ReliabilityCounts {
  chases: TrendedNumber;
  nudges: TrendedNumber;
  respawns: TrendedNumber;
  failedDeliveries: TrendedNumber;
  // BL-213: always zero - no daemon-restart telemetry event type exists in
  // the current chaser-*.jsonl schema (chase|nudge|dead-letter|respawn
  // only). A real, deterministic zero (nothing recorded), not a fabricated
  // figure - filled in once that event type exists.
  daemonRestarts: TrendedNumber;
}

export interface ResourceAnomaly {
  role: string;
  rssBytes: number;
  cpuPercent: number;
  rssTrend: TrendResult;
  cpuTrend: TrendResult;
}

export interface CostHealthSidecar {
  schemaVersion: number;
  dateIso: string;
  agents: AgentDailyCost[];
  topExpensiveTickets: ExpensiveTicket[];
  flowBalance: { speccedPerDay: TrendedNumber; closedPerDay: TrendedNumber };
  reliability: ReliabilityCounts;
  resourceAnomalies: ResourceAnomaly[];
  // BL-290: additive, optional - suite-test duration is machine-local/
  // gitignored (deliveryMetrics.ts's own computeSuiteDurationTrend reads
  // it live), so this committed snapshot is the ONLY way it can ever reach
  // a git-derived projection like backlog.json. Absent when the emitting
  // sidecar predates this ticket; schemaVersion stays unchanged either way
  // since this is purely additive, same posture as every other field here.
  suiteDurationTrend?: SuiteDurationTrendResult;
  // BL-338: additive, optional - a sidecar committed before this ticket
  // carries no such field, same "purely additive, schemaVersion unchanged"
  // posture as suiteDurationTrend above.
  costPerTicket?: CostPerTicketSummary;
}

// ── daily bucketing (pure) ───────────────────────────────────────────────

function fillDailyBuckets(counts: Map<number, number>, nowMs: number): TrendSeriesPoint[] {
  const nowDay = bucketStartMs(nowMs, DAY_MS);
  const earliestDay = counts.size > 0 ? Math.min(...counts.keys()) : nowDay;
  const series: TrendSeriesPoint[] = [];
  for (let day = earliestDay; day <= nowDay; day += DAY_MS) {
    series.push({ periodStart: toIso(day), value: counts.get(day) ?? 0 });
  }
  return series;
}

// Increments the day-bucket count for one ISO date, or does nothing if the
// date is absent/unparsable. Split out of bucketDailyFlowBalance so each
// function stays under the CRAP<=6 gate.
function incrementDateBucket(counts: Map<number, number>, dateIso: string | null | undefined): void {
  if (!dateIso) {
    return;
  }
  const ms = Date.parse(dateIso);
  if (Number.isNaN(ms)) {
    return;
  }
  const bucket = bucketStartMs(ms, DAY_MS);
  counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
}

// Pure: daily specced-vs-closed ticket counts, gap-filled so trend
// comparisons are always adjacent-day (mirrors deliveryMetrics.ts's own
// computeVelocity bucketing convention, but daily and covering both spec
// and close dates in one pass).
export function bucketDailyFlowBalance(
  lifecycles: TicketLifecycleEvent[],
  nowMs: number
): { speccedSeries: TrendSeriesPoint[]; closedSeries: TrendSeriesPoint[] } {
  const speccedCounts = new Map<number, number>();
  const closedCounts = new Map<number, number>();
  for (const lifecycle of lifecycles) {
    incrementDateBucket(speccedCounts, lifecycle.specDateIso);
    incrementDateBucket(closedCounts, lifecycle.closeDateIso);
  }
  return { speccedSeries: fillDailyBuckets(speccedCounts, nowMs), closedSeries: fillDailyBuckets(closedCounts, nowMs) };
}

export interface DailyReliabilitySeries {
  chases: TrendSeriesPoint[];
  nudges: TrendSeriesPoint[];
  respawns: TrendSeriesPoint[];
  failedDeliveries: TrendSeriesPoint[];
}

type ReliabilityField = keyof DailyReliabilitySeries;

const RELIABILITY_EVENT_TYPE_TO_FIELD: Record<string, ReliabilityField> = {
  chase: 'chases',
  nudge: 'nudges',
  respawn: 'respawns',
  'dead-letter': 'failedDeliveries',
};

// Pure: daily per-type reliability event counts, gap-filled. Unrecognized
// event types (e.g. resource_sample, which shares the same telemetry file
// family) are ignored, not rejected.
export function bucketDailyReliabilityEvents(events: ChaserTelemetryEvent[], nowMs: number): DailyReliabilitySeries {
  const countsByField: Record<ReliabilityField, Map<number, number>> = {
    chases: new Map(),
    nudges: new Map(),
    respawns: new Map(),
    failedDeliveries: new Map(),
  };
  for (const event of events) {
    const field = RELIABILITY_EVENT_TYPE_TO_FIELD[event.type];
    if (!field) {
      continue;
    }
    const atMs = Date.parse(event.at);
    if (Number.isNaN(atMs)) {
      continue;
    }
    const bucket = bucketStartMs(atMs, DAY_MS);
    countsByField[field].set(bucket, (countsByField[field].get(bucket) ?? 0) + 1);
  }
  return {
    chases: fillDailyBuckets(countsByField.chases, nowMs),
    nudges: fillDailyBuckets(countsByField.nudges, nowMs),
    respawns: fillDailyBuckets(countsByField.respawns, nowMs),
    failedDeliveries: fillDailyBuckets(countsByField.failedDeliveries, nowMs),
  };
}

// ── pure sidecar assembly ────────────────────────────────────────────────

function trendedFromSeries(series: TrendSeriesPoint[]): TrendedNumber {
  return { value: series.length > 0 ? series[series.length - 1].value : 0, trend: computeTrend(series) };
}

function latestAgentDailyCost(role: string, roleCostTelemetry: RoleCostTelemetry | undefined): AgentDailyCost {
  const days = roleCostTelemetry ? Object.entries(roleCostTelemetry.byDay).sort(([a], [b]) => a.localeCompare(b)) : [];
  const tokenSeries: TrendSeriesPoint[] = days.map(([day, d]) => ({
    periodStart: day,
    value: d.usage.inputTokens + d.usage.outputTokens,
  }));
  const anyPriced = days.some(([, d]) => d.costUsd !== null);
  const costSeries: TrendSeriesPoint[] = days.map(([day, d]) => ({ periodStart: day, value: d.costUsd ?? 0 }));

  return {
    role,
    tokens: trendedFromSeries(tokenSeries),
    costUsd: anyPriced ? trendedFromSeries(costSeries) : null,
  };
}

function computeTopExpensiveTickets(costTelemetryByRole: Record<string, RoleCostTelemetry>, topN: number): ExpensiveTicket[] {
  const totals = new Map<string, number>();
  for (const roleTelemetry of Object.values(costTelemetryByRole)) {
    for (const [ticketId, attributed] of Object.entries(roleTelemetry.byTicket)) {
      if (ticketId === 'unattributed') {
        continue;
      }
      totals.set(ticketId, (totals.get(ticketId) ?? 0) + (attributed.costUsd ?? 0));
    }
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([ticketId, costUsd]) => ({ ticketId, costUsd }));
}

// A role's resource usage counts as an anomaly only once it has actually
// moved (not flat/unknown) by at least this fraction of its prior value -
// otherwise every role with any data at all would always appear.
const RESOURCE_ANOMALY_THRESHOLD = 0.1;

function isAnomalousTrend(trend: TrendResult): boolean {
  if (trend.direction === 'flat' || trend.direction === 'unknown') {
    return false;
  }
  if (trend.priorValue === null || trend.priorValue === 0 || trend.delta === null) {
    return false;
  }
  return Math.abs(trend.delta / trend.priorValue) >= RESOURCE_ANOMALY_THRESHOLD;
}

function computeResourceAnomalies(resourceTrendsByRole: Record<string, RoleResourceTrend>): ResourceAnomaly[] {
  const anomalies: ResourceAnomaly[] = [];
  for (const [role, trend] of Object.entries(resourceTrendsByRole)) {
    if (trend.currentRssBytes === null || trend.currentCpuPercent === null) {
      continue;
    }
    if (isAnomalousTrend(trend.rssTrend) || isAnomalousTrend(trend.cpuTrend)) {
      anomalies.push({
        role,
        rssBytes: trend.currentRssBytes,
        cpuPercent: trend.currentCpuPercent,
        rssTrend: trend.rssTrend,
        cpuTrend: trend.cpuTrend,
      });
    }
  }
  return anomalies;
}

const DEFAULT_TOP_EXPENSIVE_TICKETS = 5;

// Pure: assembles the full sidecar from already-computed BL-100/BL-096
// producer outputs and already-bucketed daily series - only
// computeCostHealthSidecar below touches git/fs.
export function buildCostHealthSidecar(
  dateIso: string,
  costTelemetryByRole: Record<string, RoleCostTelemetry>,
  resourceTrendsByRole: Record<string, RoleResourceTrend>,
  reliabilityDailySeries: DailyReliabilitySeries,
  speccedSeries: TrendSeriesPoint[],
  closedSeries: TrendSeriesPoint[],
  topN: number = DEFAULT_TOP_EXPENSIVE_TICKETS,
  suiteDurationTrend?: SuiteDurationTrendResult,
  costPerTicketSeries?: CostPerTicketSeriesResult
): CostHealthSidecar {
  const sidecar: CostHealthSidecar = {
    schemaVersion: COST_HEALTH_SIDECAR_SCHEMA_VERSION,
    dateIso,
    agents: Object.keys(costTelemetryByRole).map((role) => latestAgentDailyCost(role, costTelemetryByRole[role])),
    topExpensiveTickets: computeTopExpensiveTickets(costTelemetryByRole, topN),
    flowBalance: {
      speccedPerDay: trendedFromSeries(speccedSeries),
      closedPerDay: trendedFromSeries(closedSeries),
    },
    reliability: {
      chases: trendedFromSeries(reliabilityDailySeries.chases),
      nudges: trendedFromSeries(reliabilityDailySeries.nudges),
      respawns: trendedFromSeries(reliabilityDailySeries.respawns),
      failedDeliveries: trendedFromSeries(reliabilityDailySeries.failedDeliveries),
      daemonRestarts: { value: 0, trend: computeTrend([]) },
    },
    resourceAnomalies: computeResourceAnomalies(resourceTrendsByRole),
  };
  if (suiteDurationTrend) {
    sidecar.suiteDurationTrend = suiteDurationTrend;
  }
  if (costPerTicketSeries) {
    sidecar.costPerTicket = {
      average: costPerTicketSeries.series.length > 0 ? trendedFromSeries(costPerTicketSeries.series) : null,
      sampleCount: costPerTicketSeries.sampleCount,
      excludedCount: costPerTicketSeries.excludedCount,
      series: costPerTicketSeries.series,
      basis: COST_PER_TICKET_BASIS,
    };
  }
  return sidecar;
}

// ── markdown renderer (pure, cost-05b/05c) ──────────────────────────────

function trendArrow(trend: TrendResult): string {
  if (trend.direction === 'up') {
    return '↑';
  }
  if (trend.direction === 'down') {
    return '↓';
  }
  if (trend.direction === 'flat') {
    return '→';
  }
  return '';
}

// Each renderXLines helper below returns the lines for one section (or []
// when that section has nothing to show), so renderCostHealthSection
// itself is just concatenation - split out so every function stays under
// the CRAP<=6 gate.
function renderAgentLines(agents: AgentDailyCost[]): string[] {
  return agents.map((agent) => {
    const costText = agent.costUsd !== null ? `$${agent.costUsd.value.toFixed(2)} ${trendArrow(agent.costUsd.trend)}` : 'no priced usage';
    return `- ${agent.role}: ${agent.tokens.value} tokens ${trendArrow(agent.tokens.trend)}, ${costText}`;
  });
}

function renderExpensiveTicketLines(tickets: ExpensiveTicket[]): string[] {
  if (tickets.length === 0) {
    return [];
  }
  return ['', '**Top expensive tickets to date:**', ...tickets.map((t) => `- ${t.ticketId}: $${t.costUsd.toFixed(2)}`)];
}

// Absent (a sidecar predating BL-338) or no delivered ticket has a priced
// cost yet renders nothing - same "hidden, not fabricated" posture as
// renderExpensiveTicketLines above. The basis line always accompanies the
// figure so the accounting statement travels with the number on every
// surface that shows it (cost-per-ticket-diagram-04).
function renderCostPerTicketLines(costPerTicket: CostPerTicketSummary | undefined): string[] {
  if (!costPerTicket || costPerTicket.average === null) {
    return [];
  }
  const excludedNote = costPerTicket.excludedCount > 0 ? `, ${costPerTicket.excludedCount} delivered ticket(s) excluded (no priced usage)` : '';
  return [
    '',
    `**Average cost/ticket:** $${costPerTicket.average.value.toFixed(2)} ${trendArrow(costPerTicket.average.trend)} ` +
      `(over ${costPerTicket.sampleCount} delivered ticket(s)${excludedNote})`,
    `_${costPerTicket.basis}_`,
  ];
}

function renderFlowBalanceLine(flow: CostHealthSidecar['flowBalance']): string {
  return (
    `**Flow balance:** specced ${flow.speccedPerDay.value}/day ${trendArrow(flow.speccedPerDay.trend)}, ` +
    `closed ${flow.closedPerDay.value}/day ${trendArrow(flow.closedPerDay.trend)}`
  );
}

function renderReliabilityLine(rel: ReliabilityCounts): string {
  return (
    `**Reliability:** ${rel.chases.value} chases ${trendArrow(rel.chases.trend)}, ` +
    `${rel.nudges.value} nudges ${trendArrow(rel.nudges.trend)}, ` +
    `${rel.respawns.value} respawns ${trendArrow(rel.respawns.trend)}, ` +
    `${rel.failedDeliveries.value} failed deliveries ${trendArrow(rel.failedDeliveries.trend)}`
  );
}

function renderAnomalyLines(anomalies: ResourceAnomaly[]): string[] {
  if (anomalies.length === 0) {
    return [];
  }
  return [
    '',
    '**Resource anomalies:**',
    ...anomalies.map((a) => {
      const mb = Math.round(a.rssBytes / (1024 * 1024));
      return `- ${a.role}: ${mb}MB ${trendArrow(a.rssTrend)}, ${a.cpuPercent.toFixed(1)}% cpu ${trendArrow(a.cpuTrend)}`;
    }),
  ];
}

// Pure: renders the briefing's "Cost & Health" section directly from the
// sidecar - every figure traces to a sidecar field, nothing invented
// (cost-05b). A null sidecar (no day's telemetry available) renders an
// empty string so the section is cleanly omitted, not an error (cost-05c).
export function renderCostHealthSection(sidecar: CostHealthSidecar | null): string {
  if (!sidecar) {
    return '';
  }
  const lines: string[] = [
    '## Cost & Health',
    '',
    '**Per-agent tokens/cost today:**',
    ...renderAgentLines(sidecar.agents),
    ...renderExpensiveTicketLines(sidecar.topExpensiveTickets),
    ...renderCostPerTicketLines(sidecar.costPerTicket),
    '',
    renderFlowBalanceLine(sidecar.flowBalance),
    '',
    renderReliabilityLine(sidecar.reliability),
    ...renderAnomalyLines(sidecar.resourceAnomalies),
  ];
  return lines.join('\n');
}

// ── impure orchestrator ──────────────────────────────────────────────────

export function computeCostHealthSidecar(
  targetPath: string,
  roles: RoleWorktree[],
  nowMs: number = Date.now(),
  claudeProjectsDir?: string
): CostHealthSidecar {
  const dateIso = toIso(nowMs).slice(0, 10);
  const costTelemetryByRole = computeCostTelemetry(targetPath, roles, claudeProjectsDir);
  const resourceTrendsByRole = computeResourceTrends(readResourceSampleEvents(targetPath), roles.map((r) => r.role), nowMs);
  const reliabilityDailySeries = bucketDailyReliabilityEvents(readChaserTelemetryEvents(targetPath), nowMs);
  const lifecycles = [...deriveTicketLifecycles(runGitLog(targetPath, 'backlog')).values()];
  const { speccedSeries, closedSeries } = bucketDailyFlowBalance(lifecycles, nowMs);
  const suiteDurationTrend = computeSuiteDurationTrend(targetPath, roles, nowMs);
  const costPerTicketSeries = computeCostPerTicketSeries(lifecycles, costTelemetryByRole);

  return buildCostHealthSidecar(
    dateIso,
    costTelemetryByRole,
    resourceTrendsByRole,
    reliabilityDailySeries,
    speccedSeries,
    closedSeries,
    DEFAULT_TOP_EXPENSIVE_TICKETS,
    suiteDurationTrend,
    costPerTicketSeries
  );
}

// ── thin fs/git adapters ─────────────────────────────────────────────────

export function sidecarPath(targetPath: string, dateIso: string): string {
  return path.join(targetPath, 'docs', 'briefings', `${dateIso}.json`);
}

export function writeCostHealthSidecar(targetPath: string, sidecar: CostHealthSidecar): string {
  const filePath = sidecarPath(targetPath, sidecar.dateIso);
  atomicWrite(filePath, JSON.stringify(sidecar, null, 2));
  return filePath;
}

// Commits ONLY the sidecar file - never a broader `git add`, so any other
// dirty state in the worktree (a role's own in-flight uncommitted work) is
// left untouched. Returns false (never throws) on any git failure,
// including "nothing to commit" (e.g. an identical re-run) - the daily
// briefing flow must proceed regardless of whether this particular commit
// succeeded.
export function commitCostHealthSidecar(targetPath: string, filePath: string, dateIso: string): boolean {
  return commitScopedFile(targetPath, filePath, `Cost & health sidecar for ${dateIso}\n\nBy coder (BL-213 deterministic emitter).`);
}
