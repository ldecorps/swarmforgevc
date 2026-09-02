'use strict';

// BL-1040 property test (coder-authored, THREE declared invariants).
//
//   Invariant 1: seat identity never escapes the mailbox layer on the
//     OBSERVATION path either - no stage map, board column, or held-role
//     reading ever carries a seat id. This is BL-983's own invariant 3,
//     closed over READING as well as over forwarding.
//   Invariant 2: a multi-seat stage occupies exactly one board column and
//     exactly one position in the reconciler's stage precedence order:
//     N seats never widen either.
//   Invariant 3: a ticket actively held by any seat of a stage is never
//     rendered as not-started.
//
// WHY PROPERTIES AND NOT MORE FIXTURES. All three quantify over "every seat
// arrangement roles.tsv could describe". The fixtures pin two seats on the
// coder; what a fixture cannot pin is the arrangement nobody wrote down -
// four seats on one stage, seats on two different stages at once, a seat key
// competing with a genuinely more downstream bare stage for the same ticket.
//
// REACH, asserted rather than hoped for (BL-654's generator-reach clause).
// Two states a naive generator would essentially never produce:
//
//   (a) A SEAT KEY AT ALL. Drawing role keys uniformly from a pool of bare
//       stage names produces a seat id never. Seat keys are CONSTRUCTED by
//       the transformation the code under test used to conflate - a stage
//       name with `@<suffix>` appended - so every generated arrangement is a
//       leak candidate by construction, not by luck.
//
//   (b) THE SEAT/STAGE COLLISION ON ONE TICKET. This is the collision shape
//       BL-654 warns about: a seat-held id and a bare-stage-held id drawn
//       independently would collide essentially never, and invariant 1 would
//       pass while a fold that let a seat outrank a downstream stage sat
//       live. So the second holder's ticket is DERIVED FROM the first's -
//       the same id, held under both a seat and a bare stage - and every
//       generated pair is a precedence candidate by construction.

const assert = require('node:assert/strict');
const fc = require('fast-check');

const {
  computePipelineBoard,
  PIPELINE_BOARD_COLUMN_ORDER,
  PIPELINE_BOARD_NOT_STARTED_COLUMN,
} = require('../out/concierge/pipelineBoard');
const { normaliseTicketStageEntry, invertTicketStageToRoleHeldTickets } = require('../out/swarm/swarmState');
const { ALL_SWARM_ROLES } = require('../out/concierge/roleTopicMapStore');

const RUNS = 300;

// The coordinator is deliberately excluded: it is in ALL_SWARM_ROLES, but
// buildGridRows remaps a coordinator-held row onto the QA column (the grid
// carries no coordinator column at all), so it is not a stage a row can
// paint on. Quantifying over it would test that documented remap, not this
// ticket's fold.
const BOARD_STAGES = ALL_SWARM_ROLES.filter((r) => r !== 'coordinator');
const stage = fc.constantFrom(...BOARD_STAGES);
const ticketId = fc.integer({ min: 900, max: 999 }).map((n) => `BL-${n}`);
const seatSuffix = fc.constantFrom('sonnet2', 'haiku', 'opus5', 'a', 'seat-2');

// Reach (a): a seat key is CONSTRUCTED from a stage, never hoped for.
const seatOf = (stageName, suffix) => `${stageName}@${suffix}`;

// One stage, N seats: the bare stage plus 1..4 constructed seat keys.
const seatFamily = fc
  .record({ stageName: stage, suffixes: fc.uniqueArray(seatSuffix, { minLength: 1, maxLength: 4 }) })
  .map(({ stageName, suffixes }) => ({
    stageName,
    keys: [stageName, ...suffixes.map((s) => seatOf(stageName, s))],
  }));

// ──────────────────────────────────────────────────────────────────────────
// Invariant 1 — seat identity never escapes on the read path.
// ──────────────────────────────────────────────────────────────────────────

test('invariant 1: no seat id survives the reader chokepoint, the held-role inversion, or a board column', () => {
  const reached = { seatKeys: 0 };

  fc.assert(
    fc.property(seatFamily, fc.array(ticketId, { minLength: 1, maxLength: 4 }), (family, ids) => {
      const seatKeys = family.keys.filter((k) => k.includes('@'));
      reached.seatKeys += seatKeys.length;

      // The reader chokepoint: both accepted map shapes.
      for (const key of family.keys) {
        assert.ok(!normaliseTicketStageEntry(key).stage.includes('@'));
        assert.ok(!normaliseTicketStageEntry({ stage: key, status: 'holding' }).stage.includes('@'));
      }

      // The held-role inversion, over a stage map keyed by every seat.
      const stageMap = {};
      ids.forEach((id, i) => {
        stageMap[id] = family.keys[i % family.keys.length];
      });
      const byRole = invertTicketStageToRoleHeldTickets(stageMap);
      for (const key of Object.keys(byRole)) {
        assert.ok(!key.includes('@'), `held-role key leaked a seat id: ${key}`);
      }

      // The rendered board.
      const roleHeld = {};
      family.keys.forEach((key, i) => {
        roleHeld[key] = [ids[i % ids.length]];
      });
      const { rows } = computePipelineBoard(roleHeld, [], {}, { activeIds: [...new Set(ids)] });
      for (const row of rows) {
        assert.ok(!row.column.includes('@'), `board column leaked a seat id: ${row.column}`);
      }
    }),
    { numRuns: RUNS }
  );

  assert.ok(reached.seatKeys >= RUNS, `generator must reach seat keys; saw ${reached.seatKeys}`);
});

// ──────────────────────────────────────────────────────────────────────────
// Invariant 2 — N seats never widen the board or the precedence order.
// ──────────────────────────────────────────────────────────────────────────

test('invariant 2: a multi-seat stage takes exactly one board column, however many seats it has', () => {
  const reached = { multiSeat: 0 };

  fc.assert(
    fc.property(seatFamily, fc.array(ticketId, { minLength: 1, maxLength: 4 }), (family, ids) => {
      if (family.keys.length > 2) {
        reached.multiSeat += 1;
      }
      const unique = [...new Set(ids)];
      // Every active id must be held by SOME key of the family - an id left
      // unheld would paint not-started for that reason alone and prove
      // nothing about widening.
      const roleHeld = {};
      unique.forEach((id, i) => {
        const key = family.keys[i % family.keys.length];
        (roleHeld[key] ??= []).push(id);
      });
      const { rows } = computePipelineBoard(roleHeld, [], {}, { activeIds: unique });

      // Every row for this family sits on the ONE stage column.
      const columns = new Set(rows.map((r) => r.column));
      assert.equal(columns.size, 1);
      assert.equal([...columns][0], family.stageName);

      // And the column order itself is never widened by a seat.
      assert.equal(PIPELINE_BOARD_COLUMN_ORDER.filter((c) => c.includes('@')).length, 0);
    }),
    { numRuns: RUNS }
  );

  assert.ok(reached.multiSeat > 0, 'generator must reach stages with more than one seat');
});

// ──────────────────────────────────────────────────────────────────────────
// Invariant 3 — a seat-held ticket is never painted as not-started.
// ──────────────────────────────────────────────────────────────────────────

test('invariant 3: a ticket held by any seat of a stage is never rendered as not-started', () => {
  const reached = { seatOnlyHolds: 0 };

  fc.assert(
    fc.property(seatFamily, ticketId, (family, id) => {
      // Held ONLY by a seat - the shape that used to fall through to the
      // not-started sentinel while the seat was actively working it.
      const seatKeys = family.keys.filter((k) => k.includes('@'));
      reached.seatOnlyHolds += 1;
      const roleHeld = {};
      for (const key of seatKeys) {
        roleHeld[key] = [id];
      }
      const { rows } = computePipelineBoard(roleHeld, [], {}, { activeIds: [id] });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].column, family.stageName);
      assert.notEqual(rows[0].column, PIPELINE_BOARD_NOT_STARTED_COLUMN);
    }),
    { numRuns: RUNS }
  );

  assert.ok(reached.seatOnlyHolds >= RUNS, 'generator must reach seat-only holds');
});

// Reach (b): the seat/stage collision on ONE ticket - a folded seat must not
// outrank a genuinely more downstream bare stage for the same id.
test('invariant 1+3 together: folding a seat never lets it outrank a more downstream stage', () => {
  const reached = { collisions: 0 };

  const downstreamPair = fc
    .integer({ min: 0, max: BOARD_STAGES.length - 2 })
    .chain((i) =>
      fc.record({
        upstream: fc.constant(BOARD_STAGES[i]),
        downstream: fc.constantFrom(...BOARD_STAGES.slice(i + 1)),
      })
    );

  fc.assert(
    fc.property(downstreamPair, ticketId, seatSuffix, ({ upstream, downstream }, id, suffix) => {
      reached.collisions += 1;
      // The SAME id under an upstream seat and a downstream bare stage.
      const { rows } = computePipelineBoard(
        { [seatOf(upstream, suffix)]: [id], [downstream]: [id] },
        [],
        {},
        { activeIds: [id] }
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].column, downstream);
    }),
    { numRuns: RUNS }
  );

  assert.ok(reached.collisions >= RUNS, 'every generated pair must be a precedence candidate');
});
