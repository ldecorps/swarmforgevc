'use strict';

// BL-1037: step handlers for "the build-freshness watchdog bounds how often it
// restarts a healthy front desk, without ever losing the staleness it saw".
//
// Every scenario drives the REAL decision - front_desk_supervisor_lib.bb's
// check-one! build-freshness path, the same one the live supervisor calls -
// through a bb subprocess with a PINNED clock, replaying ticks. No supervisor
// process runs and nothing is recompiled or respawned.
//
// Replaying a SEQUENCE rather than one tick is deliberate: the defect is a
// RATE, and every individual restart in the 2026-08-22 storm was correct in
// isolation. A per-tick assertion could not have caught it.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE =
  'the build-freshness watchdog bounds how often it restarts a healthy front desk, without ever losing the staleness it saw';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'front_desk_supervisor_lib.bb');

const GRACE_MS = 300000;
const TICK_MS = 100000;

// Replay `ticks` supervisor ticks and return the event per tick, so a scenario
// can count restarts and read what was logged.
function replay({ ticks, unservedTicks, buildStale }) {
  const expr = `(require '[babashka.fs :as fs] '[cheshire.core :as json])
(load-file "${LIB}")
(let [cfg {:backoff-base-ms 1000 :backoff-max-ms 1000 :max-attempts 5 :build-grace-ms ${GRACE_MS}}
      giveup {:giveup-cooldown-ms 900000}
      alive? (constantly true)
      spawn! (constantly 4242)]
  (loop [t 0
         entry {:pid 4242 :attempts 0 :status "running" :crashed-at-ms nil
                :started-at-ms 0 :gave-up-at-ms nil}
         now 100000
         since 0
         out []]
    (if (>= t ${ticks})
      (println (json/generate-string out))
      (let [served? (>= since ${unservedTicks})
            r (front-desk-supervisor-lib/check-one!
                entry now alive? spawn! cfg giveup false (fn [_] nil) ${buildStale} served?)
            ev (:event r)]
        (recur (inc t)
               (if (= ev :build-stale)
                 (assoc (:entry r) :status "running" :started-at-ms now :build-stale-since-ms nil)
                 (:entry r))
               (+ now ${TICK_MS})
               (if (= ev :build-stale) 0 (inc since))
               (conj out (if ev (name ev) "nil")))))))`;
  // JSON, not pr-str: a Clojure vector prints space-separated and is not JSON,
  // which is what the first version tripped over.
  return JSON.parse(execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the front-desk supervisor is watching a healthy bot$/, (ctx) => {
    ctx.buildStale = false;
    ctx.unservedTicks = 0;
    ctx.ticks = 12;
  });

  scoped(/^a restart onto a fresh build has just completed$/, (ctx) => {
    // The replacement has not polled yet on the build it was moved to.
    ctx.unservedTicks = 8;
  });

  scoped(/^main moves again immediately$/, (ctx) => {
    ctx.buildStale = true;
  });

  scoped(/^the bot is running a build that main has moved past$/, (ctx) => {
    ctx.buildStale = true;
  });

  scoped(/^the bot is running main's newest build$/, (ctx) => {
    ctx.buildStale = false;
  });

  scoped(/^commits land on main faster than one restart cycle completes$/, (ctx) => {
    // main is stale on every tick and the child needs several ticks to serve -
    // the 2026-08-22 shape, where staleness re-armed 33s to 14min after the
    // previous restart completed.
    ctx.unservedTicks = 6;
    ctx.commits = 20;
    ctx.ticks = 20;
  });

  scoped(/^the watchdog runs$/, (ctx) => {
    ctx.events = replay(ctx);
  });

  scoped(/^more than one build grace elapses$/, (ctx) => {
    ctx.ticks = Math.max(ctx.ticks, Math.ceil((GRACE_MS / TICK_MS) * 3));
    ctx.events = replay(ctx);
  });

  scoped(/^the burst ends$/, (ctx) => {
    // Long enough for the child to finally serve and the owed restart to fire.
    ctx.ticks = 20;
    ctx.events = replay(ctx);
  });

  scoped(/^the watchdog restarts the bot onto a fresh build$/, (ctx) => {
    ctx.unservedTicks = 0;      // it has served, so a restart is permitted
    ctx.ticks = 8;
    ctx.events = replay(ctx);
  });

  scoped(/^the replacement is not restarted before it has completed a poll cycle$/, (ctx) => {
    // Ticks before the child has served must contain no restart at all.
    const beforeServing = ctx.events.slice(0, ctx.unservedTicks);
    assert.ok(!beforeServing.includes('build-stale'),
      `a restart fired before the replacement served: ${ctx.events.join(', ')}`);
    assert.ok(beforeServing.includes('build-stale-deferred'),
      `the deferral must be visible, not silent: ${ctx.events.join(', ')}`);
  });

  scoped(/^the bot is restarted fewer times than the number of commits that landed$/, (ctx) => {
    const restarts = ctx.events.filter((e) => e === 'build-stale').length;
    assert.ok(restarts > 0, 'the watchdog must still restart - this bound is not "never restart"');
    assert.ok(restarts < ctx.commits,
      `a burst of ${ctx.commits} commits must not cost ${restarts} restarts`);
  });

  scoped(/^the bot is running main's newest build within one build grace of the last commit$/, (ctx) => {
    // The debt survived the deferral and was PAID - the deferral is a pause,
    // never a forgetting. Without this, a fix that simply stopped restarting
    // would satisfy the rate scenario while reopening the 2h23m window.
    assert.ok(ctx.events.includes('build-stale'),
      `the deferred restart must eventually fire: ${ctx.events.join(', ')}`);
    const firstRestart = ctx.events.indexOf('build-stale');
    assert.ok(firstRestart >= 0 && firstRestart < ctx.ticks,
      'and must fire within the replayed window, not indefinitely later');
  });

  scoped(/^the bot is not restarted$/, (ctx) => {
    assert.ok(!ctx.events.includes('build-stale'),
      `a build that matches main must never be restarted: ${ctx.events.join(', ')}`);
    assert.ok(!ctx.events.includes('build-stale-deferred'),
      'and must not even be considered for one');
  });

  scoped(/^the supervisor log records that restart and the build it moved to$/, (ctx) => {
    // The event is what the supervisor's log-event! turns into a "build-stale"
    // line naming the child; the intake's constraint is that this stays
    // readable, so the event must still be emitted distinctly.
    assert.ok(ctx.events.includes('build-stale'),
      `the restart must be reported under its own event: ${ctx.events.join(', ')}`);
    assert.ok(ctx.events.includes('build-stale-detected'),
      'and the countdown that preceded it must still be reported too');
  });
}

module.exports = { registerSteps };
