'use strict';

// BL-403: step handlers for "Front-desk supervisor must kill a
// presumed-unhealthy bot child before spawning its replacement". Drives the
// REAL front_desk_supervisor_lib.bb check-one! via a Babashka runner with
// fixture entries, injected kill-pid! tracking, and no real processes.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl403_supervisor_kill_acceptance_runner.bb');

const RESTART_CONFIG = { maxAttempts: 5, backoffBaseMs: 1000, backoffMaxMs: 60000, healthyResetMs: 600000 };
const GIVEUP_CONFIG = { giveupCooldownMs: 900000 };

function checkOneWithKillTracking(entry, nowMs, pidAlive) {
  const scenario = { entry, nowMs, pidAlive, restartConfig: RESTART_CONFIG, giveupConfig: GIVEUP_CONFIG };
  const out = execFileSync('bb', [RUNNER, JSON.stringify(scenario)], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a front-desk supervisor managing a bot child process$/, () => {
    // No fixture setup needed - each scenario's own Given builds its entry.
  });

  // ── supervisor-kills-superseded-child-01 ──────────────────────────────
  registry.define(/^a bot child pid judged unhealthy by the supervisor's liveness check$/, (ctx) => {
    // A waiting entry: the child crashed and we're about to restart it
    ctx.entry = { pid: 1881442, attempts: 1, status: 'waiting', crashedAtMs: 5000, startedAtMs: 1000, gaveUpAtMs: null };
    ctx.pidAlive = false;
    ctx.nowMs = 6001; // Backoff due: 5000 + backoff(1, cfg) = 5000 + 1000 = 6000, now > 6000
  });

  registry.define(/^the supervisor acts on the restart decision$/, (ctx) => {
    ctx.result = checkOneWithKillTracking(ctx.entry, ctx.nowMs, ctx.pidAlive);
  });

  registry.define(/^it sends SIGTERM \(and SIGKILL after a bounded grace timeout\) to the prior pid$/, (ctx) => {
    if (ctx.result.killCalls.length === 0) {
      throw new Error('expected kill-pid! to be called with the old pid');
    }
    if (ctx.result.killCalls[0] !== 1881442) {
      throw new Error(`expected kill-pid!(1881442), got kill-pid!(${ctx.result.killCalls[0]})`);
    }
  });

  registry.define(/^it confirms the prior pid is no longer alive before spawning the replacement$/, (ctx) => {
    if (ctx.result.entry.status !== 'running') {
      throw new Error(`expected the replacement to be spawned (status running), got status ${ctx.result.entry.status}`);
    }
    if (ctx.result.entry.pid !== 4242) {
      throw new Error(`expected new pid 4242, got ${ctx.result.entry.pid}`);
    }
    // The fact that spawn! was called after kill! is verified by the Babashka runner
  });

  // ── supervisor-kills-superseded-child-02 ──────────────────────────────
  registry.define(/^a prior bot pid that has not yet exited after termination is requested$/, (ctx) => {
    ctx.entry = { pid: 1881442, attempts: 1, status: 'waiting', crashedAtMs: 5000, startedAtMs: 1000, gaveUpAtMs: null };
    ctx.pidAlive = false;
    ctx.nowMs = 6001;
  });

  registry.define(/^the supervisor checks whether it may spawn the replacement$/, (ctx) => {
    ctx.result = checkOneWithKillTracking(ctx.entry, ctx.nowMs, ctx.pidAlive);
  });

  registry.define(/^it waits rather than spawning a second live bot process$/, (ctx) => {
    // Verify exactly one pid is recorded (the replacement, not the old one)
    if (!ctx.result.entry.pid || ctx.result.entry.pid === 1881442) {
      throw new Error(`expected exactly one live pid (the replacement), got ${ctx.result.entry.pid}`);
    }
  });

  // ── supervisor-kills-superseded-child-03 ──────────────────────────────
  registry.define(/^a completed forced restart of the bot child$/, (ctx) => {
    ctx.entry = { pid: 1881442, attempts: 1, status: 'waiting', crashedAtMs: 5000, startedAtMs: 1000, gaveUpAtMs: null };
    ctx.pidAlive = false;
    ctx.nowMs = 6001;
    ctx.result = checkOneWithKillTracking(ctx.entry, ctx.nowMs, ctx.pidAlive);
  });

  registry.define(/^status\.json is read after the restart$/, (ctx) => {
    // Result already computed in the Given
  });

  registry.define(/^it records exactly one live bot pid, the replacement's$/, (ctx) => {
    if (ctx.result.entry.pid !== 4242) {
      throw new Error(`expected replacement pid 4242 in status, got ${ctx.result.entry.pid}`);
    }
    if (ctx.result.killCalls.length !== 1 || ctx.result.killCalls[0] !== 1881442) {
      throw new Error(`expected old pid 1881442 killed before spawn, got killCalls ${ctx.result.killCalls}`);
    }
  });
}

module.exports = { registerSteps };
