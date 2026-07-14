// BL-245 architect bounce (5f0ae65b42, "engine has no live caller"):
// coordinatorLossRecovery.ts's recoverOrStopOnCoordinatorLoss was fully
// built and fully tested but had zero production callers - the same
// "unit-correct, invoked by nothing" gap the BL-233 QA bounce caught.
// This file is the missing trigger: a real PaneTailer DeadEvent for the
// coordinator role now actually invokes recovery, wired with REAL
// production dependencies - never fabricated.
//
// REUSE, don't reimplement: respawnCoordinator wraps tmuxClient.ts's own
// respawnAgent (the existing single-pane respawn primitive - never a full
// bouncer.ts bounceSwarm, which would kill in-flight workers too,
// contradicting "workers keep running"). Teardown wraps swarmStopper.ts's
// own stopSwarmCompletely, unchanged. Drain status composes swarmState.ts's
// mailboxDir (correctly handles master-resident vs dedicated-worktree
// roles, unlike chaserMonitor's own simpler inline inbox-path composition)
// with inboxChaser.ts's scanInProcess and the SAME
// readHeartbeat+computeLiveness pair extension.ts's existing BL-069
// bounce-drain watcher already uses for "is this role idle."

import * as fs from 'fs';
import * as path from 'path';
import { readHeartbeat } from '../tools/heartbeat';
import { computeLiveness, WatchdogConfig } from '../watchdog/liveness';
import { CoordinatorLossDeps, CoordinatorLossOutcome, recoverOrStopOnCoordinatorLoss } from './coordinatorLossRecovery';
import { RoleDrainStatus } from './bounceDrain';
import { scanInProcess } from './inboxChaser';
import { stopSwarmCompletely } from './swarmStopper';
import { mailboxDir, parseRolesTsv, RoleEntry } from './swarmState';
import { respawnAgent } from './tmuxClient';

export interface CoordinatorDeadEvent {
  role: string;
  dead: boolean;
}

export function isCoordinatorDeadEvent(events: CoordinatorDeadEvent[]): boolean {
  return events.some((event) => event.role === 'coordinator' && event.dead === true);
}

// Matches extension.ts's own BL-069 bounce-drain watchdog thresholds (30s
// stale / 60s in-flight / 120s dead) - not re-exported from there today,
// so mirrored here rather than left unconfigurable.
const WATCHDOG_CONFIG: WatchdogConfig = {
  staleTimeoutSeconds: 30,
  inFlightTimeoutSeconds: 60,
  deadTimeoutSeconds: 120,
};

function readRoleEntries(targetPath: string): RoleEntry[] {
  const rolesFile = path.join(targetPath, '.swarmforge', 'roles.tsv');
  try {
    return parseRolesTsv(fs.readFileSync(rolesFile, 'utf8'));
  } catch {
    return [];
  }
}

function readDrainRoleStatuses(targetPath: string): RoleDrainStatus[] {
  const heartbeatDir = path.join(targetPath, '.swarmforge', 'heartbeat');
  return readRoleEntries(targetPath)
    .filter((entry) => entry.role !== 'coordinator')
    .map((entry) => {
      const hasInProcessWork = scanInProcess(mailboxDir(entry, 'inbox', 'in_process')).length > 0;
      const hb = readHeartbeat(heartbeatDir, entry.role);
      const liveness = computeLiveness(hb, Date.now(), WATCHDOG_CONFIG, hb !== undefined);
      const idle = liveness.state !== 'alive' && liveness.state !== 'stuck';
      return { role: entry.role, hasInProcessWork, idle };
    });
}

const DEFAULT_MAX_RESPAWN_ATTEMPTS = 3;
const DEFAULT_DRAIN_TIMEOUT_SECONDS = 300;
const DEFAULT_DRAIN_POLL_MS = 2000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30000;

export function createProductionCoordinatorLossDeps(targetPath: string): CoordinatorLossDeps {
  return {
    targetPath,
    maxRespawnAttempts: DEFAULT_MAX_RESPAWN_ATTEMPTS,
    respawnCoordinator: () => respawnAgent(targetPath, 'coordinator').success,
    backoffMs: (attempt) => Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1)),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    drainRoleStatuses: () => readDrainRoleStatuses(targetPath),
    drainTimeoutSeconds: DEFAULT_DRAIN_TIMEOUT_SECONDS,
    drainPollMs: DEFAULT_DRAIN_POLL_MS,
    getNowMs: () => Date.now(),
    stopSwarmCompletely: (tp) => stopSwarmCompletely(tp),
  };
}

// The actual trigger PaneTailer's onDead callback invokes. depsOverride
// lets a caller (or a test) override individual production deps without
// rebuilding the whole object; recoverFn is swappable so tests never
// invoke the real recovery engine (already exhaustively tested on its
// own in coordinatorLossRecovery.test.js) or a real tmux/process call.
export async function handleCoordinatorDeadEvent(
  targetPath: string,
  events: CoordinatorDeadEvent[],
  depsOverride: Partial<CoordinatorLossDeps> = {},
  recoverFn: (deps: CoordinatorLossDeps) => Promise<CoordinatorLossOutcome> = recoverOrStopOnCoordinatorLoss
): Promise<CoordinatorLossOutcome | null> {
  if (!isCoordinatorDeadEvent(events)) {
    return null;
  }
  const deps: CoordinatorLossDeps = { ...createProductionCoordinatorLossDeps(targetPath), ...depsOverride };
  return recoverFn(deps);
}
