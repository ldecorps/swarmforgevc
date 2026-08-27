const assert = require('node:assert/strict');
const fc = require('fast-check');
const { combineWithinEpicLiveItems } = require('../out/bridge/bridgeServer');
const { computeEpicTopics } = require('../out/bridge/epicTopicSlugMatch');

// BL-687/BL-654: coder-authored property test for declared invariant 1 -
// "An epic tile's drill-down lists exactly the non-type:epic tickets in
// paused, hold AND active whose epic: slug equals that tile's slug - none of
// those three folders is ever silently absent, and a done/ child never
// appears." Runs ONLY via `npm run test:properties`.
//
// combineWithinEpicLiveItems is the pure combination step (bridgeServer.ts)
// that readWithinEpicLiveBacklogItems wraps with an FS read - testing it
// directly here is exactly the "put IO behind a small adapter boundary"
// split the engineering article asks for, so this invariant is verifiable
// without a filesystem.
//
// Reachability is by CONSTRUCTION: every item is tagged with a folder drawn
// from all four buckets (paused/hold/active/done) and roughly half declare
// `type: 'epic'` so the "an epic row is excluded even when it matches" case
// (mirroring BL-686's own reachability floor) is hit on most runs, not hoped
// for. Counters below assert every folder/exclusion shape the invariant's
// wording names is actually exercised, not merely possible.

const FOLDERS = ['paused', 'hold', 'active', 'done'];
const SLUG_POOL = ['slug-x', 'slug-y'];
const ID_POOL = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];

const itemArb = fc.record({
  folder: fc.constantFrom(...FOLDERS),
  type: fc.constantFrom('feature', 'epic'),
  epic: fc.option(fc.constantFrom(...SLUG_POOL), { nil: undefined }),
  priority: fc.integer({ min: 0, max: 5 }),
});

const itemsArb = fc
  .integer({ min: 0, max: ID_POOL.length })
  .chain((count) =>
    fc.tuple(
      fc.shuffledSubarray(ID_POOL, { minLength: count, maxLength: count }),
      fc.array(itemArb, { minLength: count, maxLength: count })
    )
  )
  .map(([ids, metas]) => ids.map((id, i) => ({ id, ...metas[i] })));

function splitIntoFolders(items) {
  const folders = { paused: [], hold: [], active: [], done: [] };
  for (const item of items) {
    const { folder, ...rest } = item;
    folders[folder].push(rest);
  }
  return folders;
}

const epicsArb = fc.constant([
  { id: 'EPIC-X', epic: 'slug-x' },
  { id: 'EPIC-Y', epic: 'slug-y' },
]);

test('BL-687 property: invariant 1 - within-epic membership is exactly the non-epic items in paused+hold+active sharing the slug; done never appears; each is tagged inFlight by its own folder', () => {
  let sawPausedMember = false;
  let sawHoldMember = false;
  let sawActiveMember = false;
  let sawDoneExcluded = false;
  let sawEpicRowExcludedDespiteMatchingSlug = false;
  let sawEpicLessItemExcluded = false;

  fc.assert(
    fc.property(itemsArb, epicsArb, (items, epics) => {
      const folders = splitIntoFolders(items);
      const withinEpic = combineWithinEpicLiveItems(folders);
      const topics = computeEpicTopics(withinEpic, epics);
      const topicIds = new Set(topics.map((t) => t.id));

      const expectedMembers = items.filter((i) => i.folder !== 'done' && i.type !== 'epic' && i.epic);
      const expectedIds = new Set(expectedMembers.map((i) => i.id));
      assert.deepEqual(topicIds, expectedIds);

      for (const item of items) {
        if (item.folder === 'done' && item.type !== 'epic' && item.epic) {
          assert.ok(!topicIds.has(item.id), `expected done/ item ${item.id} to never appear as a topic`);
          if (epics.some((e) => e.epic === item.epic)) {
            sawDoneExcluded = true;
          }
        }
        if (item.type === 'epic' && item.folder !== 'done' && item.epic && epics.some((e) => e.epic === item.epic)) {
          assert.ok(!topicIds.has(item.id), `expected epic-typed row ${item.id} to never appear as a topic`);
          sawEpicRowExcludedDespiteMatchingSlug = true;
        }
        if (!item.epic && item.folder !== 'done') {
          assert.ok(!topicIds.has(item.id), `expected epic-less item ${item.id} to never appear as a topic`);
          sawEpicLessItemExcluded = true;
        }
      }

      // Each surviving topic is tagged inFlight by exactly its own folder -
      // never a stale/default value.
      const byId = new Map(items.map((i) => [i.id, i]));
      for (const topic of topics) {
        const source = byId.get(topic.id);
        assert.equal(topic.inFlight, source.folder === 'active', `expected ${topic.id}'s inFlight to reflect its folder (${source.folder})`);
        if (source.folder === 'paused') sawPausedMember = true;
        if (source.folder === 'hold') sawHoldMember = true;
        if (source.folder === 'active') sawActiveMember = true;
      }
    }),
    { numRuns: 400 }
  );

  assert.ok(sawPausedMember, 'reachability floor: generator never produced a paused/ member');
  assert.ok(sawHoldMember, 'reachability floor: generator never produced a hold/ member');
  assert.ok(sawActiveMember, 'reachability floor: generator never produced an active/ member');
  assert.ok(sawDoneExcluded, 'reachability floor: generator never produced a done/ item excluded despite a matching slug');
  assert.ok(
    sawEpicRowExcludedDespiteMatchingSlug,
    'reachability floor: generator never produced a non-done epic-typed row excluded despite a matching slug'
  );
  assert.ok(sawEpicLessItemExcluded, 'reachability floor: generator never produced a non-done epic-less item to exclude');
});
