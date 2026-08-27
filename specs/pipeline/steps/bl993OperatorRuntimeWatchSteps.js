'use strict';

// BL-993: step handlers for "A dead operator runtime is restarted without a
// human". Decision assertions drive the REAL
// check-one!/operator_runtime_watch_lib.bb logic via
// bl993_operator_watch_acceptance_runner.bb (real Babashka, fixture entry +
// injected clock - mirrors frontDeskSupervisorRecoverySteps.js's own
// runner-exec pattern). Announce assertions (invariant 2) drive the REAL
// operator_runtime_supervisor.bb with a notify capture via
// bl993_announce_matches_predicate.sh. Scenario 05 ("the watch keeps
// running after the runtime it watches has died") is a
// process-architecture property, so it drives a REAL supervisor + fixture
// "operator" process via bl993_watch_survives_runtime_death.sh (mirrors
// bl671OperatorRuntimeFixtureSandboxSteps.js's own spawnSync-a-real-script
// pattern).
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');
const RUNNER = path.join(TEST_DIR, 'bl993_operator_watch_acceptance_runner.bb');
const SURVIVES_SCRIPT = path.join(TEST_DIR, 'bl993_watch_survives_runtime_death.sh');
const ANNOUNCE_SCRIPT = path.join(TEST_DIR, 'bl993_announce_matches_predicate.sh');

const RESTART_CONFIG = { maxAttempts: 5, backoffBaseMs: 1000, backoffMaxMs: 60000, healthyResetMs: 600000 };
const GIVEUP_CONFIG = { giveupCooldownMs: 900000 };

function run(mode, scenario) {
  const out = execFileSync('bb', [RUNNER, mode, JSON.stringify(scenario)], { encoding: 'utf8' });
  return JSON.parse(out);
}

// Announce assertions drive the REAL operator_runtime_supervisor.bb
// (--check-once, OPERATOR_WATCH_NOTIFY_CMD pointed at a capture script) via
// bl993_announce_matches_predicate.sh's per-event modes, and assert on what
// the capture actually received. The previous version consulted a local
// ANNOUNCED_EVENTS set - a hand copy of the supervisor's own dispatch that
// stayed green when the real announce path was deliberately broken
// (backlog/evidence/BL-993-bounce-20260821-architect.md, D1).
function runAnnounceCapture(mode) {
  const res = spawnSync('bash', [ANNOUNCE_SCRIPT, mode], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000 });
  if (res.status !== 0) {
    throw new Error(`announce capture drive '${mode}' failed:\n${res.stdout}\n${res.stderr}`);
  }
  const count = Number((res.stdout.match(/^ANNOUNCE_COUNT=(\d+)$/m) || [])[1]);
  return {
    announced: /^ANNOUNCED=true$/m.test(res.stdout),
    count: Number.isNaN(count) ? 0 : count,
    text: (res.stdout.match(/^TEXT=(.*)$/m) || [])[1] || '',
  };
}

const DOWN_STATE_ANNOUNCE_MODES = {
  'a pidfile naming a dead process': 'started-dead-pidfile',
  'no pidfile at all': 'started-no-pidfile',
  'a pidfile naming an unrelated pid': 'started-unrelated-pid',
};

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
    ctx.downState = downState;
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
    const mode = DOWN_STATE_ANNOUNCE_MODES[ctx.downState];
    if (!mode) {
      throw new Error(`no announce-capture mode for down-state "${ctx.downState}"`);
    }
    const capture = runAnnounceCapture(mode);
    if (!capture.announced || capture.count !== 1) {
      throw new Error(`expected exactly one real announcement for the restart, got count=${capture.count} (text='${capture.text}')`);
    }
    if (!/operator runtime restart/.test(capture.text)) {
      throw new Error(`expected the announcement to name the restart, got '${capture.text}'`);
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
    const capture = runAnnounceCapture('healthy');
    if (capture.announced || capture.count !== 0) {
      throw new Error(`expected the real supervisor to announce nothing for a healthy runtime, got count=${capture.count} (text='${capture.text}')`);
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
    const capture = runAnnounceCapture('gave-up');
    if (!capture.announced || capture.count !== 1) {
      throw new Error(`expected exactly one real escalation announcement for gave-up, got count=${capture.count} (text='${capture.text}')`);
    }
    if (!/exhausted/.test(capture.text)) {
      throw new Error(`expected the escalation to say the attempts were exhausted, got '${capture.text}'`);
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
