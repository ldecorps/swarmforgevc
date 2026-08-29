import * as fs from 'fs';
import * as path from 'path';
import { readPipelineStages, parseRolesTsv, RoleEntry, PipelineStage } from '../swarm/swarmState';
import { readBacklogFolders, BacklogFolders } from '../panel/backlogReader';
import { readHeartbeat, HeartbeatData } from '../tools/heartbeat';
import { loadRuns, RunEntry } from '../runs/runLog';
import { computeDeliveryMetrics, DeliveryMetrics } from '../metrics/deliveryMetrics';
import { computeCostTelemetry, RoleCostTelemetry } from '../metrics/costTelemetry';
import { computeBurnRateForRoles } from '../metrics/burnRate';
import { readResourceSampleEvents, computeResourceTrends, RoleResourceTrend } from '../metrics/resourceTelemetry';
import { RoleWorktree } from '../metrics/swarmMetrics';
import { runGitLog, deriveTicketLifecycles, runMergeLog } from '../metrics/gitHistoryAdapter';
import { readRoleHoldingWindows, TicketHoldingWindow } from '../metrics/ticketHoldingWindows';
import { computeStageDwellReportForRoles, StageDwellReportResult } from '../metrics/stageDwell';
import { loadCompletedTicketRecords } from '../metrics/reworkObservatorySource';
import { buildBubbleHealthTrends, BubbleHealthTrendsPayload } from './bubbleHealthCore';
import { computeTrend, TrendResult } from '../metrics/trend';
import { TrendsBoardSeriesSource, loadPointsSafely } from '../metrics/trendsBoard';
import { TRENDS_BOARD_SERIES } from '../metrics/trendsBoardRegistry';
import {
  readSwarmName,
  computeAssignments,
  computeCurrentHolders,
  groupDoneByMilestone,
  computeRecentActivity,
  TicketAssignment,
  RecentActivity,
} from './holisticProjections';

export interface AgentStatus {
  role: string;
  displayName: string;
  status: 'active' | 'idle';
  heartbeat?: HeartbeatData;
}

export interface BridgeState {
  pipeline: PipelineStage[];
  agents: AgentStatus[];
  backlog: BacklogFolders;
  runLog: RunEntry[];
}

function readAgents(targetPath: string): AgentStatus[] {
  const rolesFile = path.join(targetPath, '.swarmforge', 'roles.tsv');
  let tsv: string;
  try {
    tsv = fs.readFileSync(rolesFile, 'utf8');
  } catch {
    return [];
  }

  const roles = parseRolesTsv(tsv);
  const statusByRole = new Map(readPipelineStages(targetPath).map((s) => [s.role, s.status]));

  return roles.map((role) => {
    const agent: AgentStatus = {
      role: role.role,
      displayName: role.displayName,
      status: statusByRole.get(role.role) ?? 'idle',
    };
    const heartbeat = readHeartbeat(path.join(role.worktreePath, '.swarmforge', 'heartbeat'), role.role);
    if (heartbeat) {
      agent.heartbeat = heartbeat;
    }
    return agent;
  });
}

export function buildBridgeState(targetPath: string, runLogPath: string): BridgeState {
  return {
    pipeline: readPipelineStages(targetPath),
    agents: readAgents(targetPath),
    backlog: readBacklogFolders(targetPath),
    runLog: loadRuns(runLogPath),
  };
}

// BL-102: shared by resolveRoleWorktrees below and buildStageDwellState -
// stageDwell.ts needs worktreeName too (mailboxDir's master-resident
// nesting), which the narrower RoleWorktree shape below drops.
function resolveRoleEntries(targetPath: string): RoleEntry[] {
  const rolesFile = path.join(targetPath, '.swarmforge', 'roles.tsv');
  try {
    return parseRolesTsv(fs.readFileSync(rolesFile, 'utf8'));
  } catch {
    return [];
  }
}

function resolveRoleWorktrees(targetPath: string): RoleWorktree[] {
  return resolveRoleEntries(targetPath).map((r) => ({ role: r.role, worktreePath: r.worktreePath }));
}

// BL-096: kept separate from BridgeState/buildBridgeState deliberately -
// this shells out to git (via computeDeliveryMetrics's history walk), which
// is too expensive to recompute on every ~1s SSE poll tick the way the rest
// of BridgeState is. bridgeServer.ts calls this only for a direct /metrics
// request, never as part of the polled snapshot.
export function buildDeliveryMetricsState(targetPath: string, nowMs?: number): DeliveryMetrics {
  return computeDeliveryMetrics(targetPath, resolveRoleWorktrees(targetPath), nowMs);
}

export interface CostTelemetryState {
  costTelemetry: Record<string, RoleCostTelemetry>;
  resourceTrends: Record<string, RoleResourceTrend>;
}

// BL-100: same posture as buildDeliveryMetricsState above - reads every
// role's transcript directory + telemetry log, too expensive for the SSE
// poll loop, so bridgeServer.ts calls this only for a direct
// /cost-telemetry request.
export function buildCostTelemetryState(targetPath: string, nowMs: number = Date.now()): CostTelemetryState {
  const roles = resolveRoleWorktrees(targetPath);
  return {
    costTelemetry: computeCostTelemetry(targetPath, roles),
    resourceTrends: computeResourceTrends(
      readResourceSampleEvents(targetPath),
      roles.map((r) => r.role),
      nowMs
    ),
  };
}

// BL-102: same posture as buildDeliveryMetricsState/buildCostTelemetryState
// above - scans every role's completed-handoff audit trail, too expensive
// for the SSE poll loop. Computed only on a direct /stage-dwell request.
export function buildStageDwellState(targetPath: string, nowMs?: number): StageDwellReportResult {
  return computeStageDwellReportForRoles(resolveRoleEntries(targetPath), nowMs);
}

// BL-273: same posture as buildCostTelemetryState above - transcript scans
// are too expensive for the SSE poll loop, computed only on a direct
// /burn-rate request. nowMs mirrors buildStageDwellState's own optional
// injection (BL-270) so a test can pin the same instant its fixture and
// this route both evaluate against; undefined here falls through to
// computeBurnRateForRoles' own real-clock default in production.
export function buildBurnRateState(targetPath: string, nowMs?: number): Record<string, number> {
  return computeBurnRateForRoles(targetPath, resolveRoleWorktrees(targetPath), nowMs);
}

export function buildBubbleHealthTrendsState(targetPath: string, nowMs?: number): BubbleHealthTrendsPayload {
  const effectiveNow = nowMs ?? Date.now();
  const roles = resolveRoleWorktrees(targetPath);
  return buildBubbleHealthTrends(
    buildDeliveryMetricsState(targetPath, effectiveNow),
    buildStageDwellState(targetPath, effectiveNow),
    loadCompletedTicketRecords(targetPath, roles),
    effectiveNow
  );
}

export interface SwarmPanel {
  name: string;
  isLocal: boolean;
  agents: AgentStatus[];
}

export interface HolisticState {
  assignments: TicketAssignment[];
  swarms: SwarmPanel[];
  doneByMilestone: ReturnType<typeof groupDoneByMilestone>;
  recentActivity: RecentActivity;
}

// BL-094: same posture as buildDeliveryMetricsState/buildCostTelemetryState
// above - walks git history (backlog lifecycle + merge log) and every
// role's handoff state, too expensive for the SSE poll loop. Computed only
// on a direct /holistic request.
export function buildHolisticState(targetPath: string, runLogPath: string): HolisticState {
  const localSwarmName = readSwarmName(targetPath);
  const roles = resolveRoleWorktrees(targetPath);
  const folders = readBacklogFolders(targetPath);

  const windowsByRole: Record<string, TicketHoldingWindow[]> = {};
  for (const role of roles) {
    windowsByRole[role.role] = readRoleHoldingWindows(role.worktreePath);
  }
  const currentHolders = computeCurrentHolders(windowsByRole);
  const assignments = computeAssignments(folders.active, folders.paused, localSwarmName, currentHolders);
  const doneByMilestone = groupDoneByMilestone(folders.done);

  const lifecycles = [...deriveTicketLifecycles(runGitLog(targetPath, 'backlog')).values()];
  const merges = runMergeLog(targetPath);
  const runs = loadRuns(runLogPath);
  const recentActivity = computeRecentActivity(lifecycles, merges, runs, targetPath);

  return {
    assignments,
    swarms: [{ name: localSwarmName, isLocal: true, agents: readAgents(targetPath) }],
    doneByMilestone,
    recentActivity,
  };
}

// BL-603: the trends board's payload - every registered BL-594 series, each
// computed through the SHARED trend framework (computeTrend), never through
// a second copy of the plotting math.
//
// Same posture as buildDeliveryMetricsState above: the loaders read
// telemetry ledgers and git history, too expensive for the SSE poll loop, so
// bridgeServer.ts computes this only for a direct /trends request.
export interface TrendsBoardSeriesPayload {
  id: string;
  label: string;
  producer: string;
  /** False when the series has nothing to plot - "no data yet", not a zero. */
  hasData: boolean;
  trend: TrendResult;
}

export interface TrendsBoardPayload {
  series: TrendsBoardSeriesPayload[];
}

// The registry is a parameter so a test can publish a series the shipped
// board does not carry, proving registration is the only edit needed. The
// loop is exhaustive over whatever registry it is handed - there is no
// per-series branch here to keep in step.
export function buildTrendsBoardState(
  targetPath: string,
  nowMs: number = Date.now(),
  registry: TrendsBoardSeriesSource[] = TRENDS_BOARD_SERIES
): TrendsBoardPayload {
  const context = { targetPath, nowMs };
  return {
    series: registry.map((source) => {
      const points = loadPointsSafely(source, context);
      return {
        id: source.id,
        label: source.label,
        producer: source.producer,
        hasData: points.length > 0,
        trend: computeTrend(points),
      };
    }),
  };
}
