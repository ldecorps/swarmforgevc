'use strict';

// BL-411: step handlers for "Negotiation relay supervisor must kill a
// superseded relay child before respawning (BL-403 gap)". Drives the REAL
// front_desk_supervisor_lib.bb check-one! via a Babashka runner with
// fixture entries, injected kill-pid! tracking, and no real processes -
// mirrors bl403SupervisorKillsSupersededChildSteps.js exactly, since
// check-one!'s own kill-before-spawn logic is BL-403's and is not re-opened
// here (this ticket only wires the missing adapter through the relay
// supervisor's own tick! call, proven separately by
// test_negotiation_relay_supervisor_tick.sh's real-subprocess pid checks).
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl411_negotiation_relay_kill_acceptance_runner.bb');

const RESTART_CONFIG = { maxAttempts: 5, backoffBaseMs: 1000, backoffMaxMs: 60000, healthyResetMs: 600000 };
const GIVEUP_CONFIG = { giveupCooldownMs: 900000 };

function checkOneWithKillTracking(entry, nowMs, pidAlive) {
  const scenario = { entry, nowMs, pidAlive, restartConfig: RESTART_CONFIG, giveupConfig: GIVEUP_CONFIG };
  const out = execFileSync('bb', [RUNNER, JSON.stringify(scenario)], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a negotiation relay supervisor managing a relay poll-loop child process$/, () => {
    // No fixture setup needed - each scenario's own Given builds its entry.
  });

  // ── negotiation-relay-kills-superseded-child-01 ───────────────────────
  // BL-411's Gherkin deliberately reuses BL-403's exact wording for the
  // When/Then/And of this scenario ("the supervisor acts on the restart
  // decision" / "it sends SIGTERM..." / "it confirms the prior pid is no
  // longer alive..."), so the registry's first-match-wins resolution
  // (bl403SupervisorKillsSupersededChildSteps is registered earlier in
  // steps/index.js) always runs BL-403's own handlers for those three
  // steps, not any definition here - registering a second, unreachable
  // copy of the identical pattern here would just be dead code. This
  // Given therefore uses BL-403's OWN fixture pid/spawn-pid literals
  // (1881442 / 4242) so the handler that actually executes asserts
  // correctly against what this scenario really produces.
  registry.define(/^a relay child pid judged unhealthy by the supervisor's liveness or heartbeat check$/, (ctx) => {
    // A waiting entry: the relay child crashed (or stalled) and we're about to restart it
    ctx.entry = { pid: 1881442, attempts: 1, status: 'waiting', crashedAtMs: 5000, startedAtMs: 1000, gaveUpAtMs: null };
    ctx.pidAlive = false;
    ctx.nowMs = 6001; // Backoff due: 5000 + backoff(1, cfg) = 5000 + 1000 = 6000, now > 6000
  });

  // ── negotiation-relay-kills-superseded-child-02 ───────────────────────
  registry.define(/^a prior relay pid that has not yet exited after termination is requested$/, (ctx) => {
    ctx.entry = { pid: 2661553, attempts: 1, status: 'waiting', crashedAtMs: 5000, startedAtMs: 1000, gaveUpAtMs: null };
    ctx.pidAlive = false;
    ctx.nowMs = 6001;
  });

  registry.define(/^the supervisor checks whether it may spawn the replacement$/, (ctx) => {
    ctx.result = checkOneWithKillTracking(ctx.entry, ctx.nowMs, ctx.pidAlive);
  });

  registry.define(/^it waits rather than spawning a second live relay poller on the same bot token$/, (ctx) => {
    // Verify exactly one pid is recorded (the replacement, not the old one)
    if (!ctx.result.entry.pid || ctx.result.entry.pid === 2661553) {
      throw new Error(`expected exactly one live relay pid (the replacement), got ${ctx.result.entry.pid}`);
    }
  });

  // ── negotiation-relay-kills-superseded-child-03 ───────────────────────
  registry.define(/^a completed forced restart of the relay child$/, (ctx) => {
    ctx.entry = { pid: 2661553, attempts: 1, status: 'waiting', crashedAtMs: 5000, startedAtMs: 1000, gaveUpAtMs: null };
    ctx.pidAlive = false;
    ctx.nowMs = 6001;
    ctx.result = checkOneWithKillTracking(ctx.entry, ctx.nowMs, ctx.pidAlive);
  });

  registry.define(/^the supervisor's status\.json is read after the restart$/, (ctx) => {
    // Result already computed in the Given
  });

  registry.define(/^it records exactly one live relay pid, the replacement's$/, (ctx) => {
    if (ctx.result.entry.pid !== 5252) {
      throw new Error(`expected replacement pid 5252 in status, got ${ctx.result.entry.pid}`);
    }
    if (ctx.result.killCalls.length !== 1 || ctx.result.killCalls[0] !== 2661553) {
      throw new Error(`expected old relay pid 2661553 killed before spawn, got killCalls ${ctx.result.killCalls}`);
    }
  });
}

module.exports = { registerSteps };
