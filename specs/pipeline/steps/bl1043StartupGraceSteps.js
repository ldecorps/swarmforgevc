'use strict';

// BL-1043: step handlers for "every supervised child gets a real startup
// grace".
//
// BL-1035 gave poll-heartbeat-stale?'s FIVE-arity a working grace. The
// convenience arity below it still passed started-at-ms as nil, and the grace
// clause opens with (and started-at-ms ...), so it could never fire - the
// onboarder and negotiation-relay supervisors called exactly that arity and
// had no startup grace at all. Live, a child was declared stalled 2.00s after
// spawn against a declared 120000ms window.
//
// Scenarios 01-05 drive the REAL predicate through a bb subprocess with a
// pinned clock, the same way BL-1035's handlers do: the defect is a pure
// decision about three timestamps and which arity was called, so driving the
// decision is driving the thing that broke.
//
// Scenario 02's second Then is different in kind - "the stall is recorded
// with the window it exceeded" is a statement about the SUPERVISOR, not the
// predicate, and it is BL-1035's intake constraint that this ticket inherits
// and must not regress. So that one step boots the real onboarder supervisor
// against a fixture with a short grace and reads its actual log, rather than
// asserting over source text.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'Every supervised child gets a real startup grace';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const LIB = path.join(SCRIPTS, 'front_desk_supervisor_lib.bb');

// The onboarder's live values: a 120s stall window, and the 90s grace this
// ticket gives it. SPAWN_AT is an arbitrary pinned instant - no wall clock is
// read anywhere in this file.
const STALL_MS = 120000;
const GRACE_MS = 90000;
const SPAWN_AT = 500000;

// Two seconds in - the exact offset at which the live supervisor declared a
// freshly started child stalled.
const INSIDE_GRACE_AT = SPAWN_AT + 2000;

function bb(expr) {
  return execFileSync(
    'bb',
    ['-e', `(require '[babashka.fs :as fs])\n(load-file "${LIB}")\n${expr}`],
    { encoding: 'utf8' }
  ).trim();
}

// The call the two defective supervisors make now: spawn time named, grace
// length left to the library.
function staleWithDefaultedGrace({ heartbeat, now }) {
  const hb = heartbeat === null ? 'nil' : String(heartbeat);
  return (
    bb(`(println (front-desk-supervisor-lib/poll-heartbeat-stale? ${hb} ${now} ${STALL_MS} ${SPAWN_AT}))`) === 'true'
  );
}

function staleWithExplicitGrace({ heartbeat, now }) {
  const hb = heartbeat === null ? 'nil' : String(heartbeat);
  return (
    bb(
      `(println (front-desk-supervisor-lib/poll-heartbeat-stale? ${hb} ${now} ${STALL_MS} ${SPAWN_AT} ${GRACE_MS}))`
    ) === 'true'
  );
}

function verdict(ctx) {
  return ctx.graceLeftToTheLibrary
    ? staleWithDefaultedGrace({ heartbeat: ctx.heartbeat, now: ctx.now })
    : staleWithExplicitGrace({ heartbeat: ctx.heartbeat, now: ctx.now });
}

// ── the live supervisor, for the one step that is about the log ───────────
// Mirrors test_onboarder_supervisor_tick.sh's fixture: the real
// onboarder_supervisor.bb, a child that stays alive and writes no heartbeat
// of its own, and a stall window and grace short enough to elapse in the time
// a test can wait.
const LIVE_STALL_MS = 200;
const LIVE_GRACE_MS = 200;

function makeSupervisorFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1043-'));
  const swarm = path.join(dir, 'swarm');
  fs.mkdirSync(path.join(swarm, 'extension', 'out', 'tools'), { recursive: true });
  fs.mkdirSync(path.join(swarm, '.swarmforge', 'operator'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'fleet-home'), { recursive: true });
  for (const f of [
    'onboarder_supervisor.bb',
    'front_desk_supervisor_lib.bb',
    'swarm_identity_lib.bb',
    'fleet_telegram_creds_lib.bb',
    'process_table_lib.bb',
  ]) {
    fs.copyFileSync(path.join(SCRIPTS, f), path.join(swarm, f));
  }
  // Stays alive, never heartbeats: isolates the assertion to the supervisor's
  // own stall decision and its log line.
  fs.writeFileSync(
    path.join(swarm, 'extension', 'out', 'tools', 'onboarder-reconcile.js'),
    'setInterval(() => {}, 1000);\n'
  );
  return { dir, swarm };
}

function checkOnce({ dir, swarm }) {
  execFileSync('bb', [path.join(swarm, 'onboarder_supervisor.bb'), swarm, '--check-once'], {
    encoding: 'utf8',
    // 'ignore', NOT 'pipe'. The supervisor spawns its child with :out
    // :inherit, so the child inherits whatever handle bb was given - and a
    // pipe stays open for as long as that long-lived child holds it, which
    // makes execFileSync wait forever on a process that has already exited.
    stdio: 'ignore',
    env: {
      ...process.env,
      SWARMFORGE_FLEET_HOME: path.join(dir, 'fleet-home'),
      TELEGRAM_BOT_TOKEN: 'fake-token',
      TELEGRAM_CHAT_ID: 'fake-chat',
      ONBOARDER_STALL_MS: String(LIVE_STALL_MS),
      ONBOARDER_HEARTBEAT_STARTUP_GRACE_MS: String(LIVE_GRACE_MS),
    },
  });
}

function sleepMs(ms) {
  // A blocking wait, because the step runtime is synchronous. Bounded by
  // LIVE_GRACE_MS + LIVE_STALL_MS above, so this is fractions of a second.
  execFileSync('sleep', [String(ms / 1000)], { stdio: 'ignore' });
}

function killChild(swarm) {
  const statusFile = path.join(swarm, '.swarmforge', 'operator', 'onboarder-supervisor.status.json');
  if (!fs.existsSync(statusFile)) return;
  try {
    // By RECORDED PID only. A pattern kill here would match the live swarm's
    // own onboarder-reconcile.js on a developer host and take it down - this
    // fixture's child is the only one this step is entitled to touch.
    const pid = JSON.parse(fs.readFileSync(statusFile, 'utf8')).onboarder?.pid;
    if (pid) process.kill(pid, 'SIGKILL');
  } catch {
    // A child that is already gone is the outcome we wanted anyway.
  }
}

// Drives the real supervisor until it records a stall, and returns its log.
function supervisorLogAfterAStall() {
  const fixture = makeSupervisorFixture();
  try {
    checkOnce(fixture);
    // Past both the grace and the stall window, so the guard is armed and the
    // child - which never heartbeats - is genuinely stalled.
    sleepMs(LIVE_GRACE_MS + LIVE_STALL_MS + 100);
    checkOnce(fixture);
    return fs.readFileSync(
      path.join(fixture.swarm, '.swarmforge', 'operator', 'onboarder-supervisor.log'),
      'utf8'
    );
  } finally {
    // BL-971: in a finally, so a failed assertion above cannot leak the dir.
    killChild(fixture.swarm);
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a supervisor whose child reports liveness by heartbeat$/, (ctx) => {
    ctx.heartbeat = null;
    // Scenarios 01-04 speak of "the startup grace" as a thing the supervisor
    // asked for; scenario 05 is the one that deliberately does not.
    ctx.graceLeftToTheLibrary = false;
  });

  scoped(/^a staleness check called without an explicit startup grace$/, (ctx) => {
    // The whole point of scenario 05: the caller names a spawn time and NO
    // grace length. Under the retired 3-arity this was the shape with no
    // protection at all.
    ctx.graceLeftToTheLibrary = true;
  });

  scoped(/^a child that has just been spawned and has written no heartbeat$/, (ctx) => {
    ctx.spawnAt = SPAWN_AT;
    ctx.heartbeat = null;
  });

  scoped(/^a child that has just been spawned$/, (ctx) => {
    ctx.spawnAt = SPAWN_AT;
  });

  scoped(/^a heartbeat file left behind by an instance that is no longer running$/, (ctx) => {
    // Strictly before this child spawned, and already older than the stall
    // window - the two facts together are what condemned a replacement on its
    // first tick.
    ctx.heartbeat = SPAWN_AT - STALL_MS - 1;
    assert.ok(ctx.heartbeat < SPAWN_AT, 'a predecessor wrote it before this child existed');
  });

  scoped(/^the child writes its first heartbeat inside the startup grace$/, (ctx) => {
    ctx.heartbeat = SPAWN_AT + 1000;
    ctx.childSpokeForItself = true;
    assert.ok(ctx.heartbeat - SPAWN_AT < GRACE_MS, 'the child spoke while its grace was still running');
  });

  scoped(/^the supervisor checks it inside the startup grace$/, (ctx) => {
    ctx.now = INSIDE_GRACE_AT;
    assert.ok(ctx.now - SPAWN_AT < GRACE_MS, 'this check is meant to land inside the grace');
    ctx.verdict = verdict(ctx);
  });

  scoped(/^the supervisor checks it after the startup grace has passed$/, (ctx) => {
    // One millisecond past a full grace: the earliest instant at which
    // declaring a stall is the RIGHT answer, so it also pins the boundary.
    ctx.now = SPAWN_AT + GRACE_MS + 1;
    ctx.verdict = verdict(ctx);
  });

  scoped(/^the child is not declared stalled$/, (ctx) => {
    assert.equal(
      ctx.verdict,
      false,
      `a child ${ctx.now - SPAWN_AT}ms into a ${GRACE_MS}ms grace must not be declared stalled` +
        (ctx.graceLeftToTheLibrary ? ' - a caller that named no grace must still get one' : '')
    );
  });

  scoped(/^the child is declared stalled$/, (ctx) => {
    assert.ok(ctx.now - SPAWN_AT >= GRACE_MS, 'the grace must actually have elapsed for this to be the right verdict');
    assert.equal(
      ctx.verdict,
      true,
      'the grace ends - a child that never heartbeats must still be caught, or this fix deletes the stall check'
    );
  });

  scoped(/^the stall is recorded with the window it exceeded$/, () => {
    // BL-1035's intake constraint, inherited: the log must still name the
    // window, not merely say "stalled". Read off the real supervisor's log.
    const log = supervisorLogAfterAStall();
    const stalled = log.split('\n').filter((l) => l.includes(' stalled '));
    assert.ok(stalled.length > 0, `the supervisor recorded no stall at all:\n${log}`);
    for (const line of stalled) {
      assert.match(
        line,
        new RegExp(`no heartbeat within ${LIVE_STALL_MS} ms`),
        `a stall must name the window it exceeded, got: ${line}`
      );
    }
  });
}

module.exports = { registerSteps };
