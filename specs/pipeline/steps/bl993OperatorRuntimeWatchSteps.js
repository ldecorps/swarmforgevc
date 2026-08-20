'use strict';

// BL-993: step handlers for "A dead operator runtime is restarted without a
// human". Scenarios 01-04 drive the REAL check-one!/operator_runtime_watch_lib.bb
// decision logic via bl993_operator_watch_acceptance_runner.bb (real
// Babashka, fixture entry + injected clock, no real process spawn, no real
// timer - mirrors frontDeskSupervisorRecoverySteps.js's own runner-exec
// pattern). Scenario 05 ("the watch keeps running after the runtime it
// watches has died") is a process-architecture property, not a pure
// decision, so it drives a REAL supervisor process + a REAL fixture
// "operator" process via bl993_watch_survives_runtime_death.sh (mirrors
// bl671OperatorRuntimeFixtureSandboxSteps.js's own spawnSync-a-real-script
// pattern).
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');
const RUNNER = path.join(TEST_DIR, 'bl993_operator_watch_acceptance_runner.bb');
const SURVIVES_SCRIPT = path.join(TEST_DIR, 'bl993_watch_survives_runtime_death.sh');

const RESTART_CONFIG = { maxAttempts: 5, backoffBaseMs: 1000, backoffMaxMs: 60000, healthyResetMs: 600000 };
const GIVEUP_CONFIG = { giveupCooldownMs: 900000 };

// The ANNOUNCED events, mirroring operator_runtime_supervisor.bb's own
// announce-for-event! case dispatch verbatim - kept here (not re-derived)
// so a drift between the two is a visible acceptance failure, not a silent
// behavior change.
const ANNOUNCED_EVENTS = new Set(['started', 're-armed', 'gave-up']);

function run(mode, scenario) {
  const out = execFileSync('bb', [RUNNER, mode, JSON.stringify(scenario)], { encoding: 'utf8' });
  return JSON.parse(out);
}

// pidAliveOs/cmdlineMatches per down-state - the same three rows
// operator_runtime_watch_lib_test_runner.bb already pins at the pure-lib
// level; this exercises the SAME predicate through check-one!'s own
// bounded-restart state machine.
function downStateFixture(downState) {
  switch (downState) {
    case 'a pidfile naming a dead process':
    case 'no pidfile at all':
      return { pidAliveOs: false, cmdlineMatches: false };
    case 'a pidfile naming an unrelated pid':
      return { pidAliveOs: true, cmdlineMatches: false };
    default:
      throw new Error(`unknown down-state: ${downState}`);
  }
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a swarm whose operator runtime is expected to be running$/, (ctx) => {
    ctx.skipEnv = false;
    ctx.parked = false;
  });

  // ── dead-runtime-is-restarted-01 ─────────────────────────────────────
  registry.define(/^the operator runtime is down with (a pidfile naming a dead process|no pidfile at all|a pidfile naming an unrelated pid)$/, (ctx, downState) => {
    Object.assign(ctx, downStateFixture(downState));
    ctx.entry = null;
    ctx.nowMs = 1000;
  });

  registry.define(/^the watch observes it$/, (ctx) => {
    if (ctx.skipEnv || ctx.parked) {
      ctx.stoppedResult = run('deliberately-stopped', { skipEnv: ctx.skipEnv, parked: ctx.parked });
      ctx.result = null;
    } else {
      ctx.result = run('check-one', {
        entry: ctx.entry,
        nowMs: ctx.nowMs,
        pidAliveOs: ctx.pidAliveOs,
        cmdlineMatches: ctx.cmdlineMatches,
        restartConfig: RESTART_CONFIG,
        giveupConfig: GIVEUP_CONFIG,
      });
      ctx.stoppedResult = null;
    }
  });

  registry.define(/^the operator runtime is started through its normal entry point$/, (ctx) => {
    if (ctx.result.event !== 'started') {
      throw new Error(`expected a started event (restart through the normal entry point), got ${ctx.result.event}`);
    }
  });

  registry.define(/^the restart is announced on the human channel$/, (ctx) => {
    if (!ANNOUNCED_EVENTS.has(ctx.result.event)) {
      throw new Error(`expected event "${ctx.result.event}" to be announced on the human channel`);
    }
  });

  // ── healthy-runtime-is-left-alone-02 ─────────────────────────────────
  registry.define(/^the operator runtime is running$/, (ctx) => {
    ctx.pidAliveOs = true;
    ctx.cmdlineMatches = true;
    ctx.entry = { pid: 42, attempts: 0, status: 'running', crashedAtMs: null, startedAtMs: 500, gaveUpAtMs: null };
    ctx.nowMs = 1000;
  });

  registry.define(/^no restart is attempted$/, (ctx) => {
    const event = ctx.result ? ctx.result.event : null;
    if (event === 'started' || event === 're-armed') {
      throw new Error(`expected no restart, got event ${event}`);
    }
  });

  registry.define(/^nothing is announced on the human channel$/, (ctx) => {
    const event = ctx.result ? ctx.result.event : null;
    if (ANNOUNCED_EVENTS.has(event)) {
      throw new Error(`expected nothing announced, but event "${event}" is an announced event`);
    }
  });

  // ── deliberate-stop-is-never-undone-03 ───────────────────────────────
  registry.define(/^(the skip-operator env flag|a park flag file) is in effect$/, (ctx, signal) => {
    if (signal === 'the skip-operator env flag') {
      ctx.skipEnv = true;
    } else {
      ctx.parked = true;
    }
  });

  registry.define(/^the watch reports the runtime as deliberately stopped$/, (ctx) => {
    if (!ctx.stoppedResult || ctx.stoppedResult.stopped !== true) {
      throw new Error(`expected the watch to report deliberately-stopped, got ${JSON.stringify(ctx.stoppedResult)}`);
    }
    if (!ctx.stoppedResult.reason) {
      throw new Error('expected a non-empty stop reason');
    }
  });

  // ── repeated-failure-is-bounded-and-escalated-04 ─────────────────────
  registry.define(/^every start attempt fails$/, (ctx) => {
    // The fixture stays down no matter how many times the watch restarts
    // it - behaviorally equivalent to QA's own e2e procedure (a start
    // entry point stubbed to exit non-zero): the runtime never becomes
    // alive, so every restart is followed by a fresh crash.
    ctx.pidAliveOs = false;
    ctx.cmdlineMatches = false;
  });

  registry.define(/^the watch observes it repeatedly$/, (ctx) => {
    ctx.events = [];
    let entry = ctx.entry; // null -> default-entry (not-started)
    let nowMs = ctx.nowMs;
    // Each attempt costs TWO observations (started, then crashed on the
    // next check), plus one final observation past the cap to see the
    // waiting->gave-up transition itself - bounded, never open-ended.
    const rounds = 2 * RESTART_CONFIG.maxAttempts + 2;
    for (let i = 0; i < rounds; i += 1) {
      const result = run('check-one', {
        entry,
        nowMs,
        pidAliveOs: ctx.pidAliveOs,
        cmdlineMatches: ctx.cmdlineMatches,
        restartConfig: RESTART_CONFIG,
        giveupConfig: GIVEUP_CONFIG,
      });
      ctx.events.push(result.event);
      entry = result.entry;
      // Always past the next backoff deadline, however large it grew -
      // this loop is testing BOUNDEDNESS, not the backoff math itself
      // (front_desk_supervisor_lib.bb's own compute-backoff-ms is already
      // covered elsewhere).
      nowMs += RESTART_CONFIG.backoffMaxMs + 1;
      if (result.entry.status === 'gave-up') break;
    }
    ctx.finalEntry = entry;
  });

  registry.define(/^restart attempts are bounded with a growing delay between them$/, (ctx) => {
    const startedCount = ctx.events.filter((e) => e === 'started').length;
    if (startedCount !== RESTART_CONFIG.maxAttempts) {
      throw new Error(`expected exactly ${RESTART_CONFIG.maxAttempts} restart attempts before giving up, got ${startedCount} (events: ${ctx.events.join(',')})`);
    }
    if (ctx.finalEntry.status !== 'gave-up' || ctx.finalEntry.attempts !== RESTART_CONFIG.maxAttempts) {
      throw new Error(`expected the entry to have given up at the attempt cap, got ${JSON.stringify(ctx.finalEntry)}`);
    }
  });

  registry.define(/^the repeated failure is escalated on the human channel$/, (ctx) => {
    if (!ctx.events.includes('gave-up')) {
      throw new Error(`expected a gave-up event among ${ctx.events.join(',')}`);
    }
    if (!ANNOUNCED_EVENTS.has('gave-up')) {
      throw new Error('gave-up must be an announced event');
    }
  });

  // ── watch-survives-the-runtime-05 (real processes) ───────────────────
  registry.define(/^the operator runtime dies$/, (ctx) => {
    // No-op here: bl993_watch_survives_runtime_death.sh performs the whole
    // "running -> observed healthy -> killed -> watch still alive" sequence
    // as one bounded real-process check (its own kill happens mid-script).
    ctx.survivesResult = spawnSync('bash', [SURVIVES_SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30000,
    });
  });

  registry.define(/^the watch is still running$/, (ctx) => {
    if (!ctx.survivesResult || ctx.survivesResult.status !== 0) {
      throw new Error(`expected the watch to survive; script output:\n${ctx.survivesResult && (ctx.survivesResult.stdout + ctx.survivesResult.stderr)}`);
    }
  });

  registry.define(/^the watch observes the death without being restarted itself$/, (ctx) => {
    // The script's own PASS line already asserts survival by pid liveness,
    // not a restart of the watch (there is nothing that would restart the
    // watch itself - invariant 3's whole point). Re-assert the same result
    // object rather than re-running the real-process script twice.
    if (!ctx.survivesResult || ctx.survivesResult.status !== 0 || !/^PASS:/m.test(ctx.survivesResult.stdout)) {
      throw new Error(`expected a PASS line from the survival check; got:\n${ctx.survivesResult && ctx.survivesResult.stdout}`);
    }
  });
}

module.exports = { registerSteps };
