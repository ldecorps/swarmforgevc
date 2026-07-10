// BL-244 (Baton fleet epic, BL-242 child): a swarm is a composite node,
// rolling up its pack agents. The coordinator computes the rollup - the
// console never inspects agents directly (layering: fleet -> coordinator
// -> agents). Reads REAL on-disk state only (.swarmforge/handoffs/ via
// swarmState.ts's own mailboxDir resolver, backlog/active/) - no new
// authoritative store.
//
// isSessionAlive/isBlocked are injectable: pane liveness (a live tmux
// query) and "needs human" (today only tracked live, by
// PaneTailer/needsHumanReconciler reading pane text - no on-disk
// representation exists) cannot be derived from files alone. Production
// wiring supplies both from that same live state the webview already
// tracks; tests supply fakes directly, matching acquire.ts's/qualify.ts's
// own posture in BL-233 for signals nothing on disk can answer.

import * as fs from 'fs';
import * as path from 'path';
import { readCoordinatorLossState } from './coordinatorLossRecovery';
import { scanInboxNew, scanInProcess } from './inboxChaser';
import { mailboxDir, RoleEntry } from './swarmState';

export type NodeKind = 'agent' | 'swarm' | 'fleet';
export type NodeStatus =
  | 'idle'
  | 'queued'
  | 'active'
  | 'blocked'
  | 'converging'
  | 'done'
  | 'degraded'
  // BL-245: terminal - the coordinator was lost and every bounded respawn
  // attempt failed, so the swarm quiesced and tore itself down rather than
  // run on degraded. Not auto-restarted; a human relaunches.
  | 'stopped (coordinator lost)';

export interface NodeIdentity {
  name: string;
  project: string;
  kind: NodeKind;
  coordinatorAddress: string;
}

export interface NodeHealth {
  expected_panes: number;
  live_panes: number;
  coordinator_alive: boolean;
}

export interface CompositeNode {
  identity(): NodeIdentity;
  status(): NodeStatus;
  health(): NodeHealth;
  children(): CompositeNode[];
}

export interface SwarmNodeDeps {
  targetPath: string;
  swarmName: string;
  project: string;
  coordinatorAddress: string;
  roles: RoleEntry[];
  isSessionAlive: (role: RoleEntry) => boolean;
  isBlocked?: (role: RoleEntry) => boolean;
}

// A merge-up broadcast note (handoff-protocol.md's "QA approval and
// merge-up") is the only on-disk artifact of the convergence/integration
// phase - QA's note text always names the approved commit and instructs
// the recipient to merge up to it.
function isConvergenceNote(content: string): boolean {
  return /merge (your|its) (own )?(worktree )?branch up to qa's/i.test(content) || /qa-approved/i.test(content);
}

// Reuses inboxChaser.ts's own scanInboxNew/scanInProcess (already the
// single, tested definition of "list real .handoff payloads under an
// inbox dir," including scanInProcess's batch_* subdirectory recursion)
// rather than a second, independent directory-walk here.
function readHandoffContents(items: { filePath: string }[]): string[] {
  return items.map((item) => fs.readFileSync(item.filePath, 'utf8'));
}

function hasActiveBacklogItems(targetPath: string): boolean {
  const activeDir = path.join(targetPath, 'backlog', 'active');
  if (!fs.existsSync(activeDir)) {
    return false;
  }
  return fs.readdirSync(activeDir).some((entry) => entry.endsWith('.yaml'));
}

function mailboxAgentStatus(targetPath: string, role: RoleEntry): 'idle' | 'queued' | 'active' | 'done' | 'converging' {
  const newContents = readHandoffContents(scanInboxNew(mailboxDir(role, 'inbox', 'new')));
  const inProcessContents = readHandoffContents(scanInProcess(mailboxDir(role, 'inbox', 'in_process')));
  if ([...newContents, ...inProcessContents].some(isConvergenceNote)) {
    return 'converging';
  }
  if (inProcessContents.length > 0) {
    return 'active';
  }
  if (newContents.length > 0) {
    return 'queued';
  }
  return hasActiveBacklogItems(targetPath) ? 'idle' : 'done';
}

function agentStatus(deps: SwarmNodeDeps, role: RoleEntry): NodeStatus {
  if (!deps.isSessionAlive(role)) {
    return 'degraded';
  }
  if (deps.isBlocked?.(role)) {
    return 'blocked';
  }
  return mailboxAgentStatus(deps.targetPath, role);
}

// BL-246 architect bounce (8128ba4b08, "fleet rollup mishandles stopped
// swarm"): 'stopped (coordinator lost)' (BL-245) never appears as an AGENT
// status (only createSwarmNode's own terminal override ever produces it),
// so this list never needed to rank it while only agent-level rollup
// reused it - purely additive here, an agent status can still never equal
// this value, so swarm-level rollup is unaffected. Ranked above 'degraded'
// because a stopped swarm has already torn itself down (terminal), which
// is worse than a swarm still trying (degraded).
const STATUS_PRIORITY: NodeStatus[] = ['stopped (coordinator lost)', 'degraded', 'blocked', 'converging', 'active', 'queued'];

// Exported for BL-246's fleetNode.ts: rolling up a fleet's swarms uses the
// SAME "worst status wins, all-done is a special case, empty/no-signal is
// idle" rule this file already established for rolling up a swarm's
// agents - reused directly rather than re-implemented at the fleet level.
export function rollupStatus(agentStatuses: NodeStatus[]): NodeStatus {
  if (agentStatuses.length > 0 && agentStatuses.every((status) => status === 'done')) {
    return 'done';
  }
  for (const priority of STATUS_PRIORITY) {
    if (agentStatuses.includes(priority)) {
      return priority;
    }
  }
  return 'idle';
}

function createAgentNode(deps: SwarmNodeDeps, role: RoleEntry, coordinatorAlive: boolean): CompositeNode {
  return {
    identity: () => ({ name: role.role, project: deps.project, kind: 'agent', coordinatorAddress: deps.coordinatorAddress }),
    status: () => agentStatus(deps, role),
    health: () => ({ expected_panes: 1, live_panes: deps.isSessionAlive(role) ? 1 : 0, coordinator_alive: coordinatorAlive }),
    children: () => [],
  };
}

export function createSwarmNode(deps: SwarmNodeDeps): CompositeNode {
  const coordinatorRole = deps.roles.find((role) => role.role === 'coordinator');
  const coordinatorAlive = coordinatorRole ? deps.isSessionAlive(coordinatorRole) : false;
  const packRoles = deps.roles.filter((role) => role.role !== 'coordinator');

  return {
    identity: () => ({ name: deps.swarmName, project: deps.project, kind: 'swarm', coordinatorAddress: deps.coordinatorAddress }),
    status: () => {
      // BL-245: terminal, and overrides the ordinary rollup entirely - once
      // the swarm has torn itself down there is no "worse" status to
      // report instead, regardless of whatever stale mailbox state remains
      // on disk from before the stop.
      if (readCoordinatorLossState(deps.targetPath)?.phase === 'stopped') {
        return 'stopped (coordinator lost)';
      }
      return rollupStatus(packRoles.map((role) => agentStatus(deps, role)));
    },
    health: () => ({
      expected_panes: deps.roles.length,
      live_panes: deps.roles.filter((role) => deps.isSessionAlive(role)).length,
      coordinator_alive: coordinatorAlive,
    }),
    children: () => packRoles.map((role) => createAgentNode(deps, role, coordinatorAlive)),
  };
}
