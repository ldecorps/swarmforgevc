// BL-245 (Baton fleet epic, BL-242 child): graceful STOP when the
// coordinator is lost. Operator inversion (2026-07-10): losing the
// coordinator is not a steady-state to run degraded in - it attempts a
// BOUNDED respawn first, then stops the swarm gracefully on exhaustion.
// COMPLEMENTS BL-107 (the coordinator must never DELIBERATELY exit) by
// governing UNEXPECTED loss (crash).
//
// REUSE, don't reimplement: the quiesce decision is bounceDrain.ts's own
// decideDrainAction, unchanged - "quiesce, don't cut" is exactly what that
// function already encodes (drain until every role is idle, or its own
// bounded timeout elapses). Teardown is swarmStopper.ts's own
// stopSwarmCompletely, unchanged (injected here so tests never touch a
// real tmux server). Only the bounded-respawn loop and the durable
// "coordinator lost" sentinel are new.
//
// TESTABLE boundary: respawnCoordinator/stopSwarmCompletely/sleep are all
// injected - killing/respawning a pane and the real tmux teardown are
// faked in tests, and backoff/quiesce polling always drives an injected
// sleep, never a real timer.

import * as path from 'path';
import * as fs from 'fs';
import { atomicWrite } from '../util/atomicWrite';
import { decideDrainAction, RoleDrainStatus } from './bounceDrain';
import { CompleteStopResult } from './swarmStopper';

export type CoordinatorLossPhase = 'quiescing' | 'stopped';

export interface CoordinatorLossState {
  phase: CoordinatorLossPhase;
  startedAt: string;
}

const SENTINEL_RELATIVE_PATH = ['.swarmforge', 'coordinator-loss.json'];

export function coordinatorLossStatePath(targetPath: string): string {
  return path.join(targetPath, ...SENTINEL_RELATIVE_PATH);
}

export function readCoordinatorLossState(targetPath: string): CoordinatorLossState | null {
  try {
    const raw = fs.readFileSync(coordinatorLossStatePath(targetPath), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.phase === 'quiescing' || parsed.phase === 'stopped') && typeof parsed.startedAt === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function writeCoordinatorLossState(targetPath: string, phase: CoordinatorLossPhase, startedAt: string): void {
  atomicWrite(coordinatorLossStatePath(targetPath), JSON.stringify({ phase, startedAt }, null, 2));
}

export type CoordinatorLossOutcome =
  | { outcome: 'recovered'; attempts: number }
  | { outcome: 'stopped'; attempts: number };

export interface CoordinatorLossDeps {
  targetPath: string;
  maxRespawnAttempts: number;
  respawnCoordinator: () => boolean;
  backoffMs: (attempt: number) => number;
  sleep: (ms: number) => Promise<void>;
  drainRoleStatuses: () => RoleDrainStatus[];
  drainTimeoutSeconds: number;
  drainPollMs: number;
  getNowMs: () => number;
  stopSwarmCompletely: (targetPath: string) => CompleteStopResult;
}

// Bounded: never retries past maxRespawnAttempts. Backoff only BETWEEN
// attempts (never after the last one, which has nothing left to wait for).
async function attemptBoundedRespawn(deps: CoordinatorLossDeps): Promise<CoordinatorLossOutcome | null> {
  for (let attempt = 1; attempt <= deps.maxRespawnAttempts; attempt++) {
    if (deps.respawnCoordinator()) {
      return { outcome: 'recovered', attempts: attempt };
    }
    if (attempt < deps.maxRespawnAttempts) {
      await deps.sleep(deps.backoffMs(attempt));
    }
  }
  return null;
}

// Quiesce, don't cut: polls decideDrainAction until every role has
// finished its current stage and committed ('bounce' - all idle) or the
// drain's own timeout elapses ('timeout' - proceed anyway rather than
// wait forever). Either way, teardown only runs after this returns.
async function quiesceUntilDrained(deps: CoordinatorLossDeps, startedAtMs: number): Promise<void> {
  for (;;) {
    const decision = decideDrainAction(deps.drainRoleStatuses(), startedAtMs, deps.getNowMs(), deps.drainTimeoutSeconds);
    if (decision === 'bounce' || decision === 'timeout') {
      return;
    }
    await deps.sleep(deps.drainPollMs);
  }
}

export async function recoverOrStopOnCoordinatorLoss(deps: CoordinatorLossDeps): Promise<CoordinatorLossOutcome> {
  const recovered = await attemptBoundedRespawn(deps);
  if (recovered) {
    return recovered;
  }

  const startedAtIso = new Date(deps.getNowMs()).toISOString();
  writeCoordinatorLossState(deps.targetPath, 'quiescing', startedAtIso);
  await quiesceUntilDrained(deps, deps.getNowMs());

  deps.stopSwarmCompletely(deps.targetPath);
  writeCoordinatorLossState(deps.targetPath, 'stopped', startedAtIso);

  return { outcome: 'stopped', attempts: deps.maxRespawnAttempts };
}
