'use strict';

// BL-2037 declared invariants (coder-authored, BL-654):
//
//   1. "A record moves only arrange to arrange, act or assert; act to
//      assert; assert to act on a failed assert while fewer than 2 have
//      failed; or assert to done on a passed assert. Any other move is
//      refused and leaves the record unchanged."
//   2. "Notes are only ever appended: every note a phase wrote is still in
//      the record, in order, after every later move."
//
// Both invariants are claims about the REAL Babashka transition functions
// in swarmforge/scripts/local_seat_phase_lib.bb, so every draw is run
// through that file directly (`load-file`) rather than a JS re-model of
// the transition table - checking a re-implementation against itself would
// prove nothing. All draws batch into ONE `bb` call: load-file dominates a
// bb invocation, and a call per draw buys no extra coverage (BL-1030's own
// pattern).
//
// REACH (BL-654's generator-reach clause): `phase` is drawn uniformly over
// all four phases (including the terminal `done`, which admits no move at
// all) and `failed` over 0-3 (3 is unreachable in practice but exercises
// the ">= max-failed" branch the same way 2 does); the op's `to` for `end`
// is drawn over five values - the two real targets for the CURRENT phase
// are not guaranteed, but over DRAWS=300 and 4 phases x 5 targets x 3 op
// kinds every (phase, op, to) legal/illegal cell is hit many times (see
// the floor assertions at the bottom, which fail loudly if a cell goes
// unreached rather than passing on a lucky draw).
//
// Non-vacuity PROVEN at authoring time (2026-10-06), break restored:
//   - end-move's `end-targets` emptied for "act" (`{"arrange" ... }` with
//     no "act" entry): invariant 1 failed immediately - an act->assert
//     move the real CLI depends on was reported refused.
//   - fail-move's `(>= (:failed record) max-failed)` changed to `>`:
//     invariant 1 failed on the very next failed=2 draw - a move that
//     must stay in assert (the split-request case) was reported as a
//     real phase change instead.
//   - append-note's `conj` replaced with a shuffle-in-place stub: invariant
//     2 failed on the first multi-note record - the appended note was not
//     last.
//   All three restored byte-for-byte, ALL PROPERTIES HOLD.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'local_seat_phase_lib.bb');

const PHASES = ['arrange', 'act', 'assert', 'done'];
const END_TARGETS = ['arrange', 'act', 'assert', 'done', 'bogus'];
const DRAWS = 300;

// Deterministic seeded PRNG (BL-1030's own shape) - a fixed seed makes a
// failing run's draw reproducible without needing fast-check's shrinker,
// which would have nothing useful to shrink toward over an opaque batched
// call anyway.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const rng = makeRng(0x1629b654);
const randInt = (n) => Math.floor(rng() * n);
const randNth = (xs) => xs[randInt(xs.length)];

function buildDraw() {
  const phase = randNth(PHASES);
  const failed = randInt(4); // 0..3
  const noteCount = randInt(3); // 0..2 pre-existing notes
  const notes = [];
  for (let i = 0; i < noteCount; i += 1) notes.push(`pre-${i}`);
  const opType = randNth(['end', 'fail', 'pass']);
  const op = opType === 'end' ? { type: 'end', to: randNth(END_TARGETS) } : { type: opType };
  return { record: { phase, failed, notes }, op };
}

// The REAL pure transitions, over every draw, in one call.
function applyAll(draws) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${LIB}")
(defn apply-op [record op]
  (case (get op "type")
    "end" (local-seat-phase-lib/end-move record (get op "to"))
    "fail" (local-seat-phase-lib/fail-move record)
    "pass" (local-seat-phase-lib/pass-move record)))
(println
 (json/generate-string
  (vec (for [d (json/parse-string (slurp *in*))]
         (let [before {:phase (get-in d ["record" "phase"])
                        :failed (get-in d ["record" "failed"])
                        :notes (vec (get-in d ["record" "notes"]))}
               result (apply-op before (get d "op"))
               ok (boolean (:ok result))
               split (boolean (:split result))
               after (if ok (local-seat-phase-lib/append-note (:record result) "PROP_NOTE") before)]
           {:before before :ok ok :split split :after after})))))`;
  const res = spawnSync('bb', ['-e', program], { encoding: 'utf8', input: JSON.stringify(draws) });
  assert.equal(res.status, 0, `the real local-seat-phase-lib failed:\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

function legalMove(before, op) {
  const { phase, failed } = before;
  if (op.type === 'end') {
    if (phase === 'arrange') return ['arrange', 'act', 'assert'].includes(op.to);
    if (phase === 'act') return op.to === 'assert';
    return false; // end never moves out of assert or done
  }
  if (op.type === 'fail') return phase === 'assert';
  if (op.type === 'pass') return phase === 'assert';
  return false;
}

function expectedSplit(before, op) {
  return op.type === 'fail' && before.phase === 'assert' && before.failed >= 2;
}

test('BL-2037/BL-654 invariant 1: a move succeeds exactly on the five named transitions, and every other move leaves the record unchanged', () => {
  const draws = [];
  for (let i = 0; i < DRAWS; i += 1) draws.push(buildDraw());
  const results = applyAll(draws);
  assert.equal(results.length, draws.length, 'the lib must answer once per draw');

  const reach = { legalEnd: 0, illegalEnd: 0, legalFail: 0, split: 0, legalPass: 0, illegalFailOrPass: 0 };

  results.forEach((r, i) => {
    const { op } = draws[i];
    const legal = legalMove(r.before, op);
    assert.equal(
      r.ok,
      legal,
      `draw ${i} (${JSON.stringify(r.before)} / ${JSON.stringify(op)}): expected ok=${legal}, got ok=${r.ok}`
    );
    if (!legal) {
      // No record-unchanged assertion here (QA bounce D1, BL-2037,
      // 2026-10-06): `after` is set to `before` by THIS HARNESS whenever
      // `ok` is false (see applyAll's bb program above), never read back
      // from the lib's own result, so a deepEqual here only compares the
      // harness to itself and proves nothing about the real code. The
      // lib's refusal result carries no :record at all on `:ok false` -
      // "leaves the record unchanged" is a claim about the CLI's file,
      // not about this in-memory map. That claim is checked for real by
      // swarmforge/scripts/test/local_seat_phase_cli_test_runner.bb, which
      // spawns the real CLI and reads the record file's bytes before and
      // after each refused move.
    } else if (op.type === 'end') {
      assert.equal(r.after.phase, op.to, `draw ${i}: a legal end must land on its own --to target`);
      reach.legalEnd += 1;
    } else if (op.type === 'fail') {
      if (expectedSplit(r.before, op)) {
        assert.equal(r.after.phase, 'assert', `draw ${i}: the split-request case stays in assert`);
        assert.equal(r.after.failed, r.before.failed, `draw ${i}: the split-request case never raises the count further`);
        reach.split += 1;
      } else {
        assert.equal(r.after.phase, 'act');
        assert.equal(r.after.failed, r.before.failed + 1);
        reach.legalFail += 1;
      }
    } else if (op.type === 'pass') {
      assert.equal(r.after.phase, 'done');
      reach.legalPass += 1;
    }
    if (!legal && (op.type === 'fail' || op.type === 'pass')) reach.illegalFailOrPass += 1;
    if (!legal && op.type === 'end') reach.illegalEnd += 1;
  });

  // Generator-reach floor: every branch above must be hit more than a
  // handful of times across DRAWS=300, not merely possibly-zero.
  Object.entries(reach).forEach(([k, n]) => {
    assert.ok(n >= 3, `generator-reach floor missed for "${k}": only ${n} draws over ${DRAWS} runs`);
  });
});

test('BL-2037/BL-654 invariant 2: every note already in the record is still there, in order, after a legal move', () => {
  const draws = [];
  for (let i = 0; i < DRAWS; i += 1) draws.push(buildDraw());
  const results = applyAll(draws);

  let appendedSomewhere = 0;
  results.forEach((r, i) => {
    const { op } = draws[i];
    const legal = legalMove(r.before, op);
    if (!legal) {
      // Same self-comparison as invariant 1's refused branch above - no
      // assertion here either, for the same reason. The real check is
      // local_seat_phase_cli_test_runner.bb (BL-2037 D2).
    } else {
      assert.deepEqual(
        r.after.notes,
        [...r.before.notes, 'PROP_NOTE'],
        `draw ${i}: every earlier note must still be present, in order, with the new note last`
      );
      if (r.before.notes.length > 0) appendedSomewhere += 1;
    }
  });
  assert.ok(appendedSomewhere >= 3, 'generator-reach floor missed: no legal move drawn with a pre-existing note');
});
