#!/usr/bin/env node
/**
 * BL-437 (fleet-observability half of the second-swarm epic, BL-435):
 * publishes THIS swarm's own rolled-up status to the fleet rendezvous dir
 * under the operator host's own $HOME - flips BL-246's backwards coupling
 * (the fleet console reaching into another swarm's roles.tsv/heartbeat
 * files to reconstruct its status) back to BL-242's own principle: the
 * swarm rolls up its own pack, the console just merges published docs.
 *
 * Reuses createSwarmNode (compositeNode.ts) UNCHANGED - the exact rollup
 * fleet-console.ts used to compute for itself before this ticket - so a
 * published doc can never disagree with what a live in-process
 * reconstruction would say. heartbeatIsSessionAlive/WATCHDOG_CONFIG moved
 * here from fleet-console.ts: this CLI is now the ONE place that
 * reconstructs liveness from a role's on-disk heartbeat file; the console
 * itself no longer does.
 *
 * Shelled out to from swarmforge/scripts/handoffd.bb each chase-sweep
 * cycle (Babashka has no way to import compiled TS) - the same
 * shell-to-node-and-degrade-on-failure pattern handoffd.bb already uses
 * for its other *-line.js/emit-*-sidecar.js CLIs.
 *
 * needs_human/isBlocked (BL-438) fold in the real signal: chase_sweep_lib.bb's
 * own durable chase-escalations.json (`.swarmforge/daemon/`), which the
 * daemon already writes/clears on every chase-sweep cycle - never a pane-text
 * guess, and never a second, parallel needs-human store.
 *
 * Usage: node emit-fleet-status.js <target-repo-path>
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CompositeNode, createSwarmNode } from '../swarm/compositeNode';
import { readSwarmName } from '../bridge/holisticProjections';
import { readHeartbeat } from './heartbeat';
import { RoleEntry } from '../swarm/swarmState';
import { computeLiveness, WatchdogConfig } from '../watchdog/liveness';
import { atomicWrite } from '../util/atomicWrite';
import { loadRoles, makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

export interface EmitFleetStatusArgs {
  targetRepoPath: string;
}

export function parseArgs(argv: string[]): EmitFleetStatusArgs | null {
  const [targetRepoPath] = argv;
  return targetRepoPath ? { targetRepoPath } : null;
}

// Matches extension.ts's own BL-069 bounce-drain watchdog thresholds -
// fleet-console.ts's identical constant before this ticket, moved here
// verbatim since this file is now the one place that reads a heartbeat.
const WATCHDOG_CONFIG: WatchdogConfig = {
  staleTimeoutSeconds: 30,
  inFlightTimeoutSeconds: 60,
  deadTimeoutSeconds: 120,
};

export function heartbeatIsSessionAlive(targetPath: string): (role: RoleEntry) => boolean {
  const heartbeatDir = path.join(targetPath, '.swarmforge', 'heartbeat');
  return (role) => {
    const hb = readHeartbeat(heartbeatDir, role.role);
    const liveness = computeLiveness(hb, Date.now(), WATCHDOG_CONFIG, hb !== undefined);
    return liveness.state === 'alive' || liveness.state === 'stuck';
  };
}

// BL-444's own "a live shared runtime path is a shared global - reach it
// through a redirectable env seam" rule, applied here: the rendezvous dir
// sits under the operator host's REAL $HOME (the ticket's own "never the
// target working tree" constraint), so a test must be able to point it at
// its own temp root instead - never write into the developer's real home.
export function fleetRendezvousDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.SWARMFORGE_FLEET_DIR || path.join(os.homedir(), '.swarmforge', 'fleet');
}

export function fleetStatusPath(swarm: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(fleetRendezvousDir(env), swarm, 'status.json');
}

export interface PublishedNode {
  identity: ReturnType<CompositeNode['identity']>;
  status: ReturnType<CompositeNode['status']>;
  health: ReturnType<CompositeNode['health']>;
}

export interface PublishedSwarmStatus extends PublishedNode {
  children: PublishedNode[];
  needs_human: boolean;
  updated_at: string;
}

function renderNode(node: CompositeNode): PublishedNode {
  return { identity: node.identity(), status: node.status(), health: node.health() };
}

// The swarm's own project label: no hand-authored registration exists to
// carry one anymore (that was exactly the mechanism this ticket removes),
// so this derives it from the one thing every target repo genuinely has -
// its own directory name.
function projectLabel(targetRepoPath: string): string {
  return path.basename(targetRepoPath);
}

// BL-438: the durable, on-disk needs-human signal - chase_sweep_lib.bb's
// own write-escalation! (called from handoffd.bb's chase-sweep adapters on
// every cycle) keyed this file by role, ADDING a role's key when it becomes
// stuck-escalated and DISSOC'ing it the moment it recovers - never setting
// it to false. That dissoc-on-recovery behavior is exactly the "the signal
// must CLEAR on resolution" requirement, already built into the file this
// slice reads, not something this slice needs to implement itself. This is
// the daemon-side (headless, no-tmux-required) counterpart to the VS Code
// extension's in-memory NeedsHumanReconciler - the swarm's own coordination
// layer, not a pane-text guess, per the "fold the EXISTING signal in rather
// than inventing a parallel one" instruction.
function chaseEscalationsPath(targetRepoPath: string): string {
  return path.join(targetRepoPath, '.swarmforge', 'daemon', 'chase-escalations.json');
}

function readChaseEscalations(targetRepoPath: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(chaseEscalationsPath(targetRepoPath), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Pure given the raw parsed record - never trusts a present-but-non-true
// value as escalated, in case a future writer ever sets a key to false
// instead of removing it (chase_sweep_lib.bb's own convention is to
// dissoc, but this reader must not silently misclassify if that changes).
export function isRoleEscalated(escalations: Record<string, unknown>, role: string): boolean {
  return escalations[role] === true;
}

export function needsHumanFromEscalations(escalations: Record<string, unknown>): boolean {
  return Object.values(escalations).some((value) => value === true);
}

export function buildFleetStatusDoc(targetRepoPath: string, nowMs: number = Date.now()): PublishedSwarmStatus {
  const swarm = readSwarmName(targetRepoPath);
  const escalations = readChaseEscalations(targetRepoPath);
  const node = createSwarmNode({
    targetPath: targetRepoPath,
    swarmName: swarm,
    project: projectLabel(targetRepoPath),
    coordinatorAddress: `${swarm}/coordinator`,
    roles: loadRoles(targetRepoPath),
    isSessionAlive: heartbeatIsSessionAlive(targetRepoPath),
    isBlocked: (role) => isRoleEscalated(escalations, role.role),
  });
  return {
    ...renderNode(node),
    children: node.children().map(renderNode),
    needs_human: needsHumanFromEscalations(escalations),
    updated_at: new Date(nowMs).toISOString(),
  };
}

export function emitFleetStatus(targetRepoPath: string, nowMs?: number, env: NodeJS.ProcessEnv = process.env): PublishedSwarmStatus {
  const doc = buildFleetStatusDoc(targetRepoPath, nowMs);
  atomicWrite(fleetStatusPath(doc.identity.name, env), JSON.stringify(doc));
  return doc;
}

export const main = makeArgsGuardedMain(
  parseArgs,
  'Usage: node emit-fleet-status.js <target-repo-path>\n',
  async (args) => {
    printJsonToStdout(emitFleetStatus(args.targetRepoPath));
  }
);

if (require.main === module) {
  runCliMain(main);
}
