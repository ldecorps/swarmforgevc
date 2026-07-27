const assert = require('node:assert/strict');
const fc = require('fast-check');
const { computeEpicTopics, resolveTopicMembership } = require('../out/bridge/epicTopicSlugMatch');

// BL-686/BL-654: coder-authored property tests for this ticket's three
// declared invariants. Runs ONLY via `npm run test:properties`.
//
// Reachability is by CONSTRUCTION, not luck: epic ids are drawn from a pool
// disjoint from the slug pool (an epic's own id can never equal its own
// slug - the exact real-data shape that was missing everywhere BL-686
// fixes), and the slug pool is small relative to the epic-id pool, so two
// epic tickets sharing one slug (the BL-542/BL-545 shape) is reached by
// pigeonhole on most runs, not as a rare draw. Every epic ticket is also
// folded into `liveItems` as a `type: 'epic'` row carrying its own slug -
// reproducing the exact leak this ticket fixes (an epic tracker
// self-declares its own slug and would otherwise appear as a topic, and a
// make-top peer, of itself). Counters below assert every one of these
// shapes is actually hit across the run, not merely possible.

const EPIC_ID_POOL = ['EPIC-A', 'EPIC-B', 'EPIC-C', 'EPIC-D'];
const SLUG_POOL = ['slug-x', 'slug-y'];
const LIVE_ID_POOL = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

const epicsArb = fc
  .integer({ min: 1, max: EPIC_ID_POOL.length })
  .chain((count) =>
    fc.tuple(
      fc.shuffledSubarray(EPIC_ID_POOL, { minLength: count, maxLength: count }),
      fc.array(fc.constantFrom(...SLUG_POOL), { minLength: count, maxLength: count })
    )
  )
  .map(([ids, slugs]) => ids.map((id, i) => ({ id, epic: slugs[i] })));

const topicsArb = fc
  .integer({ min: 0, max: LIVE_ID_POOL.length })
  .chain((count) =>
    fc.tuple(
      fc.shuffledSubarray(LIVE_ID_POOL, { minLength: count, maxLength: count }),
      fc.array(fc.option(fc.constantFrom(...SLUG_POOL), { nil: undefined }), { minLength: count, maxLength: count })
    )
  )
  .map(([ids, slugs]) => ids.map((id, i) => ({ id, type: 'feature', epic: slugs[i] })));

// Every epic ticket is itself a live item (readLiveBacklogItems reads
// paused+hold with no type filter) - folding it in here is what makes the
// self-leak scenario reachable at all.
function toLiveItems(epics, topics) {
  const epicRows = epics.map((e) => ({ id: e.id, type: 'epic', epic: e.epic }));
  return [...epicRows, ...topics];
}

test('BL-686 invariant 1/3 (read side): topics is exactly the live non-epic items with a matching slug, tagged with exactly the epic ids sharing it', () => {
  let sawDuplicateSlugMatch = false;
  let sawEpicLessTopicExcluded = false;
  let sawEpicRowExcludedDespiteMatchingSlug = false;
  let sawNonEmptyTopics = false;

  fc.assert(
    fc.property(epicsArb, topicsArb, (epics, topics) => {
      const liveItems = toLiveItems(epics, topics);
      const result = computeEpicTopics(liveItems, epics);

      // invariant 3: no type: epic row is ever a topic, even though every
      // epic row here carries a truthy `epic:` slug (its own) that would
      // pass a naive `item.epic` filter.
      assert.ok(result.every((t) => t.type !== 'epic'));
      if (epics.length > 0 && result.length < liveItems.filter((i) => i.epic).length) {
        sawEpicRowExcludedDespiteMatchingSlug = true;
      }

      // invariant 1: exactly the live non-epic items declaring a slug.
      const expectedIds = new Set(topics.filter((t) => t.epic).map((t) => t.id));
      assert.deepEqual(new Set(result.map((t) => t.id)), expectedIds);
      if (topics.some((t) => !t.epic)) {
        sawEpicLessTopicExcluded = true;
      }
      if (result.length > 0) {
        sawNonEmptyTopics = true;
      }

      // invariant 1: each topic's epicIds is exactly the set of epic
      // ticket ids whose OWN slug matches - never the topic's raw slug
      // compared against an epic's id.
      for (const topic of result) {
        const expected = new Set(epics.filter((e) => e.epic === topic.epic).map((e) => e.id));
        assert.deepEqual(new Set(topic.epicIds), expected);
        if (expected.size >= 2) {
          sawDuplicateSlugMatch = true;
        }
      }
    }),
    { numRuns: 300 }
  );

  assert.ok(sawNonEmptyTopics, 'reachability floor: generator never produced a non-empty topics list');
  assert.ok(sawEpicLessTopicExcluded, 'reachability floor: generator never produced an epic-less topic to exclude');
  assert.ok(sawDuplicateSlugMatch, 'reachability floor: generator never produced two epic tickets sharing a slug');
  assert.ok(
    sawEpicRowExcludedDespiteMatchingSlug,
    'reachability floor: generator never produced an epic row whose own slug would have leaked it into topics'
  );
});

test('BL-686 invariant 2 (read/write agreement): resolveTopicMembership finds exactly the topics/peers computeEpicTopics attaches to that epic id, and never an epic tracker', () => {
  let sawMultiPeerEpic = false;
  let sawEpicIdWithNoMembers = false;
  let sawPeersExcludingAnEpicRow = false;

  fc.assert(
    fc.property(epicsArb, topicsArb, fc.nat(), (epics, topics, seed) => {
      const liveItems = toLiveItems(epics, topics);
      if (epics.length === 0) {
        return;
      }
      const readTopics = computeEpicTopics(liveItems, epics);
      const epicId = epics[seed % epics.length].id;
      const expectedMemberIds = new Set(readTopics.filter((t) => t.epicIds.includes(epicId)).map((t) => t.id));

      if (expectedMemberIds.size === 0) {
        sawEpicIdWithNoMembers = true;
        for (const topic of topics) {
          assert.equal(
            resolveTopicMembership(liveItems, epics, epicId, topic.id),
            null,
            `expected no membership for ${topic.id} under epic ${epicId}, which has no live topics`
          );
        }
        // an epic ticket id is also never a valid topicId, member set or not.
        for (const epic of epics) {
          assert.equal(resolveTopicMembership(liveItems, epics, epicId, epic.id), null);
        }
        return;
      }

      if (expectedMemberIds.size >= 2) {
        sawMultiPeerEpic = true;
      }

      for (const topicId of expectedMemberIds) {
        const membership = resolveTopicMembership(liveItems, epics, epicId, topicId);
        assert.ok(membership, `expected a membership result for ${topicId} under epic ${epicId}`);
        // read side and write side agree on WHO the target is.
        assert.equal(membership.target.id, topicId);
        // read side and write side agree on the peer set (invariant 2).
        const peerIds = new Set(membership.peers.map((p) => p.id));
        const expectedPeerIds = new Set([...expectedMemberIds].filter((id) => id !== topicId));
        assert.deepEqual(peerIds, expectedPeerIds);
        // invariant 3, write side: no epic tracker is ever a peer, even one
        // sharing the exact same slug.
        assert.ok(membership.peers.every((p) => p.type !== 'epic'));
        if (epics.length > expectedMemberIds.size && liveItems.some((i) => i.type === 'epic')) {
          sawPeersExcludingAnEpicRow = true;
        }
      }

      // an epic ticket's own id is never accepted as a topicId under any
      // epic, including its own (self-membership refusal, invariant 3).
      for (const epic of epics) {
        assert.equal(resolveTopicMembership(liveItems, epics, epicId, epic.id), null);
      }
    }),
    { numRuns: 300 }
  );

  assert.ok(sawMultiPeerEpic, 'reachability floor: generator never produced an epic with 2+ live topic peers');
  assert.ok(sawEpicIdWithNoMembers, 'reachability floor: generator never produced an epic id with zero live topics');
  assert.ok(sawPeersExcludingAnEpicRow, 'reachability floor: generator never had an epic row to exclude from a real peer set');
});
