const assert = require('node:assert/strict');
const fc = require('fast-check');
const { sortEpicsByPriority, computeEpicReorder } = require('../out/bridge/epicReorderSafety');

// BL-654: computeEpicReorder is a pure module (extension/src/bridge/
// epicReorderSafety.ts) with THREE declared invariants
// (backlog/active/BL-572-epic-priority-reorder-console.yaml `invariants:`).
// This file encodes each as an executable property, coder-authored per the
// declared-invariant contract, over every backlog shape the generator can
// build - not just the hand-picked examples in epicReorderSafety.test.js.
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs);
// excluded from the unit/coverage/mutation run.
//
// Generator design note (property-test generator must reach deep state):
// architect bounce #2 was specifically about a long run of epics TIED at
// the priority floor - a state a uniform-random-integer generator would
// almost never construct. Priorities are drawn from a tiny {0,1,2,3} domain
// so exact ties, including multi-epic runs pinned at the floor, are the
// COMMON case here, not a lucky accident. A reachability-floor test below
// asserts the generator actually exercises the tied-pair (cascade) path and
// the true list-boundary path at a non-trivial rate, so a future edit that
// silently narrows the generator's range is caught here rather than by a
// property that quietly stops covering what it claims to.

const ID_POOL = [
  'BL-001', 'BL-002', 'BL-003', 'BL-050', 'BL-060', 'BL-100', 'BL-101',
  'BL-200', 'BL-300', 'BL-517', 'BL-539', 'BL-540', 'BL-541', 'BL-558',
  'BL-594', 'BL-900', 'BL-999', 'ZZ-001', 'AA-001', 'AA-500',
];

// A tiny domain so exact ties (including multi-epic runs at the floor) are
// the common case, not a statistical accident.
const priorityArb = fc.integer({ min: 0, max: 3 });

const epicsArb = fc
  .integer({ min: 2, max: ID_POOL.length })
  .chain((count) =>
    fc.tuple(
      fc.shuffledSubarray(ID_POOL, { minLength: count, maxLength: count }),
      fc.array(priorityArb, { minLength: count, maxLength: count })
    )
  )
  .map(([ids, priorities]) => ids.map((id, i) => ({ id, priority: priorities[i] })));

const directionArb = fc.constantFrom('up', 'down');

function applyWrites(epics, writes) {
  const byId = new Map(epics.map((e) => [e.id, e.priority]));
  for (const w of writes) {
    byId.set(w.id, w.priority);
  }
  return epics.map((e) => ({ id: e.id, priority: byId.get(e.id) }));
}

// Resolves a generated raw index into a valid position in `sorted` and the
// neighbour index a move in `direction` would target - shared by every
// property below so each one drives computeEpicReorder against exactly the
// same (selected, neighbour) pair its own assertions reason about.
function selectMove(sorted, rawIndex, direction) {
  const selectedIndex = rawIndex % sorted.length;
  const neighborIndex = direction === 'up' ? selectedIndex - 1 : selectedIndex + 1;
  return { selectedIndex, neighborIndex, selectedId: sorted[selectedIndex].id };
}

test('property: generator reaches both the tied-pair cascade path and the true list-boundary path (reachability floor)', () => {
  let tiedPair = 0;
  let boundary = 0;
  let total = 0;
  fc.assert(
    fc.property(epicsArb, fc.nat(), directionArb, (epics, rawIndex, direction) => {
      total += 1;
      const sorted = sortEpicsByPriority(epics);
      const { selectedIndex, neighborIndex } = selectMove(sorted, rawIndex, direction);
      if (neighborIndex < 0 || neighborIndex >= sorted.length) {
        boundary += 1;
        return;
      }
      const lowIndex = Math.min(selectedIndex, neighborIndex);
      if (sorted[lowIndex].priority === sorted[lowIndex + 1].priority) {
        tiedPair += 1;
      }
    }),
    { numRuns: 500 }
  );
  assert.ok(
    tiedPair > total * 0.15,
    `expected the generator to reach many tied-pair moves (the cascade path this ticket exists for): ${tiedPair}/${total}`
  );
  assert.ok(boundary > 5, `expected the generator to reach some true list-boundary moves: ${boundary}/${total}`);
});

test('property: invariant 1 - an accepted move shifts the mover by exactly one position and every other pair of epics keeps its relative order', () => {
  fc.assert(
    fc.property(epicsArb, fc.nat(), directionArb, (epics, rawIndex, direction) => {
      const sorted = sortEpicsByPriority(epics);
      const { selectedIndex, selectedId } = selectMove(sorted, rawIndex, direction);
      const result = computeEpicReorder(sorted, selectedId, direction);
      if (!result || !result.changed) {
        return; // boundary no-ops are covered by invariant 3 below
      }

      const after = sortEpicsByPriority(applyWrites(sorted, result.writes));
      const afterIndex = after.findIndex((e) => e.id === selectedId);
      const expectedShift = direction === 'up' ? -1 : 1;
      assert.equal(
        afterIndex - selectedIndex,
        expectedShift,
        `mover shifted by ${afterIndex - selectedIndex}, expected ${expectedShift} (epics=${JSON.stringify(sorted)}, id=${selectedId}, dir=${direction})`
      );

      // Every OTHER pair of epics (excluding the mover) keeps its relative
      // display order - checked pairwise, the literal reading of the
      // declared invariant, not just "still present in the same sequence".
      const otherIds = sorted.filter((e) => e.id !== selectedId).map((e) => e.id);
      const beforeRank = new Map(otherIds.map((id, i) => [id, i]));
      const afterOtherIds = after.filter((e) => e.id !== selectedId).map((e) => e.id);
      const afterRank = new Map(afterOtherIds.map((id, i) => [id, i]));
      for (const a of otherIds) {
        for (const b of otherIds) {
          if (a === b) continue;
          assert.equal(
            beforeRank.get(a) < beforeRank.get(b),
            afterRank.get(a) < afterRank.get(b),
            `relative order of ${a} vs ${b} changed (epics=${JSON.stringify(sorted)}, moved=${selectedId}, dir=${direction})`
          );
        }
      }
    })
  );
});

test('property: invariant 2 - no write is ever negative, and no write ever touches an epic listed above the moved pair', () => {
  fc.assert(
    fc.property(epicsArb, fc.nat(), directionArb, (epics, rawIndex, direction) => {
      const sorted = sortEpicsByPriority(epics);
      const { selectedIndex, neighborIndex, selectedId } = selectMove(sorted, rawIndex, direction);
      const result = computeEpicReorder(sorted, selectedId, direction);
      if (!result) {
        return; // defensive not-found path, unreachable via the route
      }

      for (const write of result.writes) {
        assert.ok(write.priority >= 0, `negative write: ${JSON.stringify(write)} (epics=${JSON.stringify(sorted)})`);
      }

      if (neighborIndex < 0 || neighborIndex >= sorted.length) {
        assert.deepEqual(result.writes, [], 'a boundary no-op must write nothing');
        return;
      }

      const pairLowIndex = Math.min(selectedIndex, neighborIndex);
      const idToIndex = new Map(sorted.map((e, i) => [e.id, i]));
      for (const write of result.writes) {
        const writtenIndex = idToIndex.get(write.id);
        assert.ok(
          writtenIndex >= pairLowIndex,
          `write to ${write.id} (index ${writtenIndex}) landed above the moved pair (low index ${pairLowIndex}), epics=${JSON.stringify(sorted)}`
        );
      }
    })
  );
});

test('property: invariant 3 - every move tap yields an observable outcome: the order changes, or a non-empty reason is given', () => {
  fc.assert(
    fc.property(epicsArb, fc.nat(), directionArb, (epics, rawIndex, direction) => {
      const sorted = sortEpicsByPriority(epics);
      const { selectedIndex, selectedId } = selectMove(sorted, rawIndex, direction);
      const result = computeEpicReorder(sorted, selectedId, direction);
      if (!result) {
        return; // defensive not-found path, unreachable via the route
      }

      if (result.changed) {
        const after = sortEpicsByPriority(applyWrites(sorted, result.writes));
        const afterIndex = after.findIndex((e) => e.id === selectedId);
        assert.notEqual(afterIndex, selectedIndex, `changed:true but the displayed order did not move ${selectedId}`);
      } else {
        assert.equal(result.writes.length, 0, 'changed:false must write nothing');
        assert.equal(typeof result.reason, 'string', 'changed:false must carry a reason');
        assert.ok(result.reason.trim().length > 0, 'changed:false reason must be non-empty');
      }
    })
  );
});
