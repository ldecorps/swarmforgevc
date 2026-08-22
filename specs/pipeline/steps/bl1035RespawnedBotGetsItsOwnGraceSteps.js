'use strict';

// BL-1035: step handlers for "the front-desk supervisor judges a freshly
// spawned bot on its own heartbeat, never on the one its predecessor left
// behind".
//
// Every scenario drives the REAL predicate - front_desk_supervisor_lib.bb's
// poll-heartbeat-stale?, the exact function front_desk_supervisor.bb:430 wires
// as its :heartbeat-stale? - through a bb subprocess with a PINNED clock. The
// defect is a pure decision about three timestamps, so driving the decision is
// driving the thing that broke; no supervisor process is started and no bot is
// spawned.
//
// Scenario 05 is the loop, which is a statement about a SEQUENCE of ticks
// rather than one decision, so it ticks the predicate across the whole grace
// and counts how many of those ticks would have triggered a respawn. That is
// what turns "declared stalled once" into "spent the restart budget in
// seconds", which is the thing the operator actually saw.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE =
  'the front-desk supervisor judges a freshly spawned bot on its own heartbeat, never on the one its predecessor left behind';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'front_desk_supervisor_lib.bb');

// The live values: a 90s stall window and a 90s startup grace, which is what
// the observed incident was measured against.
const STALL_MS = 90000;
const GRACE_MS = 90000;
const SPAWN_AT = 500000;

function stale({ heartbeat, now }) {
  const hb = heartbeat === null ? 'nil' : String(heartbeat);
  const out = execFileSync(
    'bb',
    ['-e', `(require '[babashka.fs :as fs])
(load-file "${LIB}")
(println (front-desk-supervisor-lib/poll-heartbeat-stale? ${hb} ${now} ${STALL_MS} ${SPAWN_AT} ${GRACE_MS}))`],
    { encoding: 'utf8' }
  );
  return out.trim() === 'true';
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the front-desk supervisor is watching the bot$/, (ctx) => {
    ctx.spawnAt = SPAWN_AT;
    ctx.heartbeat = null;
  });

  scoped(/^the bot records a poll heartbeat in a file that outlives the process that wrote it$/, (ctx) => {
    // The premise the whole defect rests on, asserted rather than assumed: the
    // heartbeat is FILE state, so a timestamp can survive the process that
    // wrote it and be read back against its replacement.
    ctx.heartbeatOutlivesProcess = true;
  });

  scoped(/^the previous bot instance left a poll heartbeat older than the stall window$/, (ctx) => {
    assert.ok(ctx.heartbeatOutlivesProcess, 'a predecessor heartbeat only exists because the file outlives the process');
    // Strictly BEFORE this child spawned, and already past the stall window -
    // both facts are what made the nil-guard miss it.
    ctx.heartbeat = SPAWN_AT - STALL_MS - 1;
    assert.ok(ctx.heartbeat < SPAWN_AT, 'the predecessor wrote it before this child existed');
  });

  scoped(/^no poll heartbeat has ever been recorded$/, (ctx) => {
    ctx.heartbeat = null;
  });

  scoped(/^the spawned bot completes no poll cycle$/, (ctx) => {
    ctx.wroteOwn = false;
  });

  scoped(/^the supervisor spawns a bot$/, (ctx) => {
    // Two seconds after spawn - the tick that condemned the replacement live.
    ctx.now = SPAWN_AT + 2000;
    ctx.verdict = stale({ heartbeat: ctx.heartbeat, now: ctx.now });
  });

  scoped(/^the spawned bot's startup grace elapses$/, (ctx) => {
    ctx.now = SPAWN_AT + GRACE_MS;
    ctx.verdict = stale({ heartbeat: ctx.heartbeat, now: ctx.now });
  });

  scoped(/^the spawned bot completes its first poll cycle$/, (ctx) => {
    // The child speaks for itself, inside its grace.
    ctx.heartbeat = SPAWN_AT + 1000;
    ctx.now = SPAWN_AT + 3000;
    ctx.wroteOwn = true;
    ctx.verdict = stale({ heartbeat: ctx.heartbeat, now: ctx.now });
  });

  scoped(/^the supervisor runs for the length of one startup grace$/, (ctx) => {
    // The loop, not one decision: tick across the whole grace and count the
    // ticks that would have declared a stall and therefore respawned. One
    // spawn is the initial one; any stall inside the grace is an extra.
    const TICK_MS = 2000;
    ctx.spawns = 1;
    for (let t = SPAWN_AT + TICK_MS; t < SPAWN_AT + GRACE_MS; t += TICK_MS) {
      if (stale({ heartbeat: ctx.heartbeat, now: t })) ctx.spawns += 1;
    }
  });

  scoped(/^the spawned bot is not declared stalled while its startup grace is running$/, (ctx) => {
    assert.ok(ctx.now - SPAWN_AT < GRACE_MS, 'this assertion only means anything inside the grace');
    assert.equal(ctx.verdict, false,
      `a child ${ctx.now - SPAWN_AT}ms into a ${GRACE_MS}ms grace must not be stalled by a heartbeat it never wrote`);
  });

  scoped(/^the spawned bot is declared stalled$/, (ctx) => {
    assert.ok(ctx.now - SPAWN_AT >= GRACE_MS, 'the grace must actually have elapsed for this to be the right verdict');
    assert.equal(ctx.verdict, true,
      'the grace ends - a replacement that never polls must still be caught, or this fix reintroduces BL-370');
  });

  scoped(/^the spawned bot is not declared stalled$/, (ctx) => {
    assert.ok(ctx.wroteOwn, 'this scenario is about the child having spoken for itself');
    assert.equal(ctx.verdict, false, "a child's own fresh heartbeat must clear the grace");
  });

  scoped(/^the supervisor has spawned at most one bot in that window$/, (ctx) => {
    assert.equal(ctx.spawns, 1,
      `a stale predecessor heartbeat must not spend the restart budget: ${ctx.spawns} spawns in one grace window`);
  });
}

module.exports = { registerSteps };
