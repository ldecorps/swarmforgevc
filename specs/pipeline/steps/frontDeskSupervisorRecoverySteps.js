'use strict';

// BL-303: step handlers for "The front-desk supervisor recovers a
// given-up child instead of leaving it down for good". Drives the REAL
// front_desk_supervisor_lib.bb check-one! via
// front_desk_giveup_recovery_acceptance_runner.bb (real Babashka, fixture
// entry + injected clock, no real process spawn, no real timer) - mirrors
// frontDeskAutoOpenSubjectSteps.js's own execFileSync-a-real-bb-CLI
// pattern.
//
// BL-1099 retired supervisor-recovery-02 (the give-up cooldown outline).
// Its unscoped cooldown step registrations went with it — BL-1088 owns
// that matrix with defineScoped handlers.
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
}

module.exports = { registerSteps };
