'use strict';

// BL-1559: step handlers for "the bl983 runner constructs its seat
// schedule". Drives the REAL draw_schedule.bb lib via `bb -e` (BL-233,
// BL-1371), never a reimplementation of it - shelling the runner itself
// per mutant is exactly the shape the BL-1541 amendment retired against
// the BL-1358 300s ceiling, so scenarios 01/02 drive only the lib. Scenario
// 03 reads the runner's own source to confirm it still loads the lib and
// still asserts each floor literal.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1559 The bl983 runner constructs its seat schedule';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'lib', 'draw_schedule.bb');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl983_stage_queue_property_runner.bb');

const SEED_COUNT = 20;

function bb(expr) {
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' });
}

// Builds the SEED_COUNT schedules for `runs` draws via the real lib,
// printed as EDN and parsed here (never re-derived) - one `bb -e` call
// covers all 20 seeds so scenarios stay fast under the acceptance budget.
function buildSchedules(runs) {
  const expr =
    `(require '[cheshire.core :as json])\n` +
    `(load-file "${LIB}")\n` +
    `(println (json/generate-string (mapv (fn [seed] (draw-schedule-lib/seat-schedule ${runs} (java.util.Random. (long seed)))) (range ${SEED_COUNT}))))`;
  return JSON.parse(bb(expr));
}

function nSeats(plan) { return plan['n-seats']; }
function nParcels(plan) { return plan['n-parcels']; }

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the seat schedule for (\d+) draws is built under 20 distinct seeds$/, (ctx, runsStr) => {
    ctx.runs = Number(runsStr);
    ctx.schedules = buildSchedules(ctx.runs);
    assert.equal(ctx.schedules.length, SEED_COUNT, `expected ${SEED_COUNT} schedules, got ${ctx.schedules.length}`);
  });

  scoped(/^each of those schedules is (\d+) plans long$/, (ctx, runsStr) => {
    const expected = Number(runsStr);
    for (const [idx, schedule] of ctx.schedules.entries()) {
      assert.equal(schedule.length, expected, `schedule ${idx}: expected ${expected} plans, got ${schedule.length}`);
    }
  });

  scoped(/^every one of those schedules counts at least (\d+) (two-seat|three-seat|all-busy) plans$/, (ctx, floorStr, cell) => {
    const floor = Number(floorStr);
    const matches = {
      'two-seat': (plan) => nSeats(plan) === 2,
      'three-seat': (plan) => nSeats(plan) === 3,
      'all-busy': (plan) => nParcels(plan) >= nSeats(plan),
    }[cell];
    for (const [idx, schedule] of ctx.schedules.entries()) {
      const count = schedule.filter(matches).length;
      assert.ok(count >= floor, `schedule ${idx}: expected at least ${floor} ${cell} plans, got ${count} (schedule=${JSON.stringify(schedule)})`);
    }
  });

  scoped(/^at least two of those schedules differ in the order of their plans$/, (ctx) => {
    const orders = ctx.schedules.map((schedule) => schedule.map(nSeats).join(','));
    const uniqueOrders = new Set(orders).size;
    assert.ok(uniqueOrders >= 2, `expected at least two distinct plan orderings across ${SEED_COUNT} seeds, got ${uniqueOrders}: ${JSON.stringify(orders)}`);
  });

  scoped(/^every plan in every schedule names 2 or 3 seats and 1 to seats-plus-one parcels$/, (ctx) => {
    for (const [idx, schedule] of ctx.schedules.entries()) {
      for (const plan of schedule) {
        const seats = nSeats(plan);
        const parcels = nParcels(plan);
        assert.ok(seats === 2 || seats === 3, `schedule ${idx}: plan names ${seats} seats, expected 2 or 3: ${JSON.stringify(plan)}`);
        assert.ok(parcels >= 1 && parcels <= seats + 1, `schedule ${idx}: plan names ${parcels} parcels, expected 1..${seats + 1}: ${JSON.stringify(plan)}`);
      }
    }
  });

  scoped(/^the source of the bl983 runner is read$/, (ctx) => {
    ctx.runnerSource = fs.readFileSync(RUNNER, 'utf8');
  });

  scoped(/^it loads the draw schedule test lib$/, (ctx) => {
    assert.ok(
      /\(load-file[^\n]*draw_schedule\.bb[^\n]*\)/.test(ctx.runnerSource),
      'expected the runner to load-file lib/draw_schedule.bb',
    );
  });

  scoped(/^it still asserts the reach floor (.+)$/, (ctx, floorText) => {
    assert.ok(
      ctx.runnerSource.includes(floorText),
      `expected the runner source to still assert "${floorText}"`,
    );
  });
}

module.exports = { registerSteps };
