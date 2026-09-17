'use strict';

// BL-1604 declared invariants (property authorship rests with the coder,
// first pass - BL-654):
//
//   1. "A land never reduces another open ticket's ownership: for every
//      row of either registry file on origin/main whose owner is open and
//      not the landing ticket, the same row is on origin/main after the
//      land." - at the pure-function level (land_step_lib.bb's
//      registry-rows-to-restore), this reads: for every origin row whose
//      owner is open and not the landing ticket, that row is EITHER
//      already in replay-rows OR present in the function's own :restore
//      output - the merged (replay ∪ restore) set never drops it.
//   2. "The landing ticket's own rows are never protected from itself: a
//      row it owns and removed at its tip is absent after the land,
//      exactly as before this change." - a row owned by the landing id
//      that is absent from replay-rows is NEVER added by :restore.
//
// Drives the REAL Babashka registry-rows-to-restore (never a JS port of
// the matching logic) via bl1604_registry_restore_property_runner.bb,
// batched in ONE call across all draws (the BL-1003 convention: a fresh bb
// process per draw is dominated by load-file'ing land_step_lib.bb's own
// dependency chain and made a naive per-draw design impractically slow).
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl1604_registry_restore_property_runner.bb');

const TRIALS = 80;

const rng = (() => {
  // Small deterministic-shaped LCG, seeded from the wall clock at
  // collection time - varies run to run (this project's own bl970-style
  // property runner convention) without pulling in a dependency; the
  // reach floors below are checked on every run regardless of seed.
  let state = Date.now() % 2147483647;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
})();
function randInt(n) {
  return Math.floor(rng() * n);
}
function pick(arr) {
  return arr[randInt(arr.length)];
}

const LANDING = 'BL-1';
const OPEN_OTHER = ['BL-2', 'BL-3'];
const CLOSED_OR_ABSENT = ['BL-4', 'BL-5'];
// The landing ticket is itself ordinarily still active on origin/main too
// (backlog/active there, mid-flight) - it MUST be included in open-ids so
// the generator actually exercises the "not the landing ticket" half of
// invariant 2 on its own, never let a landing-owned row's exclusion ride
// for free on it merely being absent from open-ids.
const OPEN_IDS = [LANDING, ...OPEN_OTHER];

// One trial: a random set of origin rows, each owned by the landing
// ticket, an open OTHER ticket, or a closed/absent one - and a random
// independent subset of them SURVIVING into replay-rows (simulating what
// the tip's own version of the file still carries), plus a chance of an
// extra replay-only row the origin never had (an ordinary own-path
// addition, never itself a restoration candidate).
function makeTrial() {
  const rowCount = 2 + randInt(5);
  const owners = [LANDING, ...OPEN_OTHER, ...CLOSED_OR_ABSENT];
  const originRows = [];
  for (let i = 0; i < rowCount; i += 1) {
    const owner = pick(owners);
    originRows.push({ file: `file-${i}.txt`, owner, raw: `raw-${i}-${owner}` });
  }
  // Independently keep or drop each origin row in the replay - this is
  // the generator's reach: it must produce, across TRIALS runs, cases
  // where an open-other row is dropped (a restore is owed) AND cases
  // where a landing/closed row is dropped (must stay dropped).
  const replayRows = originRows.filter(() => randInt(2) === 0);
  if (randInt(3) === 0) {
    replayRows.push({ file: `extra-${randInt(1000)}.txt`, owner: pick(owners), raw: 'extra-raw' });
  }
  return { 'origin-rows': originRows, 'replay-rows': replayRows, 'landing-id': LANDING, 'open-ids': OPEN_IDS };
}

function runBatch(trials) {
  const out = execFileSync('bb', [RUNNER], { input: JSON.stringify(trials), encoding: 'utf8' });
  return JSON.parse(out);
}

test('BL-1604/BL-654 invariants 1 & 2: an open OTHER owner\'s row always survives, the landing ticket\'s own removed row never comes back', () => {
    const trials = Array.from({ length: TRIALS }, makeTrial);
    const results = runBatch(trials);
    assert.equal(results.length, TRIALS);

    // Reachability floor (BL-654's own 'generator reach' requirement): the
    // generator must actually produce, across this run, at least one case
    // of each shape the invariants quantify over - never a hoped-for
    // reach. Counted over the ACTUAL draws, not assumed from the
    // probabilities above.
    let openOtherRestoreOwed = 0;
    let landingDrainCase = 0;
    let closedDrainCase = 0;

    trials.forEach((trial, i) => {
      const restored = results[i];
      const replayFiles = new Set(trial['replay-rows'].map((r) => r.file));
      const restoredFiles = new Set(restored.map((r) => r.file));
      const finalFiles = new Set([...replayFiles, ...restoredFiles]);

      trial['origin-rows'].forEach((row) => {
        const isOpenOther = OPEN_IDS.includes(row.owner) && row.owner !== LANDING;
        const isLanding = row.owner === LANDING;
        const wasDropped = !replayFiles.has(row.file);

        if (isOpenOther && wasDropped) {
          openOtherRestoreOwed += 1;
          // Invariant 1: an open OTHER owner's row that the tip dropped
          // must be back in the merged (replay ∪ restore) set, byte-
          // identical (same :raw).
          assert.ok(
            finalFiles.has(row.file),
            `expected ${row.file} (owned by ${row.owner}) to survive via restoration, trial ${i}`,
          );
          const restoredRow = restored.find((r) => r.file === row.file);
          assert.ok(restoredRow, `expected a restore entry for ${row.file}, trial ${i}`);
          assert.equal(restoredRow.raw, row.raw, `expected byte-identical restoration for ${row.file}, trial ${i}`);
        }

        if (isLanding && wasDropped) {
          landingDrainCase += 1;
          // Invariant 2: the landing ticket's own removed row is NEVER
          // restored - it stays absent from the merged set.
          assert.ok(
            !restoredFiles.has(row.file),
            `expected the landing ticket's own removed row ${row.file} to stay gone, trial ${i}`,
          );
        }

        if (!isOpenOther && !isLanding && wasDropped) {
          closedDrainCase += 1;
          assert.ok(
            !restoredFiles.has(row.file),
            `expected a closed/absent owner's removed row ${row.file} to stay gone, trial ${i}`,
          );
        }
      });
    });

    assert.ok(openOtherRestoreOwed > 0, 'generator never produced an open-other row missing from the replay');
    assert.ok(landingDrainCase > 0, 'generator never produced the landing ticket\'s own row missing from the replay');
    assert.ok(closedDrainCase > 0, 'generator never produced a closed/absent owner\'s row missing from the replay');
});

// Non-vacuity (run 2026-09-17, recorded in the parcel commit): break 1 -
// dropping registry-rows-to-restore's `(not= (:owner row) landing-id)`
// clause - passed FALSE GREEN until OPEN_IDS above was made to include the
// landing ticket itself (realistic: a landing ticket is ordinarily still
// active on origin/main too), because until then `contains? open-ids` alone
// already excluded it for an unrelated reason and the break rode free. Once
// OPEN_IDS included LANDING, the same break went RED ("expected the landing
// ticket's own removed row ... to stay gone"). Restored, PROPERTY HOLDS.
