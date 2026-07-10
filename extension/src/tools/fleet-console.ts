#!/usr/bin/env node
/**
 * BL-246 (Baton fleet epic, BL-242 child): the fleet console. Two swarms,
 * two projects, one console - lists every registered swarm with its
 * status, rolls up fleet status(), and traverses children() fleet -> swarm
 * -> agent, all through fleetNode.ts's createFleetNode composed over one
 * createSwarmNode (BL-244) per registered swarm.
 *
 * PoC transport is POLL ("when the console refreshes"): every call reads
 * fresh on-disk (and heartbeat) state, so "refresh" is simply running this
 * CLI again. True push (Observer) is @m2, deferred per the ticket's own
 * scope - see BL-246-fleet-console-composite-of-swarms.push.feature.draft.
 *
 * isSessionAlive is wired to the SAME heartbeat-based liveness check
 * (heartbeat.ts + watchdog/liveness.ts) coordinatorLossTrigger.ts's own
 * production wiring already established for "is this role alive, headless"
 * (BL-245) - not a live tmux session query, since that has no on-disk
 * representation a headless multi-project console can read without a VS
 * Code/live-pane dependency. isBlocked ("needs human") is PaneTailer/
 * needsHumanReconciler-only (per BL-244) with no on-disk signal at all, so
 * it is out of @poc scope here and always reads false.
 *
 * Usage: node fleet-console.js <fleet-config-file>
 *
 * fleet-config-file: JSON array of swarm registrations, see
 * SwarmRegistration - each targetPath is that swarm's own project root
 * (its own .swarmforge/roles.tsv), independent of this tool's own cwd.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CompositeNode, createSwarmNode } from '../swarm/compositeNode';
import { createFleetNode } from '../swarm/fleetNode';
import { RoleEntry } from '../swarm/swarmState';
import { readHeartbeat } from './heartbeat';
import { computeLiveness, WatchdogConfig } from '../watchdog/liveness';
import { loadRoles, makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

export interface SwarmRegistration {
  name: string;
  project: string;
  targetPath: string;
  coordinatorAddress?: string;
}

export interface FleetConsoleArgs {
  configFile: string;
}

const USAGE = 'Usage: fleet-console.js <fleet-config-file>\n';

// Pure - same "keep main() a thin dispatcher over a testable pure helper"
// split this codebase's other CLIs (recruiter-run.ts, bakeoff-run.ts)
// already established, so a subprocess-only test would never leave this
// logic coverage-invisible.
export function parseArgs(argv: string[]): FleetConsoleArgs | null {
  const [configFile] = argv;
  return configFile ? { configFile } : null;
}

export function readFleetConfig(configFile: string): SwarmRegistration[] {
  return JSON.parse(fs.readFileSync(configFile, 'utf8'));
}

// Matches extension.ts's own BL-069 bounce-drain watchdog thresholds, the
// same constant coordinatorLossTrigger.ts's production wiring already
// mirrors (not re-exported from there today) for this identical need.
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

export function buildSwarmNode(registration: SwarmRegistration): CompositeNode {
  return createSwarmNode({
    targetPath: registration.targetPath,
    swarmName: registration.name,
    project: registration.project,
    coordinatorAddress: registration.coordinatorAddress ?? `${registration.name}/coordinator`,
    roles: loadRoles(registration.targetPath),
    isSessionAlive: heartbeatIsSessionAlive(registration.targetPath),
  });
}

export function renderFleet(fleet: CompositeNode) {
  return {
    identity: fleet.identity(),
    status: fleet.status(),
    health: fleet.health(),
    swarms: fleet.children().map((swarm) => ({
      identity: swarm.identity(),
      status: swarm.status(),
      health: swarm.health(),
    })),
  };
}

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const registrations = readFleetConfig(args.configFile);
  const fleet = createFleetNode({ fleetName: 'fleet', swarms: registrations.map(buildSwarmNode) });
  printJsonToStdout(renderFleet(fleet));
});

if (require.main === module) {
  runCliMain(main);
}
