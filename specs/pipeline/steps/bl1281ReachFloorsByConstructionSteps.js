'use strict';

// BL-1281 acceptance: bl1048's reach floors are met by construction rather
// than by a lucky seed, none of them was lowered to get there, and the shared
// assertion still refuses a genuinely unreached value.
//
// Scenario 01 runs the REAL property test at explicit seeds - a replay of the
// generator would be the cheaper instrument, and the wrong one here, because
// what the scenario claims is that the shipped test passes whatever the seed.
// Scenarios 02 and 03 drive the real modules (helpers/bl1048ReachFloors.js and
// BL-1062's helpers/reachFloors.js), never a restatement of them.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION = path.join(REPO_ROOT, 'extension');
const PROPERTY_TEST = 'test/bl1048DeliveredParcelIsNotNotStarted.property.test.js';

const FEATURE_NAME = "bl1048's reach floors are satisfiable by construction, not by a lucky seed";

// The seeds this feature's Examples table names. A row naming anything else is
// a drifted table, not a new case, and must fail loudly.
const KNOWN_SEEDS = new Set(['1', '7', '4242']);

// The floors as bl1048 declared them BEFORE BL-1281. Frozen here so scenario
// 02 compares the shipped list against a fixed reference rather than itself.
const PRE_CHANGE_FLOORS = {
  deliveredOnly: 8,
  openedOnly: 8,
  bothStatesSameRole: 4,
  crossRole: 6,
  deliveredNote: 4,
  deliveredBatched: 4,
  deliveredMasterResident: 2,
  noParcel: 4,
  closedButDelivered: 2,
};

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  scoped(/^the bl1048 delivered-parcel property test and its nine declared reach floors$/, (ctx) => {
    ctx.bl1281 = {};
    const floors = require(path.join(EXTENSION, 'test', 'helpers', 'bl1048ReachFloors.js'));
    ctx.bl1281.floors = floors.BL1048_REACH_FLOORS;
    ctx.bl1281.weakenedFloors = floors.weakenedFloors;
    assert.equal(Object.keys(ctx.bl1281.floors).length, 9, 'the ticket says nine floors');
  });

  // ── 01 ────────────────────────────────────────────────────────────────
  scoped(/^the property runs with seed (.+)$/, (ctx, seed) => {
    assert.ok(KNOWN_SEEDS.has(seed), `unknown seed example value "${seed}"`);
    ctx.bl1281.seed = seed;
  });

  scoped(/^the run completes$/, (ctx) => {
    ctx.bl1281.run = spawnSync(
      'npx',
      ['vitest', 'run', '--config', 'vitest.properties.config.mjs', PROPERTY_TEST],
      { cwd: EXTENSION, encoding: 'utf8', env: { ...process.env, PROPERTY_SEED: ctx.bl1281.seed } }
    );
  });

  scoped(/^the delivered-only and opened-only reach floors are both met$/, (ctx) => {
    const { status, stdout, stderr } = ctx.bl1281.run;
    const output = `${stdout}${stderr}`;
    // The shared assertion's refusal names the value, so a floor miss is
    // distinguishable from any other red rather than inferred from the exit.
    for (const value of ['deliveredOnly', 'openedOnly']) {
      assert.ok(
        !output.includes(`reach floor: bl1048 ${value}`),
        `seed ${ctx.bl1281.seed} missed the ${value} floor:\n${output}`
      );
    }
    assert.equal(status, 0, `seed ${ctx.bl1281.seed} exited ${status}:\n${output}`);
  });

  // ── 02 ────────────────────────────────────────────────────────────────
  scoped(/^the declared reach floors are read$/, (ctx) => {
    ctx.bl1281.offenders = ctx.bl1281.weakenedFloors(PRE_CHANGE_FLOORS, ctx.bl1281.floors);
  });

  scoped(/^all nine are still declared, none below the value it had before this change$/, (ctx) => {
    assert.deepEqual(ctx.bl1281.offenders, []);
    assert.deepEqual(Object.keys(ctx.bl1281.floors).sort(), Object.keys(PRE_CHANGE_FLOORS).sort());
  });

  // ── 03 ────────────────────────────────────────────────────────────────
  scoped(/^a coverage map in which the delivered-only value was drawn fewer times than its floor$/, (ctx) => {
    ctx.bl1281.coverage = { ...ctx.bl1281.floors, deliveredOnly: ctx.bl1281.floors.deliveredOnly - 1 };
  });

  scoped(/^the shared reach-floor assertion runs against it$/, (ctx) => {
    const { assertReachFloor } = require(path.join(EXTENSION, 'test', 'helpers', 'reachFloors.js'));
    try {
      assertReachFloor(ctx.bl1281.coverage, ['deliveredOnly'], ctx.bl1281.floors.deliveredOnly, 'bl1048');
      ctx.bl1281.threw = null;
    } catch (err) {
      ctx.bl1281.threw = err;
    }
  });

  scoped(/^it fails and names that value$/, (ctx) => {
    assert.ok(ctx.bl1281.threw, 'the shared assertion accepted a coverage map short of its floor');
    assert.ok(
      ctx.bl1281.threw.message.includes('deliveredOnly'),
      `the refusal does not name deliveredOnly: ${ctx.bl1281.threw.message}`
    );
  });
}

module.exports = { registerSteps };
