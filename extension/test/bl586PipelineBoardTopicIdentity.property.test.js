const assert = require('node:assert/strict');
const fc = require('fast-check');
const { syncPipelineBoard } = require('../out/concierge/pipelineBoardSync');
const {
  PIPELINE_BOARD_SUBJECT_ID,
  decideEnsurePipelineBoardTopicAction,
} = require('../out/tools/telegramTopicDecisions');

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
// keys, making every pair a collision candidate by construction. The floor
// assertions below then prove the generator actually reached the interesting
// states rather than hoping it did.

const SUBJECTS = ['SUP-5', 'SUP-7', 'APPROVALS', 'OPERATOR', 'BACKLOG', 'CONTROL', 'RECERT', 'BABYSITTER'];

const topicIdArb = fc.integer({ min: 1, max: 40000 });

// A topic map with a handful of other-subject bindings and, sometimes, a
// PIPELINE_BOARD binding of its own.
const topicMapArb = fc
  .tuple(
    fc.uniqueArray(fc.tuple(topicIdArb, fc.constantFrom(...SUBJECTS)), { minLength: 1, maxLength: 6, selector: (e) => e[0] }),
    // freq 2 = a board binding present about half the time. The default
    // (1 in 5 nil) let the already-bound case swallow ~80% of runs, starving
    // the standing-record branches these properties exist to reach.
    fc.option(topicIdArb, { nil: undefined, freq: 2 })
  )
  .map(([entries, boardTopicId]) => {
    const map = {};
    for (const [id, subject] of entries) {
      map[String(id)] = subject;
    }
    if (boardTopicId !== undefined) {
      map[String(boardTopicId)] = PIPELINE_BOARD_SUBJECT_ID;
    }
    return map;
  });

// The stored tick-state id, derived from the map so a crossing is reached by
// construction rather than by luck: mostly one of the map's OWN keys (the
// 1634=SUP-7 / 14647=SUP-5 shape), occasionally an id the map says nothing
// about (the ordinary healthy case, which must keep working).
function storedIdArb(map) {
  const keys = Object.keys(map).map(Number);
  return fc.oneof(
    { weight: 4, arbitrary: fc.constantFrom(...keys) },
    { weight: 1, arbitrary: topicIdArb.filter((id) => map[String(id)] === undefined) }
  );
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

test('property (BL-586 invariant 1): for any topic map and any stored id, the board only ever posts into a topic the map does not attribute to another subject', async () => {
  const reach = { crossed: 0, boardBound: 0, unmapped: 0 };

  await fc.assert(
    fc.asyncProperty(
      topicMapArb.chain((map) => storedIdArb(map).map((storedId) => ({ map, storedId }))),
      async ({ map, storedId }) => {
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
      }
    )
  );

  // Reachability floor: a property that never generated a crossing would be
  // vacuously green against the very defect it exists to catch.
  assert.ok(reach.crossed >= 50, `generator reached only ${reach.crossed} crossed states`);
  assert.ok(reach.boardBound >= 5, `generator reached only ${reach.boardBound} already-board-bound states`);
  assert.ok(reach.unmapped >= 5, `generator reached only ${reach.unmapped} unmapped states`);
});

// The standing record's OWN id, derived from the map for the same
// collision-by-construction reason as storedIdArb above. A standing record
// can itself be crossed - the 2026-07-23 repair cleared tick state while a
// running bridge still held the crossed id, and any writer could persist one
// - so "still durably known" has to be told apart from "still durably
// REMEMBERED, but now someone else's". Drawing this independently of the map
// would never construct that state at all: with ~7 bindings out of 40000 ids
// the collision arrives roughly once in a thousand runs, so the property
// would report a comfortable green while never once exercising the branch it
// exists to pin.
function standingIdArb(map) {
  const keys = Object.keys(map).map(Number);
  return fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom(...keys) },
    { weight: 2, arbitrary: topicIdArb.filter((id) => map[String(id)] === undefined) },
    { weight: 1, arbitrary: fc.constant(undefined) }
  );
}

// numRuns is pinned rather than left at the default so the reachability
// floors below are a real assertion about the generator's shape and not a
// coin flip on the run count.
const INVARIANT_2_RUNS = 1000;

test('property (BL-586 invariant 2): whenever the board topic is still durably known AND still the board\'s, re-establishing identity reuses it and never creates', () => {
  const reach = { mapBinding: 0, standingUsable: 0, standingCrossed: 0, nothingDurable: 0 };

  fc.assert(
    fc.property(
      topicMapArb.chain((map) => standingIdArb(map).map((standingId) => ({ map, standingId }))),
      ({ map, standingId }) => {
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
      }
    ),
    { numRuns: INVARIANT_2_RUNS }
  );

  // Reachability floors. standingCrossed is the one that matters most: it is
  // the state the previous generator could not construct, and the state in
  // which a naive "remembered id wins" rebind would put the board straight
  // back into SUP-5.
  assert.ok(reach.mapBinding >= 100, `generator reached only ${reach.mapBinding} map-bound states`);
  assert.ok(reach.standingUsable >= 50, `generator reached only ${reach.standingUsable} usable-standing-record states`);
  assert.ok(reach.standingCrossed >= 80, `generator reached only ${reach.standingCrossed} crossed-standing-record states`);
  assert.ok(reach.nothingDurable >= 25, `generator reached only ${reach.nothingDurable} nothing-durable states`);
});
