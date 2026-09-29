const assert = require('node:assert/strict');
const fc = require('fast-check');
const { syncPipelineBoard } = require('../out/concierge/pipelineBoardSync');
const {
  PIPELINE_BOARD_SUBJECT_ID,
  decideEnsurePipelineBoardTopicAction,
} = require('../out/tools/telegramTopicDecisions');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

// BL-586, declared invariants (coder-authored per the Invariants section of
// coder.prompt / BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs); excluded from the normal unit/coverage/
// mutation run.
//
//   1. The board never posts into a topic the topic map attributes to
//      another purpose - validated before every post, not only at mint time.
//   2. Re-establishing board identity is reuse-or-create: no state reset
//      mints a new topic while the previous board topic is still durably
//      known.
//
// GENERATOR REACH is the part that decides whether these properties mean
// anything. Both incidents were COLLISIONS between a stored id and a map
// binding, and a collision drawn from two independent integer generators is
// astronomically rare - the property would pass hundreds of runs against the
// live defect. So the stored id here is DERIVED FROM the generated map's own
// keys, making every pair a collision candidate by construction.
//
// BL-1790: at UNIFORM odds over the original (map, storedId) draw, the
// already-board-bound arm of invariant 1 was reached only about 1 draw in 9
// (a board binding present about half the time x a 4-in-5 own-key draw x a
// 1-in-2-to-1-in-7 chance that key is the board's), so its floor of 5 missed
// about 1 run in 65 - the 2026-09-27 red QA held BL-1707 on (evidence
// fd1ab96de0: "generator reached only 3 already-board-bound states"). Every
// arm of both invariants below is now reached BY CONSTRUCTION, one cell per
// arm (runsPerCell/assertReachFloor, helpers/reachFloors - the BL-1760/
// BL-1763/BL-1786 recipe), instead of hoping a uniform draw lands on the
// rare side.

const SUBJECTS = ['SUP-5', 'SUP-7', 'APPROVALS', 'OPERATOR', 'BACKLOG', 'CONTROL', 'RECERT', 'BABYSITTER'];

const topicIdArb = fc.integer({ min: 1, max: 40000 });

// A handful of other-subject bindings - the shared building block every cell
// arbitrary below draws from, so every cell still exercises the SAME shaped
// map the original topicMapArb did (never empty, ids unique).
const entriesArb = fc.uniqueArray(fc.tuple(topicIdArb, fc.constantFrom(...SUBJECTS)), {
  minLength: 1,
  maxLength: 6,
  selector: (e) => e[0],
});

function buildMap(entries, boardTopicId) {
  const map = {};
  for (const [id, subject] of entries) {
    map[String(id)] = subject;
  }
  if (boardTopicId !== undefined) {
    map[String(boardTopicId)] = PIPELINE_BOARD_SUBJECT_ID;
  }
  return map;
}

const ENSURED_TOPIC_ID = 6795;

function boardData(parked = []) {
  return { rows: [], parked, collapsedEpics: [], rootIntake: [], recentlyClosed: [], links: [] };
}

// The ensure stub BINDS the map, exactly as the live ensureBoardTopicAdapter
// does before returning. Without that the generated map could attribute
// ENSURED_TOPIC_ID to another subject and the property would fail on its own
// fixture rather than on the code under test.
function adaptersOver(topicMap, posted) {
  return {
    readTopicMap: async () => topicMap,
    ensureBoardTopic: async () => {
      topicMap[String(ENSURED_TOPIC_ID)] = PIPELINE_BOARD_SUBJECT_ID;
      return { topicId: ENSURED_TOPIC_ID };
    },
    postMessage: async (topicId) => {
      posted.push(topicId);
      return { messageId: 1 };
    },
    deleteMessage: async () => true,
    emitCrossedTopicAlert: async () => true,
  };
}

// BL-1790: (map, storedId) reaches already-board-bound, crossed and unmapped
// BY CONSTRUCTION - each cell forces its own state instead of leaving it to
// the shared arbitrary's odds.
const boardBoundCellArb = fc
  .tuple(entriesArb, topicIdArb)
  .map(([entries, boardTopicId]) => ({ map: buildMap(entries, boardTopicId), storedId: boardTopicId }));

const crossedCellArb = entriesArb.chain((entries) =>
  fc
    .constantFrom(...entries.map(([id]) => id))
    .map((storedId) => ({ map: buildMap(entries, undefined), storedId }))
);

const unmappedCellArb = fc
  .tuple(entriesArb, fc.option(topicIdArb, { nil: undefined, freq: 2 }))
  .chain(([entries, boardTopicId]) => {
    const map = buildMap(entries, boardTopicId);
    return topicIdArb
      .filter((id) => map[String(id)] === undefined)
      .map((storedId) => ({ map, storedId }));
  });

test('property (BL-586 invariant 1): for any topic map and any stored id, the board only ever posts into a topic the map does not attribute to another subject', async () => {
  const reach = { crossed: 0, boardBound: 0, unmapped: 0 };
  const CELL_ARBS = [boardBoundCellArb, crossedCellArb, unmappedCellArb];
  const PER_CELL_RUNS = runsPerCell(150, CELL_ARBS.length);

  for (const cellArb of CELL_ARBS) {
    await fc.assert(
      fc.asyncProperty(cellArb, async ({ map, storedId }) => {
        const subject = map[String(storedId)];
        if (subject === undefined) {
          reach.unmapped += 1;
        } else if (subject === PIPELINE_BOARD_SUBJECT_ID) {
          reach.boardBound += 1;
        } else {
          reach.crossed += 1;
        }

        const posted = [];
        await syncPipelineBoard(boardData(), { topicId: storedId }, adaptersOver(map, posted), 1000);

        for (const topicId of posted) {
          const postedSubject = map[String(topicId)];
          assert.ok(
            postedSubject === undefined || postedSubject === PIPELINE_BOARD_SUBJECT_ID,
            `posted into ${topicId}, which the map attributes to ${postedSubject} (stored id was ${storedId})`
          );
        }
      }),
      { numRuns: PER_CELL_RUNS }
    );
  }

  // Reachability floor: a property that never generated a crossing would be
  // vacuously green against the very defect it exists to catch.
  assertReachFloor(reach, ['crossed'], 50, 'BL-586 invariant 1 state');
  assertReachFloor(reach, ['boardBound', 'unmapped'], 5, 'BL-586 invariant 1 state');
});

// The standing record's OWN id, derived from the map for the same
// collision-by-construction reason as the invariant 1 cells above. A
// standing record can itself be crossed - the 2026-07-23 repair cleared
// tick state while a running bridge still held the crossed id, and any
// writer could persist one - so "still durably known" has to be told apart
// from "still durably REMEMBERED, but now someone else's".
//
// BL-1790: (map, standingId) reaches map-bound, usable-standing,
// crossed-standing and nothing-durable BY CONSTRUCTION.
const mapBindingCellArb = fc
  .tuple(entriesArb, topicIdArb, fc.option(topicIdArb, { nil: undefined, freq: 2 }))
  .map(([entries, boardTopicId, standingId]) => ({ map: buildMap(entries, boardTopicId), standingId }));

const standingUsableCellArb = entriesArb.chain((entries) => {
  const map = buildMap(entries, undefined);
  return topicIdArb
    .filter((id) => map[String(id)] === undefined)
    .map((standingId) => ({ map, standingId }));
});

const standingCrossedCellArb = entriesArb.chain((entries) => {
  const map = buildMap(entries, undefined);
  return fc.constantFrom(...entries.map(([id]) => id)).map((standingId) => ({ map, standingId }));
});

const nothingDurableCellArb = entriesArb.map((entries) => ({
  map: buildMap(entries, undefined),
  standingId: undefined,
}));

// numRuns is pinned rather than left at the default so the reachability
// floors below are a real assertion about the generator's shape and not a
// coin flip on the run count.
const INVARIANT_2_RUNS = 1000;

test('property (BL-586 invariant 2): whenever the board topic is still durably known AND still the board\'s, re-establishing identity reuses it and never creates', () => {
  const reach = { mapBinding: 0, standingUsable: 0, standingCrossed: 0, nothingDurable: 0 };
  const CELL_ARBS = [mapBindingCellArb, standingUsableCellArb, standingCrossedCellArb, nothingDurableCellArb];
  const PER_CELL_RUNS = runsPerCell(INVARIANT_2_RUNS, CELL_ARBS.length);

  for (const cellArb of CELL_ARBS) {
    fc.assert(
      fc.property(cellArb, ({ map, standingId }) => {
        const mapBoundKey = Object.keys(map).find((key) => map[key] === PIPELINE_BOARD_SUBJECT_ID);
        const standingSubject = standingId === undefined ? undefined : map[String(standingId)];
        // A remembered id the map now attributes to ANOTHER subject is not a
        // durable board identity - it is a stale memory of one. Reusing it
        // would re-introduce the crossing invariant 1 refuses, so it is not
        // counted as "still durably known" here.
        const standingIsUsable =
          standingId !== undefined && (standingSubject === undefined || standingSubject === PIPELINE_BOARD_SUBJECT_ID);
        const durablyKnown = mapBoundKey !== undefined || standingIsUsable;

        if (mapBoundKey !== undefined) {
          reach.mapBinding += 1;
        } else if (standingIsUsable) {
          reach.standingUsable += 1;
        } else if (standingId !== undefined) {
          reach.standingCrossed += 1;
        } else {
          reach.nothingDurable += 1;
        }

        const decision = decideEnsurePipelineBoardTopicAction(map, standingId);

        if (durablyKnown) {
          assert.notEqual(decision.kind, 'create', `created despite a durable record (map=${mapBoundKey} standing=${standingId})`);
          assert.equal(decision.topicId, mapBoundKey !== undefined ? Number(mapBoundKey) : standingId);
        } else {
          assert.equal(decision.kind, 'create', `reused nothing durable (standing=${standingId} -> ${standingSubject})`);
        }

        // Holds on BOTH branches, and is the half that ties invariant 2 back
        // to invariant 1: whatever identity re-establishment settles on, it
        // is never one the map attributes to someone else.
        if (decision.kind !== 'create') {
          const reusedSubject = map[String(decision.topicId)];
          assert.ok(
            reusedSubject === undefined || reusedSubject === PIPELINE_BOARD_SUBJECT_ID,
            `re-established identity onto ${decision.topicId}, which the map attributes to ${reusedSubject}`
          );
        }
      }),
      { numRuns: PER_CELL_RUNS }
    );
  }

  // Reachability floors. standingCrossed is the one that matters most: it is
  // the state a naive "remembered id wins" rebind would put the board
  // straight back into SUP-5.
  assertReachFloor(reach, ['mapBinding'], 100, 'BL-586 invariant 2 state');
  assertReachFloor(reach, ['standingUsable'], 50, 'BL-586 invariant 2 state');
  assertReachFloor(reach, ['standingCrossed'], 80, 'BL-586 invariant 2 state');
  assertReachFloor(reach, ['nothingDurable'], 25, 'BL-586 invariant 2 state');
});
