'use strict';

// BL-1327's three DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  A descent notch is proposed only after the seat has stayed
//                guard-clean for the configured number of consecutive review
//                periods at its current notch - a single clean period never
//                proposes a move.
//   invariant 2  A guard trip discards any partial clean-period progress and
//                returns ladder state to the last known-good notch
//                immediately, regardless of the ruling on auto-apply.
//   invariant 3  Effort notches for the current model are exhausted before a
//                cheaper model is ever proposed.
//
// All three drive the REAL swarmforge/scripts/descent_ladder_lib.bb. One bb
// process folds a whole generated review sequence, so a long sequence costs
// one subprocess rather than one per period.
//
// GENERATOR REACH (by construction, not by draw). Each starting rung on the
// effort ladder and each rung on the model ladder gets its own property pass,
// so the two corners that matter - "effort still available" and "effort
// exhausted, model next" - are both reached in every run, and the floors
// below hold because the passes ran rather than because a draw was lucky.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LADDER_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'descent_ladder_lib.bb');
const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];

function bb(expression) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${LADDER_LIB}")
(println (json/generate-string ${expression}))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

function decide({ effort, model, cleanPeriods, required, guardTripped }) {
  return bb(`(descent-ladder-lib/descent-decision
    {:seat "coder" :current-effort "${effort}" :current-model "${model}"
     :model-ladder ${JSON.stringify(MODELS)}
     :clean-periods ${cleanPeriods} :required-clean-periods ${required}
     :guard-tripped? ${guardTripped ? 'true' : 'false'}})`);
}

test('BL-1327/BL-654 invariant 1: a notch is proposed only on a completed clean streak, never on a partial one', () => {
  const reach = { short: 0, met: 0, tripped: 0 };

  // BL-1585: the three streak shapes (tripped, short, met) are reached BY
  // CONSTRUCTION - crossed with the effort loop, one fc.assert per cell with
  // its own floor-sized run budget - rather than hoped for by drawing
  // cleanPeriods/required/guardTripped independently, which left "short" and
  // "met" to whichever side of the comparison a random draw happened to
  // land on. The draw budget of 6 per effort (24 total) is unchanged; only
  // how it is spent changes.
  const STREAK_CELLS = {
    tripped: () => fc.tuple(fc.integer({ min: 0, max: 6 }), fc.integer({ min: 2, max: 5 }), fc.constant(true)),
    short: () =>
      fc.integer({ min: 2, max: 5 }).chain((required) =>
        fc.tuple(fc.integer({ min: 0, max: required - 1 }), fc.constant(required), fc.constant(false)),
      ),
    met: () =>
      fc.integer({ min: 2, max: 5 }).chain((required) =>
        fc.tuple(fc.integer({ min: required, max: 6 }), fc.constant(required), fc.constant(false)),
      ),
  };
  const STREAK_KEYS = Object.keys(STREAK_CELLS);
  const STREAK_CELL_RUNS = runsPerCell(6 * EFFORTS.length, EFFORTS.length * STREAK_KEYS.length);

  for (const effort of EFFORTS) {
    for (const streak of STREAK_KEYS) {
      fc.assert(
        fc.property(STREAK_CELLS[streak](), ([cleanPeriods, required, guardTripped]) => {
          const d = decide({ effort, model: MODELS[0], cleanPeriods, required, guardTripped });

          if (guardTripped) {
            reach.tripped += 1;
            assert.equal(d['propose?'], false, `a tripped seat proposed a move: ${JSON.stringify(d)}`);
            assert.match(d.reason, /guard/i, 'the refusal does not say the guard tripped');
            return true;
          }
          if (cleanPeriods < required) {
            reach.short += 1;
            assert.equal(d['propose?'], false, `a partial streak proposed a move: ${JSON.stringify(d)}`);
            // And it says how short, so a quiet review is distinguishable from
            // one that did not run.
            assert.ok(d.reason.includes(`${cleanPeriods}/${required}`), `the hold does not say how short: ${d.reason}`);
          } else {
            reach.met += 1;
            // A completed streak proposes UNLESS the seat is terminal, which
            // only the bottom rung of both ladders is.
            const terminal = effort === EFFORTS[0] && MODELS.indexOf(MODELS[0]) === MODELS.length - 1;
            assert.equal(d['propose?'], !terminal, JSON.stringify(d));
          }
          return true;
        }),
        { numRuns: STREAK_CELL_RUNS },
      );
    }
  }

  assertReachFloor(reach, STREAK_KEYS, STREAK_CELL_RUNS * EFFORTS.length, 'streak shape');
  assert.ok(reach.short > 0, 'never exercised a partial streak');
  assert.ok(reach.met > 0, 'never exercised a completed streak');
  assert.ok(reach.tripped > 0, 'never exercised a guard trip');
});

test('BL-1327/BL-654 invariant 2: a guard trip discards progress and returns to the last known-good notch', () => {
  const reach = { withKnownGood: 0, withoutKnownGood: 0 };
  const KNOWN_GOOD_CELLS = [true, false];
  const KNOWN_GOOD_CELL_RUNS = runsPerCell(8 * KNOWN_GOOD_CELLS.length, KNOWN_GOOD_CELLS.length);

  for (const hasKnownGood of KNOWN_GOOD_CELLS) {
    fc.assert(
      fc.property(
        fc.constantFrom(...EFFORTS),
        fc.constantFrom(...MODELS),
        fc.integer({ min: 0, max: 9 }),
        (effort, model, cleanPeriods) => {
          const known = hasKnownGood ? { effort: 'high', model: MODELS[0] } : null;
          const after = bb(`(descent-ladder-lib/record-guard-trip
            {:effort "${effort}" :model "${model}" :clean-periods ${cleanPeriods}
             :last-known-good ${known ? `{:effort "${known.effort}" :model "${known.model}"}` : 'nil'}})`);

          assert.equal(after['clean-periods'], 0, `progress survived a guard trip: ${JSON.stringify(after)}`);
          if (hasKnownGood) {
            reach.withKnownGood += 1;
            assert.equal(after.effort, known.effort);
            assert.equal(after.model, known.model);
          } else {
            reach.withoutKnownGood += 1;
            // Nowhere to climb back to: the seat stays put. Inventing a notch
            // would be the mutation this slice may not make.
            assert.equal(after.effort, effort);
            assert.equal(after.model, model);
          }
          return true;
        },
      ),
      { numRuns: KNOWN_GOOD_CELL_RUNS },
    );
  }

  assertReachFloor(reach, ['withKnownGood', 'withoutKnownGood'], KNOWN_GOOD_CELL_RUNS, 'known-good presence');
  assert.ok(reach.withKnownGood > 0, 'never exercised a trip with a known-good notch');
  assert.ok(reach.withoutKnownGood > 0, 'never exercised a trip with none recorded');
});

test('BL-1327/BL-654 invariant 3: effort is exhausted before any model change is proposed', () => {
  const reach = { effortRemaining: 0, effortExhausted: 0, terminal: 0 };
  const MODEL_EFFORT_CELLS = MODELS.length * EFFORTS.length;
  const MODEL_EFFORT_CELL_RUNS = runsPerCell(3 * MODEL_EFFORT_CELLS, MODEL_EFFORT_CELLS);

  for (const model of MODELS) {
    for (const effort of EFFORTS) {
      fc.assert(
        fc.property(fc.integer({ min: 3, max: 8 }), (cleanPeriods) => {
          const d = decide({ effort, model, cleanPeriods, required: 3, guardTripped: false });
          const effortRemaining = EFFORTS.indexOf(effort) > 0;
          const cheaperModel = MODELS.indexOf(model) < MODELS.length - 1;

          if (effortRemaining) {
            reach.effortRemaining += 1;
            assert.equal(d['propose?'], true);
            assert.equal(
              d.proposal.model,
              model,
              `a model change was proposed while effort notches remained: ${JSON.stringify(d.proposal)}`,
            );
            assert.equal(d.proposal.effort, EFFORTS[EFFORTS.indexOf(effort) - 1], 'the descent moved more than one notch');
          } else if (cheaperModel) {
            reach.effortExhausted += 1;
            assert.equal(d['propose?'], true);
            assert.equal(d.proposal.model, MODELS[MODELS.indexOf(model) + 1]);
            // Never at the bottom rung: a smaller model may need MORE thought.
            assert.equal(d.proposal.effort, 'high');
            assert.notEqual(d.proposal.effort, EFFORTS[0]);
          } else {
            reach.terminal += 1;
            assert.equal(d['propose?'], false, `the bottom of both ladders proposed a move: ${JSON.stringify(d)}`);
            assert.match(d.reason, /terminal/i);
          }
          return true;
        }),
        { numRuns: MODEL_EFFORT_CELL_RUNS },
      );
    }
  }

  assertReachFloor(reach, ['effortRemaining', 'effortExhausted', 'terminal'], MODEL_EFFORT_CELL_RUNS, 'ladder corner');
  assert.ok(reach.effortRemaining > 0, 'never exercised a seat with effort notches left');
  assert.ok(reach.effortExhausted > 0, 'never exercised a seat whose effort was exhausted - the model corner went untested');
  assert.ok(reach.terminal > 0, 'never exercised the terminal notch');
});
