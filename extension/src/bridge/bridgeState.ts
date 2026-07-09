import * as fs from 'fs';
import * as path from 'path';
import { readPipelineStages, parseRolesTsv, PipelineStage } from '../swarm/swarmState';
import { readBacklogFolders, BacklogFolders } from '../panel/backlogReader';
import { readHeartbeat, HeartbeatData } from '../tools/heartbeat';
import { loadRuns, RunEntry } from '../runs/runLog';
import { computeDeliveryMetrics, DeliveryMetrics } from '../metrics/deliveryMetrics';
import { computeCostTelemetry, RoleCostTelemetry } from '../metrics/costTelemetry';
import { readResourceSampleEvents, computeResourceTrends, RoleResourceTrend } from '../metrics/resourceTelemetry';
import { RoleWorktree } from '../metrics/swarmMetrics';

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

function resolveRoleWorktrees(targetPath: string): RoleWorktree[] {
  const rolesFile = path.join(targetPath, '.swarmforge', 'roles.tsv');
  try {
    return parseRolesTsv(fs.readFileSync(rolesFile, 'utf8')).map((r) => ({ role: r.role, worktreePath: r.worktreePath }));
  } catch {
    return [];
  }
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
