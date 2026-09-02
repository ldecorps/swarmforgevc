'use strict';

// BL-1319 property test (coder-authored, THREE declared invariants).
//
//   Invariant 1: no stage name, bottleneck name or trend key emitted by the
//     dwell instrument ever contains a seat id - the fold holds for EVERY
//     stage, not only the one with two seats.
//   Invariant 2: the fold is lossless for a single-seat swarm - with only
//     bare seats the report is identical to the pre-fold output for the same
//     parcels.
//   Invariant 3: per-seat attribution is preserved in the underlying dwell
//     records, never discarded - folding happens where the report is
//     assembled, not where records are read.
//
// WHY PROPERTIES AND NOT MORE FIXTURES. The fixtures pin two seats on the
// coder. What they cannot pin is the arrangement nobody wrote down: seats on
// several stages at once, four seats on one stage, a seat whose stage is not
// a pipeline stage at all, or the parcel distribution that makes the folded
// median cross a single-seat stage's.
//
// REACH, asserted rather than hoped for (BL-654's generator-reach clause).
//
//   (a) A SEAT ID AT ALL. Drawing role names from the bare pipeline pool
//       produces a seat never. Seat ids are CONSTRUCTED as `<stage>@<suffix>`
//       - the exact transformation the instrument conflated - so every
//       generated roster is a leak candidate by construction. Asserted floor.
//
//   (b) THE MULTI-SEAT STAGE. A roster drawn as "one row per stage" would
//       essentially never put two rows on the SAME stage, and invariant 1
//       would pass over rosters that never exercise a fold. Extra seats are
//       DERIVED FROM a stage already in the roster, so the collision the fold
//       exists for is present by construction, not by luck.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const {
  computeStageDwellReportForRoles,
  computeSeatDwellDetail,
  readRoleStageDwellRecords,
  nameBottleneck,
} = require('../out/metrics/stageDwell');

const RUNS = 120;
const NOW = Date.parse('2026-07-09T12:00:00Z');
const PIPELINE = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

const stage = fc.constantFrom(...PIPELINE);
const suffix = fc.constantFrom('sonnet2', 'aider', 'opus5', 'seat-2');

function writeParcel(dir, name, dequeuedIso, completedIso) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, name),
    `task: BL-${name.replace(/\D/g, '') || '1'}-t\ndequeued_at: ${dequeuedIso}\ncompleted_at: ${completedIso}\n\nbody\n`
  );
}

// A roster: one bare seat per chosen stage, plus extra seats DERIVED from
// stages already present (reach (b)).
const roster = fc
  .record({
    stages: fc.uniqueArray(stage, { minLength: 1, maxLength: 5 }),
    extras: fc.array(fc.record({ which: fc.nat(), suffix }), { minLength: 1, maxLength: 4 }),
  })
  .map(({ stages, extras }) => {
    const rows = stages.map((s) => ({ role: s, stageOf: s }));
    for (const extra of extras) {
      const host = stages[extra.which % stages.length];
      const seat = `${host}@${extra.suffix}`;
      if (!rows.some((r) => r.role === seat)) {
        rows.push({ role: seat, stageOf: host });
      }
    }
    return rows;
  });

const parcelMinutes = fc.integer({ min: 1, max: 90 });

function materialise(rows, perSeatMinutes) {
  const root = mkTmpDir('sfvc-bl1319-prop-');
  const roles = rows.map((row, i) => {
    const wt = path.join(root, `wt-${i}`);
    const minutes = perSeatMinutes[i % perSeatMinutes.length];
    writeParcel(
      path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'completed'),
      `00_${i}.handoff`,
      '2026-07-09T08:00:00Z',
      new Date(Date.parse('2026-07-09T08:00:00Z') + minutes * 60000).toISOString()
    );
    return { role: row.role, worktreeName: `wt-${i}`, worktreePath: wt, agent: 'claude' };
  });
  return { root, roles };
}

// ──────────────────────────────────────────────────────────────────────────
// Invariant 1 — nothing the instrument emits carries a seat id.
// ──────────────────────────────────────────────────────────────────────────

test('invariant 1: no stage row, bottleneck name or serialised payload ever carries a seat id', () => {
  const reached = { seats: 0, multiSeatStages: 0 };

  fc.assert(
    fc.property(roster, fc.array(parcelMinutes, { minLength: 1, maxLength: 6 }), (rows, minutes) => {
      reached.seats += rows.filter((r) => r.role.includes('@')).length;
      const perStage = new Map();
      for (const r of rows) {
        perStage.set(r.stageOf, (perStage.get(r.stageOf) ?? 0) + 1);
      }
      if ([...perStage.values()].some((n) => n > 1)) {
        reached.multiSeatStages += 1;
      }

      const { roles } = materialise(rows, minutes);
      const result = computeStageDwellReportForRoles(roles, NOW, 24);

      for (const s of result.stages) {
        assert.ok(!s.role.includes('@'), `stage row leaked a seat id: ${s.role}`);
      }
      if (result.bottleneck) {
        assert.ok(!result.bottleneck.role.includes('@'));
      }
      assert.ok(!JSON.stringify(result).includes('@'), 'the optimizer payload must carry no seat id');

      // One row per DISTINCT stage - N seats never widen the report.
      const distinctStages = new Set(rows.map((r) => r.stageOf));
      assert.equal(result.stages.length, distinctStages.size);

      // And the fold MERGES rather than merely hiding. Without this the
      // property is vacuous against the pre-fix code: PIPELINE_ORDER holds
      // bare names only, so an unfolded seat was dropped by the filter and
      // "no row carries an @" passed for the wrong reason - the seat's work
      // was simply gone. Every configured seat wrote exactly one parcel, so
      // the folded rows must account for all of them.
      const totalParcels = result.stages.reduce((n, s) => n + s.parcelsProcessed, 0);
      assert.equal(totalParcels, rows.length, "a seat's parcels must be merged into its stage, never dropped");
    }),
    { numRuns: RUNS }
  );

  assert.ok(reached.seats >= RUNS, `generator must reach seat ids; saw ${reached.seats}`);
  assert.ok(reached.multiSeatStages >= RUNS / 2, `generator must reach multi-seat stages; saw ${reached.multiSeatStages}`);
});

// ──────────────────────────────────────────────────────────────────────────
// Invariant 2 — lossless for a single-seat swarm.
// ──────────────────────────────────────────────────────────────────────────

test('invariant 2: a roster of only bare seats reports exactly one row per stage, unchanged by the fold', () => {
  const reached = { bareRosters: 0 };

  fc.assert(
    fc.property(
      fc.uniqueArray(stage, { minLength: 1, maxLength: 5 }),
      fc.array(parcelMinutes, { minLength: 1, maxLength: 6 }),
      (stages, minutes) => {
        reached.bareRosters += 1;
        const rows = stages.map((s) => ({ role: s, stageOf: s }));
        const { roles } = materialise(rows, minutes);

        const result = computeStageDwellReportForRoles(roles, NOW, 24);
        // Every stage present, keyed exactly as roles.tsv spelled it, each
        // carrying its own single seat's parcel and nothing else.
        assert.deepEqual(result.stages.map((s) => s.role), stages);
        for (const s of result.stages) {
          assert.equal(s.parcelsProcessed, 1);
        }
        // And recomputation is stable - no ordering or accumulation drift.
        assert.deepEqual(computeStageDwellReportForRoles(roles, NOW, 24), result);
      }
    ),
    { numRuns: RUNS }
  );

  assert.ok(reached.bareRosters >= RUNS);
});

// ──────────────────────────────────────────────────────────────────────────
// Invariant 3 — per-seat attribution survives underneath the fold.
// ──────────────────────────────────────────────────────────────────────────

test('invariant 3: every dwell record still names the seat that worked the parcel, and the ops view reads them', () => {
  const reached = { seatRecords: 0 };

  fc.assert(
    fc.property(roster, fc.array(parcelMinutes, { minLength: 1, maxLength: 6 }), (rows, minutes) => {
      const { roles } = materialise(rows, minutes);

      for (const entry of roles) {
        const { records } = readRoleStageDwellRecords(entry, 0, NOW);
        for (const record of records) {
          assert.equal(record.role, entry.role, 'a record must name its own seat, never the folded stage');
          if (entry.role.includes('@')) {
            reached.seatRecords += 1;
          }
        }
      }

      // The ops surface exposes exactly one row per configured seat, keyed by
      // the seat, grouped under the folded stage.
      const seats = computeSeatDwellDetail(roles, NOW, 24);
      assert.deepEqual(seats.map((s) => s.seat), roles.map((r) => r.role));
      for (const s of seats) {
        assert.ok(!s.stage.includes('@'), 'the ops row still folds its STAGE key');
      }
    }),
    { numRuns: RUNS }
  );

  assert.ok(reached.seatRecords >= RUNS, `generator must reach seat-attributed records; saw ${reached.seatRecords}`);
});

// The ranking consequence, over arbitrary dwell shapes: a folded row is
// ranked as one stage, so no seat id can ever be returned as the answer.
test('invariant 1 (ranking): nameBottleneck never returns a seat id, for any row set', () => {
  const reached = { seatRows: 0 };
  const statsOf = (ms) => ({ medianMs: ms, p90Ms: ms, maxMs: ms, outliersMs: [] });

  fc.assert(
    fc.property(
      fc.array(fc.record({ stage, suffix: fc.option(suffix, { nil: null }), ms: fc.integer({ min: 1, max: 10 ** 7 }) }), {
        minLength: 1,
        maxLength: 8,
      }),
      (rows) => {
        const reportRows = rows.map((r) => {
          const role = r.suffix ? `${r.stage}@${r.suffix}` : r.stage;
          if (r.suffix) {
            reached.seatRows += 1;
          }
          return {
            role,
            parcelsProcessed: 1,
            queueWait: statsOf(0),
            processing: statsOf(r.ms),
            trend: null,
          };
        });
        const bottleneck = nameBottleneck(reportRows);
        if (bottleneck) {
          assert.ok(!bottleneck.role.includes('@'), `bottleneck named a seat: ${bottleneck.role}`);
          assert.ok(PIPELINE.includes(bottleneck.role));
        }
      }
    ),
    { numRuns: RUNS }
  );

  assert.ok(reached.seatRows >= RUNS / 2, `generator must reach seat-keyed rows; saw ${reached.seatRows}`);
});
