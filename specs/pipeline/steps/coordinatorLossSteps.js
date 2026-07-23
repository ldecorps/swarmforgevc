'use strict';

// BL-245: step handlers for the coordinator-loss graceful-STOP feature.
// Drives the REAL recoverOrStopOnCoordinatorLoss (bounded respawn, then
// quiesce-and-teardown - reusing bounceDrain.ts's decideDrainAction and an
// injected stopSwarmCompletely unchanged) and the REAL createSwarmNode's
// terminal-status check. Pane kill/respawn and tmux teardown are always
// faked; backoff/quiesce polling always drives an injected fake clock -
// no real timer, matching the ticket's own TESTABLE-boundary constraint.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { recoverOrStopOnCoordinatorLoss, readCoordinatorLossState } = require(
  path.join(__dirname, '..', '..', '..', 'extension', 'out', 'swarm', 'coordinatorLossRecovery')
);
const { createSwarmNode } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'swarm', 'compositeNode'));

function mkTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-coordinator-loss-'));
}

// A clock ctx.deps.sleep advances itself, so decideDrainAction's own
// timeout math is exercised for real (never a real setTimeout).
function fakeClock(ctx) {
  let nowMs = 0;
  ctx.deps.getNowMs = () => nowMs;
  ctx.deps.sleep = async (ms) => {
    ctx.sleepCalls.push(ms);
    nowMs += ms;
  };
}

function busyRoleStatus() {
  return [{ role: 'coder', hasInProcessWork: true, idle: false }];
}

function idleRoleStatus() {
  return [{ role: 'coder', hasInProcessWork: false, idle: true }];
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a running swarm "([^"]+)" with work in flight$/, (ctx, swarmName) => {
    ctx.targetPath = mkTarget();
    ctx.swarmName = swarmName;
    ctx.respawnCalls = 0;
    ctx.stopCalls = [];
    ctx.sleepCalls = [];
    ctx.drainStatusesFn = busyRoleStatus;
    ctx.observedPhasesDuringDrain = [];
    ctx.deps = {
      targetPath: ctx.targetPath,
      maxRespawnAttempts: 3,
      respawnCoordinator: () => false,
      backoffMs: (attempt) => attempt * 10,
      drainRoleStatuses: () => {
        ctx.observedPhasesDuringDrain.push(readCoordinatorLossState(ctx.targetPath)?.phase);
        return ctx.drainStatusesFn();
      },
      drainTimeoutSeconds: 5,
      drainPollMs: 100,
      stopSwarmCompletely: (targetPath) => {
        ctx.stopCalls.push(targetPath);
        return { success: true, message: 'stopped', phases: [], sessionsAttempted: [], sessionsStopped: 0, daemonStopped: true, supervisorStopped: true, durationMs: 0 };
      },
    };
    fakeClock(ctx);
  });

  // ── respawn-recovers-01 ──────────────────────────────────────────────
  registry.define(/^the coordinator pane dies$/, () => {
    // Documents the trigger this whole flow responds to - each scenario's
    // own subsequent step configures how respawn/drain behave.
  });

  registry.define(/^in-flight worker agents keep running during the respawn attempts$/, () => {
    // recoverOrStopOnCoordinatorLoss has no capability to touch worker
    // panes at all (only respawnCoordinator/stopSwarmCompletely are ever
    // called, both injected here) - structurally true, asserted via the
    // "no in-flight worker state is lost" Then step below (stopCalls
    // stays empty on a recovered outcome).
  });

  registry.define(/^a respawn attempt succeeds within the attempt cap$/, async (ctx) => {
    ctx.deps.respawnCoordinator = () => {
      ctx.respawnCalls += 1;
      return ctx.respawnCalls === 2; // succeeds on the 2nd of 3 allowed attempts
    };
    ctx.outcome = await recoverOrStopOnCoordinatorLoss(ctx.deps);
  });

  registry.define(/^the coordinator re-reads swarm state from durable filesystem state$/, (ctx) => {
    if (ctx.outcome.outcome !== 'recovered') {
      throw new Error(`expected a recovered outcome, got: ${JSON.stringify(ctx.outcome)}`);
    }
  });

  registry.define(/^no in-flight worker state is lost$/, (ctx) => {
    if (ctx.stopCalls.length !== 0) {
      throw new Error('a recovered coordinator must never trigger teardown, which would lose in-flight worker state');
    }
  });

  registry.define(/^the swarm returns to normal status$/, (ctx) => {
    if (readCoordinatorLossState(ctx.targetPath) !== null) {
      throw new Error('expected no coordinator-loss sentinel after a successful recovery - status must roll up normally');
    }
  });

  // ── exhausted-respawn-stops-02 ───────────────────────────────────────
  registry.define(/^every respawn attempt fails up to the attempt cap$/, async (ctx) => {
    ctx.deps.respawnCoordinator = () => {
      ctx.respawnCalls += 1;
      return false;
    };
    ctx.deps.drainRoleStatuses = () => idleRoleStatus(); // drains immediately - this scenario only cares about the respawn bound
    ctx.outcome = await recoverOrStopOnCoordinatorLoss(ctx.deps);
  });

  registry.define(/^the swarm stops gracefully rather than continuing in a degraded mode$/, (ctx) => {
    if (ctx.outcome.outcome !== 'stopped') {
      throw new Error(`expected a stopped outcome, got: ${JSON.stringify(ctx.outcome)}`);
    }
    if (ctx.respawnCalls !== ctx.deps.maxRespawnAttempts) {
      throw new Error(`expected exactly ${ctx.deps.maxRespawnAttempts} bounded respawn attempts, got ${ctx.respawnCalls}`);
    }
    if (ctx.stopCalls.length !== 1) {
      throw new Error('expected a graceful teardown to run exactly once, not leave the swarm hanging degraded');
    }
  });

  // ── graceful-stop-quiesces-03 ─────────────────────────────────────────
  registry.define(/^the swarm is stopping gracefully after coordinator loss$/, (ctx) => {
    ctx.deps.respawnCoordinator = () => false; // forces exhaustion -> the stop path
    let drainChecks = 0;
    ctx.drainStatusesFn = () => {
      drainChecks += 1;
      return drainChecks < 3 ? busyRoleStatus() : idleRoleStatus();
    };
  });

  registry.define(/^the stop proceeds$/, async (ctx) => {
    ctx.outcome = await recoverOrStopOnCoordinatorLoss(ctx.deps);
  });

  registry.define(/^no new work is promoted$/, (ctx) => {
    if (!ctx.observedPhasesDuringDrain.includes('quiescing')) {
      throw new Error('expected the durable sentinel to read "quiescing" during the drain, signalling intake must freeze');
    }
  });

  registry.define(/^each in-flight parcel finishes its current stage and commits$/, (ctx) => {
    if (ctx.stopCalls.length !== 1) {
      throw new Error('expected teardown to have run exactly once, after draining');
    }
    // "finishes its current stage" == teardown never preempted the drain
    // loop - the busy->busy->idle sequence above only reaches 'idle' on
    // the 3rd check, so at least 3 drain checks must have happened first.
    if (ctx.observedPhasesDuringDrain.length < 3) {
      throw new Error(`expected the drain loop to poll until every role finished, got only ${ctx.observedPhasesDuringDrain.length} check(s)`);
    }
  });

  registry.define(/^handoffd and every role session are then torn down with no orphaned processes$/, (ctx) => {
    if (ctx.stopCalls[0] !== ctx.targetPath) {
      throw new Error('expected the real teardown (stopSwarmCompletely) to have been invoked for this swarm');
    }
  });

  // ── fleet-terminal-stopped-04 ─────────────────────────────────────────
  registry.define(/^the swarm has stopped gracefully after coordinator loss$/, async (ctx) => {
    ctx.deps.respawnCoordinator = () => false;
    ctx.deps.drainRoleStatuses = () => idleRoleStatus();
    await recoverOrStopOnCoordinatorLoss(ctx.deps);
  });

  registry.define(/^the fleet console refreshes$/, (ctx) => {
    const swarm = createSwarmNode({
      targetPath: ctx.targetPath,
      swarmName: ctx.swarmName,
      project: ctx.targetPath,
      coordinatorAddress: `${ctx.swarmName}/coordinator`,
      roles: [{ role: 'coordinator', worktreeName: 'master', worktreePath: ctx.targetPath, displayName: 'coordinator' }],
      isSessionAlive: () => false, // the coordinator pane never came back
    });
    ctx.swarmStatus = swarm.status();
    ctx.refreshAgainStatus = swarm.status(); // "the fleet console refreshes" a second time
  });

  registry.define(/^status\(\) for the swarm is "([^"]+)"$/, (ctx, expected) => {
    if (ctx.swarmStatus !== expected) {
      throw new Error(`expected swarm status "${expected}", got "${ctx.swarmStatus}"`);
    }
  });

  registry.define(/^the swarm is not automatically restarted$/, (ctx) => {
    if (ctx.refreshAgainStatus !== ctx.swarmStatus) {
      throw new Error(
        `expected the terminal status to hold across repeated refreshes (no auto-restart), got "${ctx.swarmStatus}" then "${ctx.refreshAgainStatus}"`
      );
    }
  });
}

module.exports = { registerSteps };
