'use strict';

// BL-303: step handlers for "The front-desk supervisor recovers a
// given-up child instead of leaving it down for good". Drives the REAL
// front_desk_supervisor_lib.bb check-one! via
// front_desk_giveup_recovery_acceptance_runner.bb (real Babashka, fixture
// entry + injected clock, no real process spawn, no real timer) - mirrors
// frontDeskAutoOpenSubjectSteps.js's own execFileSync-a-real-bb-CLI
// pattern.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'front_desk_giveup_recovery_acceptance_runner.bb');

const RESTART_CONFIG = { maxAttempts: 5, backoffBaseMs: 1000, backoffMaxMs: 60000, healthyResetMs: 600000 };
const GIVEUP_CONFIG = { giveupCooldownMs: 900000 };

function checkOne(entry, nowMs, pidAlive) {
  const scenario = { entry, nowMs, pidAlive, restartConfig: RESTART_CONFIG, giveupConfig: GIVEUP_CONFIG };
  const out = execFileSync('bb', [RUNNER, JSON.stringify(scenario)], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the front-desk supervisor is deciding what to do with a supervised child process$/, () => {
    // No fixture setup needed - each scenario's own Given builds its entry.
  });

  // ── supervisor-recovery-01 ───────────────────────────────────────────
  registry.define(/^a child that has run without crashing past the healthy-uptime window$/, (ctx) => {
    ctx.entry = { pid: 4242, attempts: 3, status: 'running', crashedAtMs: null, startedAtMs: 1000, gaveUpAtMs: null };
    ctx.nowMs = 1000 + RESTART_CONFIG.healthyResetMs + 1;
    ctx.pidAlive = true;
  });

  registry.define(/^the supervisor next checks it$/, (ctx) => {
    ctx.result = checkOne(ctx.entry, ctx.nowMs, ctx.pidAlive);
  });

  registry.define(/^its restart-attempt count is reset to zero$/, (ctx) => {
    if (ctx.result.entry.attempts !== 0) {
      throw new Error(`expected attempts reset to 0, got ${ctx.result.entry.attempts}`);
    }
    if (ctx.result.event !== 'healthy-reset') {
      throw new Error(`expected a healthy-reset event, got ${ctx.result.event}`);
    }
  });

  // ── supervisor-recovery-02 ───────────────────────────────────────────
  registry.define(/^a child the supervisor has given up on$/, (ctx) => {
    ctx.entry = { pid: null, attempts: 5, status: 'gave-up', crashedAtMs: 5000, startedAtMs: 1000, gaveUpAtMs: 1000000 };
    ctx.pidAlive = false;
  });

  registry.define(/^the give-up cooldown (has elapsed|has not elapsed yet)$/, (ctx, elapsed) => {
    const boundary = ctx.entry.gaveUpAtMs + GIVEUP_CONFIG.giveupCooldownMs;
    ctx.nowMs = elapsed === 'has elapsed' ? boundary + 1 : boundary - 1;
    ctx.result = checkOne(ctx.entry, ctx.nowMs, ctx.pidAlive);
  });

  registry.define(/^the supervisor (resets its attempt count and starts the child again|leaves the child down without restarting it)$/, (ctx, action) => {
    if (action === 'resets its attempt count and starts the child again') {
      if (ctx.result.entry.status !== 'running') {
        throw new Error(`expected the child to be re-armed to running, got ${ctx.result.entry.status}`);
      }
      if (ctx.result.entry.attempts !== 1) {
        throw new Error(`expected a fresh attempt budget (1, not stuck at/past the old cap), got ${ctx.result.entry.attempts}`);
      }
      if (ctx.result.event !== 're-armed') {
        throw new Error(`expected a re-armed event, got ${ctx.result.event}`);
      }
    } else {
      if (ctx.result.entry.status !== 'gave-up') {
        throw new Error(`expected the child to stay gave-up, got ${ctx.result.entry.status}`);
      }
      if (ctx.result.entry.attempts !== 5) {
        throw new Error(`expected attempts untouched (5), got ${ctx.result.entry.attempts}`);
      }
      if (ctx.result.event !== null) {
        throw new Error(`expected no event (no spawn, no state change), got ${ctx.result.event}`);
      }
    }
  });
}

module.exports = { registerSteps };
