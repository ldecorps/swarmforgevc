'use strict';

// BL-481: step handlers for "Operator reacts out-of-cycle to a fresh
// inbound Telegram message". Drives the REAL pure decision logic
// operator_lib.bb exposes (next-poll-decision, resolve-poll-interval-ms,
// and the pre-existing timer-due? the swarm-check cadence already used)
// via operator_out_of_cycle_wake_acceptance_runner.bb - the same
// Babashka-runner pattern bl412DiskSpaceEarlyWarningAlertSteps.js already
// established, never a hand-rolled reimplementation of the decision in JS.
// The live -main loop wiring (poll!, cached-provider-state, the
// timer-due?-gated tick!/poll! split) is proven separately by
// swarmforge/scripts/test/test_operator_runtime_tick.sh's own BL-481
// section (a shell wiring test, since it drives a real --poll-once
// subprocess with real fixtures).
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'operator_out_of_cycle_wake_acceptance_runner.bb');

// Mirrors operator_runtime.bb's own defaults (OPERATOR_INTERVAL_MS,
// OPERATOR_POLL_INTERVAL_MS) - not re-derived from the runtime file itself,
// same posture as the disk-space steps' own KNOWN_READINGS table.
const FULL_INTERVAL_MS = 30000;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const SWARM_CHECK_MS = 1800000;

function runOp(scenario) {
  const out = execFileSync('bb', [RUNNER, JSON.stringify(scenario)], { encoding: 'utf8' });
  return JSON.parse(out);
}

function baseInput(ctx) {
  return {
    llmRunning: Boolean(ctx.llmRunning),
    frontDeskRunning: Boolean(ctx.frontDeskRunning),
    providerState: ctx.providerState || 'available',
    pendingCount: ctx.pendingCount || 0,
    frontDeskPendingCount: ctx.frontDeskPendingCount || 0,
    pollIntervalMs: ctx.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS,
  };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the Operator runtime tick loop is running$/, () => {});
  registry.define(/^no full Operator invocation is in progress$/, (ctx) => {
    ctx.llmRunning = false;
  });
  registry.define(/^the provider is not in cooldown$/, (ctx) => {
    ctx.providerState = 'available';
  });

  // ── operator-out-of-cycle-wake-01 ───────────────────────────────────────
  registry.define(/^the runtime has just finished a tick that launched nothing$/, (ctx) => {
    ctx.pendingCount = 0;
    ctx.frontDeskPendingCount = 0;
  });

  registry.define(/^the runtime decides how long to wait before the next tick$/, (ctx) => {
    ctx.result = runOp({ op: 'decision', input: baseInput(ctx) });
  });

  registry.define(/^the decided wait is the short out-of-cycle poll interval$/, (ctx) => {
    if (ctx.result.waitMs !== DEFAULT_POLL_INTERVAL_MS) {
      throw new Error(`expected the decided wait to be the short poll interval (${DEFAULT_POLL_INTERVAL_MS}ms), got: ${ctx.result.waitMs}ms`);
    }
  });

  registry.define(/^it is not the full OPERATOR_INTERVAL_MS$/, (ctx) => {
    if (ctx.result.waitMs === FULL_INTERVAL_MS) {
      throw new Error(`expected the decided wait to differ from the full OPERATOR_INTERVAL_MS (${FULL_INTERVAL_MS}ms), got the same value`);
    }
  });

  // ── operator-out-of-cycle-wake-02 ───────────────────────────────────────
  registry.define(/^a fresh inbound Telegram message addressed to the Operator arrives after a tick completes$/, (ctx) => {
    ctx.pendingCount = 1;
  });

  registry.define(/^the next out-of-cycle poll runs$/, (ctx) => {
    ctx.result = runOp({ op: 'decision', input: baseInput(ctx) });
  });

  registry.define(/^the runtime launches the Operator to handle that message$/, (ctx) => {
    if (!ctx.result.launch) {
      throw new Error(`expected the poll to launch the Operator, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^it does so within the short poll window$/, (ctx) => {
    // The launch already fired on THIS single poll evaluation (no extra
    // waiting ticks needed), and the very next poll after it is only
    // waitMs away - the short poll interval, never the full one.
    if (!ctx.result.launch || ctx.result.waitMs === FULL_INTERVAL_MS) {
      throw new Error(`expected dispatch within the short poll window, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── operator-out-of-cycle-wake-03 (Scenario Outline) ────────────────────
  registry.define(/^a fresh inbound Telegram message is pending$/, (ctx) => {
    ctx.pendingCount = 1;
    ctx.frontDeskPendingCount = 1;
  });

  registry.define(/^the runtime is in the "([^"]+)" state$/, (ctx, guard) => {
    ctx.guard = guard;
    if (guard === 'full-operator-running') {
      ctx.llmRunning = true;
    } else if (guard === 'front-desk-operator-running') {
      // should-launch-front-desk-operator? requires the full Operator to
      // already be running as its own precondition - the front-desk gate
      // is only ever eligible in that state (BL-334).
      ctx.llmRunning = true;
      ctx.frontDeskRunning = true;
    } else if (guard === 'provider-cooldown') {
      ctx.providerState = 'cooldown';
    } else {
      throw new Error(`operator-out-of-cycle-wake-03: unrecognized guard "${guard}"`);
    }
  });

  registry.define(/^no additional Operator invocation is launched for that message on this poll$/, (ctx) => {
    ctx.result = runOp({ op: 'decision', input: baseInput(ctx) });
    if (ctx.guard === 'front-desk-operator-running') {
      if (ctx.result.launchFrontDesk) {
        throw new Error(`expected no front-desk launch while front-desk-operator-running, got: ${JSON.stringify(ctx.result)}`);
      }
    } else if (ctx.result.launch) {
      throw new Error(`expected no launch while guard "${ctx.guard}" holds, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── operator-out-of-cycle-wake-04 ───────────────────────────────────────
  registry.define(/^several short out-of-cycle poll wakes occur within one swarm-check cadence$/, (ctx) => {
    // 600 wakes at the default 3000ms poll interval span 1,800,000ms minus
    // one poll step - just short of a second swarm-check-ms cadence, so
    // only the very first (nil-last-ms-is-due) wake should ever fire.
    ctx.pollSequenceInput = { swarmCheckMs: SWARM_CHECK_MS, pollIntervalMs: DEFAULT_POLL_INTERVAL_MS, pollCount: 600 };
  });

  registry.define(/^the runtime processes each of those wakes$/, (ctx) => {
    ctx.sequenceResult = runOp({ op: 'pollSequence', ...ctx.pollSequenceInput });
  });

  registry.define(/^the full health sweep fires at most once across them$/, (ctx) => {
    if (ctx.sequenceResult.fullSweepFireCount > 1) {
      throw new Error(`expected the full sweep to fire at most once, got: ${JSON.stringify(ctx.sequenceResult)}`);
    }
  });

  registry.define(/^it fires only when its swarm-check cadence is due$/, (ctx) => {
    // The one fire this window sees is the immediate first-ever-run fire
    // (index 0, the pre-existing "nil last-ms counts as due" rule) - never
    // a later index, which would mean it fired before its cadence elapsed.
    if (JSON.stringify(ctx.sequenceResult.firedAtIndex) !== JSON.stringify([0])) {
      throw new Error(`expected the sweep to fire only at the first due index [0], got: ${JSON.stringify(ctx.sequenceResult.firedAtIndex)}`);
    }
  });

  // ── operator-out-of-cycle-wake-05 ───────────────────────────────────────
  registry.define(/^the runtime is idle and listening for inbound messages$/, (ctx) => {
    ctx.pendingCount = 0;
  });

  registry.define(/^it schedules successive out-of-cycle polls$/, (ctx) => {
    ctx.resolvedWaits = [3000, 5000, 0, -500, undefined].map((configuredMs) => runOp({ op: 'resolvePollInterval', configuredMs }).resolvedMs);
  });

  registry.define(/^each wait is the bounded, env-overridable poll interval$/, (ctx) => {
    const [sane3000, sane5000] = ctx.resolvedWaits;
    if (sane3000 !== 3000 || sane5000 !== 5000) {
      throw new Error(`expected a sane configured value to pass through unchanged, got: ${JSON.stringify(ctx.resolvedWaits)}`);
    }
  });

  registry.define(/^no wait is a zero-delay spin$/, (ctx) => {
    if (ctx.resolvedWaits.some((ms) => ms <= 0)) {
      throw new Error(`expected every resolved wait to be a positive, non-zero delay, got: ${JSON.stringify(ctx.resolvedWaits)}`);
    }
  });
}

module.exports = { registerSteps };
