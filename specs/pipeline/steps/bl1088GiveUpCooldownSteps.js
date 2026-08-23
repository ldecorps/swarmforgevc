'use strict';

// BL-1088: step handlers for "a given-up child stays down for its whole
// cooldown".
//
// Every scenario drives the REAL check-one! in front_desk_supervisor_lib.bb
// through a bb subprocess with an injected clock, injected pid-liveness and an
// injected spawn counter. That function is pure by construction - now-ms,
// pid-alive? and spawn! are always passed in - so driving it directly IS
// driving the thing six supervisors share, with no supervisor process started.
//
// Scenario 03 is the one that is about a SEQUENCE rather than a decision: it
// ticks across a whole cooldown window and counts spawns, which is what turns
// "re-armed once" into "a 2-second hot loop in place of a 15-minute wait" -
// the thing the operator actually pays for.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'A given-up child stays down for its whole cooldown';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'front_desk_supervisor_lib.bb');

// The live default all six supervisors declare, and a tick cadence matching
// front_desk_supervisor.bb's own - so the numbers here are the real ones.
const COOLDOWN_MS = 900000;
const TICK_MS = 2000;
const GAVE_UP_AT = 1000000;
const MAX_ATTEMPTS = 5;

// Runs check-one! over a sequence of clock instants, returning the events, the
// final entry and the total spawn count. One bb process for the whole run, so
// a 450-tick sweep costs one startup rather than 450.
function driveTicks({ nowList, pidAlive, cooldownMs = COOLDOWN_MS, attempts = MAX_ATTEMPTS }) {
  const expr = `
(require '[babashka.fs :as fs] '[cheshire.core :as json])
(load-file "${LIB}")
(def spawns (atom 0))
(def killed (atom []))
(def spawn! (fn [] (swap! spawns inc) 9999))
(def kill! (fn [pid] (swap! killed conj pid)))
(def pid-alive? (constantly ${pidAlive ? 'true' : 'false'}))
(def cfg {:max-attempts ${MAX_ATTEMPTS} :backoff-base-ms 1000 :backoff-max-ms 60000 :healthy-reset-ms 300000})
(def giveup-cfg {:giveup-cooldown-ms ${cooldownMs}})
(loop [entry {:pid 4242 :attempts ${attempts} :status "gave-up" :crashed-at-ms 5000
              :started-at-ms 1000 :gave-up-at-ms ${GAVE_UP_AT}}
       nows ${JSON.stringify(nowList)}
       events []]
  (if-let [now (first nows)]
    (let [r (front-desk-supervisor-lib/check-one! entry now pid-alive? spawn! cfg giveup-cfg false kill!)]
      (recur (:entry r) (rest nows) (conj events (:event r))))
    (println (json/generate-string {:events events :entry entry
                                    :spawns @spawns :killed @killed}))))`;
  return JSON.parse(execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a supervisor whose child has exhausted its restart budget and reached give-up$/,
    (ctx) => {
      ctx.cooldownMs = COOLDOWN_MS;
      ctx.pidAlive = false;
    }
  );

  scoped(/^the give-up cooldown has not yet elapsed$/, (ctx) => {
    // Five seconds in, of fifteen minutes - the shape the retired assertion
    // called "immediately".
    ctx.now = GAVE_UP_AT + 5000;
    assert.ok(ctx.now - GAVE_UP_AT < ctx.cooldownMs, 'this step must land inside the cooldown');
  });

  scoped(/^the give-up cooldown has elapsed$/, (ctx) => {
    ctx.now = GAVE_UP_AT + ctx.cooldownMs;
  });

  scoped(/^the given-up child's recorded process is (dead|still alive)$/, (ctx, state) => {
    // The whole defect: "dead" used to bypass the cooldown, and a child that
    // crash-looped into give-up is ALWAYS dead.
    ctx.pidAlive = state === 'still alive';
  });

  scoped(/^the supervisor is configured with a shorter cooldown than the default$/, (ctx) => {
    // The sanctioned lever - every one of the six supervisors already reads
    // its own *_GIVEUP_COOLDOWN_MS.
    ctx.cooldownMs = 3000;
    assert.ok(ctx.cooldownMs < COOLDOWN_MS, 'shorter than the default is the point');
  });

  scoped(/^a child that fails every time it is started$/, (ctx) => {
    ctx.pidAlive = false;
    ctx.alwaysFails = true;
  });

  scoped(/^the supervisor checks the child$/, (ctx) => {
    ctx.result = driveTicks({ nowList: [ctx.now], pidAlive: ctx.pidAlive, cooldownMs: ctx.cooldownMs });
  });

  scoped(/^the supervisor checks the child after that shorter cooldown has elapsed$/, (ctx) => {
    ctx.now = GAVE_UP_AT + ctx.cooldownMs;
    ctx.result = driveTicks({ nowList: [ctx.now], pidAlive: ctx.pidAlive, cooldownMs: ctx.cooldownMs });
  });

  scoped(/^the supervisor ticks repeatedly for the length of one cooldown window$/, (ctx) => {
    // The real cadence across the real window: 450 ticks of 2000ms. Before the
    // fix this respawned on every one of them.
    const nowList = [];
    for (let t = GAVE_UP_AT + TICK_MS; t < GAVE_UP_AT + COOLDOWN_MS; t += TICK_MS) {
      nowList.push(t);
    }
    assert.ok(nowList.length > 400, `the window must be swept properly, got ${nowList.length} ticks`);
    ctx.tickCount = nowList.length;
    ctx.result = driveTicks({ nowList, pidAlive: false, cooldownMs: COOLDOWN_MS });
  });

  scoped(/^the child is still given up$/, (ctx) => {
    assert.equal(
      ctx.result.entry.status,
      'gave-up',
      `expected the child to stay given up ${ctx.now - GAVE_UP_AT}ms into a ${ctx.cooldownMs}ms cooldown, got: ${JSON.stringify(ctx.result.entry)}`
    );
    assert.deepEqual(ctx.result.events, [null], `expected no event, got: ${JSON.stringify(ctx.result.events)}`);
  });

  scoped(/^no replacement is spawned$/, (ctx) => {
    assert.equal(ctx.result.spawns, 0, `expected no spawn inside the cooldown, got ${ctx.result.spawns}`);
    // The exhausted budget is not quietly reset either - resetting it is half
    // of what made the loop unbounded.
    assert.equal(
      ctx.result.entry.attempts,
      MAX_ATTEMPTS,
      `the spent budget must not reset inside the cooldown, got ${ctx.result.entry.attempts}`
    );
  });

  scoped(/^the child is respawned with a fresh restart budget$/, (ctx) => {
    assert.equal(ctx.result.entry.status, 'running', `expected a re-arm, got: ${JSON.stringify(ctx.result.entry)}`);
    assert.deepEqual(ctx.result.events, ['re-armed'], `expected :re-armed, got: ${JSON.stringify(ctx.result.events)}`);
    assert.equal(ctx.result.spawns, 1, `expected exactly one spawn, got ${ctx.result.spawns}`);
    // BL-303's guarantee: give-up is TIMED, never terminal.
    assert.equal(ctx.result.entry.attempts, 1, `expected a fresh budget, got ${ctx.result.entry.attempts}`);
  });

  scoped(
    /^any process still recorded against the given-up child is terminated before the replacement spawns$/,
    (ctx) => {
      // BL-403, which removing the dead-pid disjunct must not remove: a
      // gave-up entry's pid can still be alive, since "stalled" is entered
      // from "running" without ever checking liveness.
      assert.deepEqual(
        ctx.result.killed,
        [4242],
        `the recorded process must be killed before the re-arm spawn, got: ${JSON.stringify(ctx.result.killed)}`
      );
    }
  );

  scoped(/^the child is started no more times than its configured attempt cap allows$/, (ctx) => {
    // Before the fix this was one spawn PER TICK - 449 of them across the
    // window, with the budget reset each time, which is the unbounded loop.
    assert.equal(
      ctx.result.spawns,
      0,
      `a child already at its cap must not be started again inside the cooldown; ` +
        `got ${ctx.result.spawns} spawn(s) across ${ctx.tickCount} ticks`
    );
    assert.ok(
      ctx.result.events.every((e) => e === null),
      `no tick inside the window may produce an event, got: ${JSON.stringify([...new Set(ctx.result.events)])}`
    );
  });
}

module.exports = { registerSteps };
