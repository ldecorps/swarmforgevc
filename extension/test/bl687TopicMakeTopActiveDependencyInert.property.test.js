const assert = require('node:assert/strict');
const fc = require('fast-check');
const { sortEpicsByPriority } = require('../out/bridge/epicReorderSafety');
const { computeMakeTopPriority } = require('../out/bridge/makeTopPrioritySafety');

// BL-687/BL-654: coder-authored property test for declared invariant 2 -
// "Widening the within-epic set changes ORDER only: for every backlog
// state, whether a topic make-top is refused, bounded, or accepted on
// DEPENDENCY grounds is identical to what it was when the set was
// paused+hold - an active/ ticket is never a live dependency." Runs ONLY
// via `npm run test:properties`.
//
// Pairs are constructed, not independently drawn (BL-654's generator-reach
// requirement): the SAME narrow (paused+hold) fixture is run twice - once as
// a CONTROL with no such dependency at all, once as the TREATMENT where the
// target additionally depends on an id that is present in the widened
// ORDERING array but absent from dependencyLiveItems (exactly BL-687's own
// active/-but-not-narrow shape). If widening ever let that id become live -
// bounding, blocking, or entering a cycle/dangling check - the treatment's
// `changed`/`reason` would diverge from the control's. They never should.

const LIVE_ID_POOL = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2'];
const EPICS = ['EA', 'EB'];
const ACTIVE_ID = 'ACTIVE-DEP';
const LABEL = 'the epic\'s live topics';

function resolveNonLive(id) {
  return id === ACTIVE_ID ? 'active' : 'unknown';
}

const priorityArb = fc.integer({ min: 0, max: 3 });
const epicArb = fc.constantFrom(...EPICS);

// Narrow (paused+hold) items only - the active id never appears in this pool
// at all, matching BL-673's original single-set world exactly.
const narrowItemsArb = fc
  .integer({ min: 2, max: LIVE_ID_POOL.length })
  .chain((count) =>
    fc
      .tuple(
        fc.shuffledSubarray(LIVE_ID_POOL, { minLength: count, maxLength: count }),
        fc.array(priorityArb, { minLength: count, maxLength: count }),
        fc.array(epicArb, { minLength: count, maxLength: count })
      )
      .map(([ids, priorities, epics]) => ids.map((id, i) => ({ id, priority: priorities[i], epic: epics[i], dependsOn: [] })))
  );

// The active dependency's own priority - chosen independently, since its
// numeric ordering position must never matter (it's never a peer, never in
// dependencyLiveItems).
const activePriorityArb = fc.integer({ min: -1, max: 4 });

function peersOf(sorted, epic, targetId) {
  return sorted.filter((i) => i.epic === epic && i.id !== targetId);
}

test('BL-687 property: invariant 2 - a depends_on id present in the widened ordering array but absent from dependencyLiveItems, resolved "active", is fully inert (matches a no-dependency control exactly)', () => {
  let sawTreatmentChanged = false;
  let sawTreatmentUnchanged = false;

  fc.assert(
    fc.property(narrowItemsArb, fc.nat(), activePriorityArb, (narrowItems, rawIndex, activePriority) => {
      const sorted = sortEpicsByPriority(narrowItems);
      const targetId = sorted[rawIndex % sorted.length].id;
      const target = sorted.find((i) => i.id === targetId);
      const peers = peersOf(sorted, target.epic, targetId);

      // control: the narrow world exactly as BL-673 always ran it - target
      // has no depends_on, dependencyLiveItems defaults to sortedLiveItems.
      const controlItems = sorted.map((i) => (i.id === targetId ? { ...i, dependsOn: [] } : i));
      const controlResult = computeMakeTopPriority(controlItems, targetId, resolveNonLive, peers, LABEL);

      // treatment: same narrow world, target now depends on an id that's
      // ONLY in the widened ordering array (never a peer, never in the
      // narrow dependencyLiveItems) - exactly BL-687's active/-sourced shape.
      const treatmentNarrow = sorted.map((i) => (i.id === targetId ? { ...i, dependsOn: [ACTIVE_ID] } : i));
      const activeExtra = { id: ACTIVE_ID, priority: activePriority, dependsOn: [] };
      const widenedOrdering = sortEpicsByPriority([...treatmentNarrow, activeExtra]);
      const narrowDependencyLive = sortEpicsByPriority(treatmentNarrow);
      const treatmentResult = computeMakeTopPriority(
        widenedOrdering,
        targetId,
        resolveNonLive,
        peers,
        LABEL,
        narrowDependencyLive
      );

      assert.equal(
        treatmentResult.changed,
        controlResult.changed,
        `expected an inert active dependency to never change the refused/bounded/accepted verdict for ${targetId}`
      );
      assert.equal(
        treatmentResult.reason,
        controlResult.reason,
        `expected an inert active dependency to never change the reason text for ${targetId}`
      );

      if (treatmentResult.changed) sawTreatmentChanged = true;
      else sawTreatmentUnchanged = true;
    }),
    { numRuns: 400 }
  );

  assert.ok(sawTreatmentChanged, 'reachability floor: generator never produced a changed:true case');
  assert.ok(sawTreatmentUnchanged, 'reachability floor: generator never produced a changed:false case');
});
