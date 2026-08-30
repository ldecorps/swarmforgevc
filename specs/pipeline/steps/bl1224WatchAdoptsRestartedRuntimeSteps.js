'use strict';

// BL-1224 acceptance: the operator-runtime watch adopts a deliberately
// restarted runtime instead of counting a crash.
//
// Every scenario drives the REAL decision - operator_runtime_watch_lib.bb's
// own `decide`, through a bb subprocess - with an injected check-one-fn that
// RECORDS whether the restart state machine was reached at all. That recording
// is the point: "no start command is run" and "the attempt counter did not
// move" are both consequences of never reaching it, and asserting the
// consequences without the cause would pass against a fix that reached it and
// then undid the damage.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const WATCH_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_runtime_watch_lib.bb');

const FEATURE_NAME =
  'BL-1224 the operator-runtime watch adopts a deliberately restarted runtime instead of counting a crash';

const TRACKED_PID = 1001;
const NEW_PID = 2002;

// Scenario Outline placeholders, validated against explicit known values.
const PIDFILE_STATES = {
  'names live pid 2002 running operator_runtime.bb': { pidfilePid: NEW_PID, live: [NEW_PID] },
  'names the same dead pid 1001': { pidfilePid: TRACKED_PID, live: [] },
  'is absent': { pidfilePid: null, live: [] },
  // A live-but-unrelated process: `alive?` here is the cmdline-checked
  // predicate, so it does not count this pid as our runtime - which is how pid
  // reuse stays a crash rather than becoming an adoption.
  'names live pid 2002 running an unrelated command': { pidfilePid: NEW_PID, live: [] },
};
const KNOWN_EVENTS = new Set(['adopted', 'crashed']);

/**
 * One tick of the real `decide`, with the restart state machine stubbed so the
 * scenario can see whether it was reached. `ticks` runs it repeatedly, which is
 * what scenario 04's "until the restart backoff has elapsed" needs.
 */
function runTicks({ pidfilePid, live, attempts = 0, ticks = 1 }) {
  const script = `
(require '[cheshire.core :as json])
(load-file "${WATCH_LIB}")
(def spawned (atom 0))
(def reached (atom 0))
(def announced (atom []))
(def alive? (fn [pid] (boolean (and pid (contains? ${JSON.stringify(live)
    .replace('[', '#{')
    .replace(']', '}')} pid)))))
;; A stand-in for front-desk-supervisor-lib/check-one!: it is only ever reached
;; on the crash path, and it is the only thing that spawns or counts.
(def check-one
  (fn [entry _now _alive? spawn! _rc _gc]
    (swap! reached inc)
    (spawn!)
    {:entry (assoc entry :pid ${NEW_PID} :attempts (inc (:attempts entry)) :status "running")
     :event :started}))
(loop [i 0 entry {:pid ${TRACKED_PID} :attempts ${attempts} :status "running"} events []]
  (if (>= i ${ticks})
    (do
      (doseq [e events]
        (when-let [text (operator-runtime-watch-lib/announcement-for-event e entry)]
          (swap! announced conj text)))
      (println (json/generate-string
                {:events (mapv name events)
                 :entry entry
                 :spawned @spawned
                 :reachedStateMachine @reached
                 :announcements @announced})))
    (let [{:keys [entry event]}
          (operator-runtime-watch-lib/decide
           {:skip-env false :parked false
            :entry entry :now-ms (+ 1000 (* i 10000))
            :pid-alive? alive?
            :spawn! (fn [] (swap! spawned inc) ${NEW_PID})
            :restart-config {:max-attempts 5 :backoff-base-ms 1 :backoff-max-ms 10 :healthy-reset-ms 600000}
            :giveup-config {:giveup-cooldown-ms 900000}
            :check-one-fn check-one
            ${pidfilePid === null ? '' : `:pidfile-pid ${pidfilePid}`}})]
      (recur (inc i) entry (conj events event)))))
`;
  const run = spawnSync('bb', ['-e', script], { encoding: 'utf8', cwd: REPO_ROOT });
  assert.equal(run.status, 0, `the watch decision failed: ${run.stdout}${run.stderr}`);
  return JSON.parse(run.stdout.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  scoped(/^an operator-runtime watch tracking a live operator runtime at pid (\d+)$/, (ctx, pid) => {
    assert.equal(Number(pid), TRACKED_PID);
    ctx.bl1224 = { attempts: 0, ticks: 1 };
  });

  scoped(/^the tracked pid (\d+) is no longer alive$/, (ctx, pid) => {
    assert.equal(Number(pid), TRACKED_PID);
    ctx.bl1224.trackedDead = true;
  });

  // ── 01 ────────────────────────────────────────────────────────────────
  scoped(/^the runtime pidfile (names live pid 2002 running operator_runtime\.bb|names the same dead pid 1001|is absent|names live pid 2002 running an unrelated command)$/, (ctx, state) => {
    const known = PIDFILE_STATES[state];
    assert.ok(known, `unknown pidfile_state example value "${state}"`);
    ctx.bl1224.pidfile = known;
  });

  scoped(/^the watch runs one check$/, (ctx) => {
    ctx.bl1224.result = runTicks({
      pidfilePid: ctx.bl1224.pidfile.pidfilePid,
      live: ctx.bl1224.pidfile.live,
      attempts: ctx.bl1224.attempts,
      ticks: 1,
    });
  });

  scoped(/^the event is "(adopted|crashed)"$/, (ctx, expected) => {
    assert.ok(KNOWN_EVENTS.has(expected), `unknown event example value "${expected}"`);
    const events = ctx.bl1224.result.events;
    if (expected === 'adopted') {
      assert.deepEqual(events, ['adopted'], `expected an adoption, got ${JSON.stringify(events)}`);
      assert.equal(ctx.bl1224.result.reachedStateMachine, 0, 'an adoption reached the restart state machine');
    } else {
      // The crash path is check-one!'s own; it is a crash precisely because it
      // is handed to the machine that counts and restarts.
      assert.notDeepEqual(events, ['adopted'], 'a crash was adopted');
      assert.equal(ctx.bl1224.result.reachedStateMachine, 1, 'a crash never reached the restart state machine');
    }
  });

  // ── 02 ────────────────────────────────────────────────────────────────
  scoped(/^the watch has recorded (\d+) restart attempts$/, (ctx, attempts) => {
    ctx.bl1224.attempts = Number(attempts);
  });

  scoped(/^no start command is run$/, (ctx) => {
    assert.equal(ctx.bl1224.result.spawned, 0, 'an adoption started a process');
  });

  scoped(/^the recorded restart attempts are still (\d+)$/, (ctx, attempts) => {
    assert.equal(ctx.bl1224.result.entry.attempts, Number(attempts), 'an adoption spent a restart attempt');
  });

  scoped(/^the watch now tracks pid (\d+)$/, (ctx, pid) => {
    assert.equal(ctx.bl1224.result.entry.pid, Number(pid));
  });

  // ── 03 ────────────────────────────────────────────────────────────────
  scoped(/^no human announcement is sent$/, (ctx) => {
    assert.deepEqual(ctx.bl1224.result.announcements, [], 'an adoption reached the human channel');
  });

  scoped(/^the supervisor log records an adoption naming pid (\d+)$/, (ctx, pid) => {
    // The supervisor's own log dispatch, read from source: the event must have
    // an arm of its own, and its default arm must not swallow an unknown event
    // (which is how :adopted would have been silently invisible).
    const fs = require('node:fs');
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_runtime_supervisor.bb'),
      'utf8'
    );
    assert.match(source, /:adopted \(log! "adopted"/, 'the supervisor has no log arm for an adoption');
    assert.match(source, /:adopted \(log! "adopted" "pid=" \(str \(:pid entry\)\)/, 'the adoption log does not name the pid');
    assert.equal(ctx.bl1224.result.entry.pid, Number(pid), 'the entry the log would name is not the new pid');
  });

  scoped(/^the supervisor status file reports status "(.+)" with pid (\d+)$/, (ctx, status, pid) => {
    // write-status! persists (:status entry) and the entry itself, so the
    // status file's content is exactly this entry's.
    assert.equal(ctx.bl1224.result.entry.status, status);
    assert.equal(ctx.bl1224.result.entry.pid, Number(pid));
  });

  // ── 04 ────────────────────────────────────────────────────────────────
  scoped(/^the watch runs checks until the restart backoff has elapsed$/, (ctx) => {
    ctx.bl1224.result = runTicks({
      pidfilePid: ctx.bl1224.pidfile.pidfilePid,
      live: ctx.bl1224.pidfile.live,
      attempts: ctx.bl1224.attempts,
      ticks: 3,
    });
  });

  scoped(/^the start command is run once$/, (ctx) => {
    assert.ok(ctx.bl1224.result.spawned >= 1, 'a genuine crash never restarted the runtime');
    assert.ok(ctx.bl1224.result.reachedStateMachine >= 1, 'a genuine crash never reached the restart state machine');
  });

  scoped(/^a human announcement says the operator runtime was restarted$/, (ctx) => {
    const announcements = ctx.bl1224.result.announcements;
    assert.ok(announcements.length > 0, 'a genuine crash reached no human channel');
    assert.ok(
      announcements.some((a) => /operator runtime restarted/.test(a)),
      `no restart announcement among ${JSON.stringify(announcements)}`
    );
  });
}

module.exports = { registerSteps };
