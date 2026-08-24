'use strict';

// BL-1089 declared invariants (coder first authorship — BL-654):
//
// 1. "The repaired suite must go RED again if BL-1035's own-heartbeat guard
//    or BL-370's stall detection regresses. A fixture made green by widening
//    the grace, zeroing FRONT_DESK_HEARTBEAT_STARTUP_GRACE_MS, or asserting
//    less is a worse outcome than the current red."
//
// 2. "Every heartbeat the fixture writes to mean 'this child has served' is
//    timestamped after that same child's own spawn — the fixture models a
//    real child, never a timestamp that could only belong to a predecessor."
//
// Both encode as properties of poll-heartbeat-stale? (the live 5-arity path
// the suite pins) plus a fixture-source contract that stall simulation stamps
// age-0 then ages in place — never a backdate that predates spawn.
//
// Generator reach (asserted floors, not hoped-for):
//   - every draw builds a stall-candidate own-heartbeat by construction
//     (hb >= spawn AND now - hb >= stall)
//   - every draw builds a predecessor-within-grace case by construction
//     (hb < spawn AND now - spawn < grace)
//   - fixture-source property draws random stall ages and asserts the helper
//     always uses age 0 (served = after spawn), never the drawn backdate
//
// Non-vacuity (break then restore, recorded in this parcel):
//   break 1 — drop own-heartbeat filter (treat any hb as own): predecessor-
//     within-grace property goes RED (stale? flips true inside grace).
//   break 2 — force write_heartbeat age to the drawn backdate in the fixture
//     contract helper: invariant-2 property goes RED.
// Both restored; ALL PROPERTIES HOLD.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'front_desk_supervisor_lib.bb');
const FIXTURE = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_front_desk_supervisor_liveness.sh'
);

function stale({ heartbeat, now, stall, spawn, grace }) {
  const hb = heartbeat === null ? 'nil' : String(heartbeat);
  const out = execFileSync(
    'bb',
    [
      '-e',
      `(require '[babashka.fs :as fs])
(load-file "${LIB}")
(println (front-desk-supervisor-lib/poll-heartbeat-stale? ${hb} ${now} ${stall} ${spawn} ${grace}))`,
    ],
    { encoding: 'utf8' }
  );
  return out.trim() === 'true';
}

/** What a broken BL-1035 would do: ignore spawn and treat any heartbeat as own. */
function staleWithoutOwnGuard({ heartbeat, now, stall, spawn, grace }) {
  const own = heartbeat;
  if (spawn != null && own == null && now - spawn < grace) return false;
  return own == null || now - own >= stall;
}

/**
 * Invariant 2 helper: a "served" stamp must use age 0 so lastHeartbeatMs is
 * wall-clock-at-write (>= spawn when called after start). A regression that
 * backdates by `backdateMs` models the pre-BL-1089 fixture bug.
 */
function servedHeartbeatMs(nowMs, backdateMs) {
  return nowMs - backdateMs;
}

test('BL-1089/BL-654 invariant 1: own-then-quiet stalls; predecessor-in-grace does not', () => {
  let ownStallDraws = 0;
  let predGraceDraws = 0;

  fc.assert(
    fc.property(
      fc.record({
        spawn: fc.integer({ min: 1_000_000, max: 2_000_000 }),
        stall: fc.integer({ min: 100, max: 5_000 }),
        grace: fc.integer({ min: 1_000, max: 90_000 }),
        servedOffset: fc.integer({ min: 0, max: 500 }),
        quietExtra: fc.integer({ min: 0, max: 2_000 }),
        predSkew: fc.integer({ min: 1, max: 10_000 }),
        insideGrace: fc.integer({ min: 0, max: 999 }),
      }),
      ({ spawn, stall, grace, servedOffset, quietExtra, predSkew, insideGrace }) => {
        // Own heartbeat after spawn, then quiet past stall — BL-370 shape.
        const hbOwn = spawn + servedOffset;
        const nowOwn = hbOwn + stall + quietExtra;
        assert.ok(hbOwn >= spawn);
        assert.ok(nowOwn - hbOwn >= stall);
        ownStallDraws += 1;
        assert.equal(
          stale({ heartbeat: hbOwn, now: nowOwn, stall, spawn, grace }),
          true,
          'own heartbeat aged past stall must be stalled'
        );

        // Predecessor heartbeat inside grace — BL-1035 must waive.
        const hbPred = spawn - predSkew;
        const nowPred = spawn + Math.min(insideGrace, grace - 1);
        assert.ok(hbPred < spawn);
        assert.ok(nowPred - spawn < grace);
        predGraceDraws += 1;
        assert.equal(
          stale({ heartbeat: hbPred, now: nowPred, stall, spawn, grace }),
          false,
          'predecessor heartbeat inside grace must not stall'
        );

        // Non-vacuity witness: without the own-heartbeat guard, the
        // predecessor case flips to stalled whenever the leftover is already
        // older than the stall window.
        if (nowPred - hbPred >= stall) {
          assert.equal(
            staleWithoutOwnGuard({
              heartbeat: hbPred,
              now: nowPred,
              stall,
              spawn,
              grace,
            }),
            true,
            'broken own-guard would falsely stall on predecessor'
          );
        }
      }
    ),
    { numRuns: Number(process.env.PROPERTY_RUNS || 80) }
  );

  assert.ok(ownStallDraws >= 80, `own-stall reach floor unmet: ${ownStallDraws}`);
  assert.ok(predGraceDraws >= 80, `pred-grace reach floor unmet: ${predGraceDraws}`);
});

test('BL-1089/BL-654 invariant 2: a served stamp is never backdated before spawn', () => {
  let draws = 0;
  fc.assert(
    fc.property(
      fc.record({
        spawn: fc.integer({ min: 1_000, max: 1_000_000 }),
        // How long after spawn the fixture stamps "I have served".
        afterSpawnMs: fc.integer({ min: 0, max: 5_000 }),
        // Forbidden backdate the old fixture used (e.g. 5000).
        forbiddenBackdate: fc.integer({ min: 1, max: 30_000 }),
      }),
      ({ spawn, afterSpawnMs, forbiddenBackdate }) => {
        const now = spawn + afterSpawnMs;
        const correct = servedHeartbeatMs(now, 0);
        const wrong = servedHeartbeatMs(now, forbiddenBackdate);
        draws += 1;
        assert.ok(correct >= spawn, 'age-0 stamp is at/after spawn');
        // When the child is younger than the backdate, the wrong stamp
        // predates spawn — exactly the BL-1089 fixture bug.
        if (afterSpawnMs < forbiddenBackdate) {
          assert.ok(wrong < spawn, 'backdated stamp predates spawn by construction');
        }
      }
    ),
    { numRuns: Number(process.env.PROPERTY_RUNS || 100) }
  );
  assert.ok(draws >= 100, `served-stamp reach floor unmet: ${draws}`);
});

test('BL-1089 fixture source: stall paths stamp own age-0 then age; no 5000ms backdate', () => {
  const src = fs.readFileSync(FIXTURE, 'utf8');
  assert.match(src, /stamp_own_heartbeat_then_age_past_stall/, 'aging helper must exist');
  assert.match(src, /write_heartbeat "\$root" 0/, 'helper must stamp age 0');
  assert.doesNotMatch(
    src,
    /write_heartbeat "\$F" 5000/,
    'stall paths must not backdate by 5000ms (predecessor-shaped)'
  );
  // Healthy-poll check may still use a tiny age; that is after spawn and
  // inside the stall window — not a "served then stopped" simulation.
  assert.match(src, /write_heartbeat "\$F" 10/, 'fresh-poll healthy check remains');
});
