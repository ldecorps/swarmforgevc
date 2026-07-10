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
import { mailboxDir, RoleEntry } from './swarmState';

export type NodeKind = 'agent' | 'swarm' | 'fleet';
export type NodeStatus = 'idle' | 'queued' | 'active' | 'blocked' | 'converging' | 'done' | 'degraded';

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

function listHandoffContents(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const contents: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      for (const inner of fs.readdirSync(fullPath)) {
        if (inner.endsWith('.handoff')) {
          contents.push(fs.readFileSync(path.join(fullPath, inner), 'utf8'));
        }
      }
    } else if (entry.endsWith('.handoff')) {
      contents.push(fs.readFileSync(fullPath, 'utf8'));
    }
  }
  return contents;
}

function hasActiveBacklogItems(targetPath: string): boolean {
  const activeDir = path.join(targetPath, 'backlog', 'active');
  if (!fs.existsSync(activeDir)) {
    return false;
  }
  return fs.readdirSync(activeDir).some((entry) => entry.endsWith('.yaml'));
}

function mailboxAgentStatus(targetPath: string, role: RoleEntry): 'idle' | 'queued' | 'active' | 'done' | 'converging' {
  const newContents = listHandoffContents(mailboxDir(role, 'inbox', 'new'));
  const inProcessContents = listHandoffContents(mailboxDir(role, 'inbox', 'in_process'));
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

const STATUS_PRIORITY: NodeStatus[] = ['degraded', 'blocked', 'converging', 'active', 'queued'];

function rollupStatus(agentStatuses: NodeStatus[]): NodeStatus {
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
    status: () => rollupStatus(packRoles.map((role) => agentStatus(deps, role))),
    health: () => ({
      expected_panes: deps.roles.length,
      live_panes: deps.roles.filter((role) => deps.isSessionAlive(role)).length,
      coordinator_alive: coordinatorAlive,
    }),
    children: () => packRoles.map((role) => createAgentNode(deps, role, coordinatorAlive)),
  };
}
