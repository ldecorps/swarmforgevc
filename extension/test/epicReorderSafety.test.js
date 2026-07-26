const assert = require('node:assert/strict');
const { sortEpicsByPriority, computeEpicReorder } = require('../out/bridge/epicReorderSafety');

// Architect bounce #1 (backlog/evidence/BL-572-architect-bounce1-20260726.md)
// found that value-pair assertions ("selected ends with a lower value than
// its neighbour") stayed green while the mover silently teleported many
// positions, because priority is only a partial order key (ties break by
// id) and an earlier implementation derived writes from raw values instead
// of from position. These helpers apply a move's writes and re-derive the
// resulting FULL LIST INDEX, so every test below can assert on the thing
// that actually matters: does the selected epic move by exactly one
// position, and does every untouched epic keep its exact relative order.
//
// Architect bounce #2 (backlog/evidence/BL-572-architect-bounce2-20260726.md)
// then found that a two-slot-window fix REFUSED 14 of 24 real moves (every
// move inside a run tied at the priority floor). The ticket was amended: a
// move is never refused except at the true list boundary. The tests below
// replace the old "refuses when it cannot..." cases with cases asserting
// the cascade always finds an integer solution instead.

function applyWrites(epics, writes) {
  const byId = new Map(epics.map((e) => [e.id, e.priority]));
  for (const w of writes) {
    byId.set(w.id, w.priority);
  }
  return epics.map((e) => ({ id: e.id, priority: byId.get(e.id) }));
}

function indexOf(epics, id) {
  return epics.findIndex((e) => e.id === id);
}

// Asserts the full-list-index property: the selected epic moves by exactly
// `expectedShift` positions, every epic NOT in the write set keeps its
// exact relative order to every other untouched epic (an id-ordered
// subsequence comparison, not just "still present"), and no write is ever
// negative or lands above the moved pair.
function assertPositionShift(before, selectedId, direction, expectedShift) {
  const beforeOrder = before.map((e) => e.id);
  const beforeIndex = indexOf(before, selectedId);
  const result = computeEpicReorder(before, selectedId, direction);
  assert.notEqual(result, null, 'expected a move, got null');
  assert.equal(result.changed, true, 'expected a non-boundary move to report changed: true');

  const after = sortEpicsByPriority(applyWrites(before, result.writes));
  const afterOrder = after.map((e) => e.id);
  const afterIndex = indexOf(after, selectedId);
  assert.equal(
    afterIndex - beforeIndex,
    expectedShift,
    `expected ${selectedId} to shift by ${expectedShift}, moved from ${beforeIndex} to ${afterIndex} (${JSON.stringify(beforeOrder)} -> ${JSON.stringify(afterOrder)})`
  );

  const touched = new Set(result.writes.map((w) => w.id));
  const untouchedBefore = beforeOrder.filter((id) => id !== selectedId && !touched.has(id));
  const untouchedAfter = afterOrder.filter((id) => id !== selectedId && !touched.has(id));
  assert.deepEqual(
    untouchedAfter,
    untouchedBefore,
    `untouched epics' relative order must be unchanged: ${JSON.stringify(untouchedBefore)} -> ${JSON.stringify(untouchedAfter)}`
  );

  const negativePriority = after.find((e) => e.priority < 0);
  assert.equal(negativePriority, undefined, `floor violated: ${JSON.stringify(negativePriority)}`);

  const minTouchedIndex = Math.min(...result.writes.map((w) => indexOf(before, w.id)));
  const pairLowIndex = Math.min(beforeIndex, beforeIndex + (direction === 'up' ? -1 : 1));
  if (result.writes.length > 0) {
    assert.ok(
      minTouchedIndex >= pairLowIndex,
      `a write landed above the moved pair: touched index ${minTouchedIndex} < pair low index ${pairLowIndex}`
    );
  }

  return result;
}

test('sortEpicsByPriority orders ascending by priority, then id ascending on ties', () => {
  const epics = [
    { id: 'BL-003', priority: 5 },
    { id: 'BL-002', priority: 1 },
    { id: 'BL-005', priority: 1 },
    { id: 'BL-001', priority: 3 },
  ];
  assert.deepEqual(
    sortEpicsByPriority(epics).map((e) => e.id),
    ['BL-002', 'BL-005', 'BL-001', 'BL-003']
  );
});

test('sortEpicsByPriority never mutates its input array', () => {
  const epics = [{ id: 'BL-002', priority: 5 }, { id: 'BL-001', priority: 1 }];
  const original = epics.slice();
  sortEpicsByPriority(epics);
  assert.deepEqual(epics, original);
});

test('computeEpicReorder: moving a mid-list epic up swaps its priority with its neighbour above (exactly two writes)', () => {
  const epics = [
    { id: 'BL-001', priority: 10 },
    { id: 'BL-002', priority: 20 },
    { id: 'BL-003', priority: 30 },
  ];
  const result = computeEpicReorder(epics, 'BL-002', 'up');
  assert.notEqual(result, null);
  assert.equal(result.changed, true);
  assert.deepEqual(
    result.writes.slice().sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: 'BL-001', priority: 20 },
      { id: 'BL-002', priority: 10 },
    ]
  );
});

test('computeEpicReorder: moving a mid-list epic down swaps its priority with its neighbour below (exactly two writes)', () => {
  const epics = [
    { id: 'BL-001', priority: 10 },
    { id: 'BL-002', priority: 20 },
    { id: 'BL-003', priority: 30 },
  ];
  const result = computeEpicReorder(epics, 'BL-002', 'down');
  assert.notEqual(result, null);
  assert.deepEqual(
    result.writes.slice().sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: 'BL-002', priority: 30 },
      { id: 'BL-003', priority: 20 },
    ]
  );
});

test('computeEpicReorder: moving the first epic up is a boundary no-op with a stated reason', () => {
  const epics = [
    { id: 'BL-001', priority: 10 },
    { id: 'BL-002', priority: 20 },
  ];
  const result = computeEpicReorder(epics, 'BL-001', 'up');
  assert.notEqual(result, null);
  assert.equal(result.changed, false);
  assert.deepEqual(result.writes, []);
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
});

test('computeEpicReorder: moving the last epic down is a boundary no-op with a stated reason', () => {
  const epics = [
    { id: 'BL-001', priority: 10 },
    { id: 'BL-002', priority: 20 },
  ];
  const result = computeEpicReorder(epics, 'BL-002', 'down');
  assert.notEqual(result, null);
  assert.equal(result.changed, false);
  assert.deepEqual(result.writes, []);
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
});

test('computeEpicReorder: an unknown selected id returns null', () => {
  const epics = [
    { id: 'BL-001', priority: 10 },
    { id: 'BL-002', priority: 20 },
  ];
  assert.equal(computeEpicReorder(epics, 'BL-999', 'up'), null);
});

test('computeEpicReorder: a single-item list is always a boundary no-op', () => {
  const epics = [{ id: 'BL-001', priority: 10 }];
  assert.equal(computeEpicReorder(epics, 'BL-001', 'up').changed, false);
  assert.equal(computeEpicReorder(epics, 'BL-001', 'down').changed, false);
});

test('computeEpicReorder: tied priorities moving up still produce a strict ordering', () => {
  const epics = [
    { id: 'BL-001', priority: 20 },
    { id: 'BL-002', priority: 20 },
  ];
  const result = computeEpicReorder(epics, 'BL-002', 'up');
  assert.notEqual(result, null);
  assert.equal(result.changed, true);
  const after = new Map(applyWrites(epics, result.writes).map((e) => [e.id, e.priority]));
  assert.ok(after.get('BL-002') < after.get('BL-001'));
});

test('computeEpicReorder: tied priorities moving down still produce a strict ordering', () => {
  const epics = [
    { id: 'BL-001', priority: 20 },
    { id: 'BL-002', priority: 20 },
  ];
  const result = computeEpicReorder(epics, 'BL-001', 'down');
  assert.notEqual(result, null);
  const after = new Map(applyWrites(epics, result.writes).map((e) => [e.id, e.priority]));
  assert.ok(after.get('BL-001') > after.get('BL-002'));
});

test('computeEpicReorder: never modifies any epic above the moved pair', () => {
  const epics = [
    { id: 'BL-001', priority: 10 },
    { id: 'BL-002', priority: 20 },
    { id: 'BL-003', priority: 30 },
    { id: 'BL-004', priority: 40 },
  ];
  const result = computeEpicReorder(epics, 'BL-003', 'up');
  const touchedIds = result.writes.map((w) => w.id).sort();
  assert.deepEqual(touchedIds, ['BL-002', 'BL-003']);
});

// --- Position-index regressions for architect bounce #1 -------------------

test('site 1/2 (evidence): a mover at the end of a large tied run shifts by exactly one position, not past the whole run', () => {
  const nineTiedAtZero = [
    { id: 'BL-517', priority: 0 },
    { id: 'BL-539', priority: 0 },
    { id: 'BL-540', priority: 0 },
    { id: 'BL-541', priority: 0 },
    { id: 'BL-542', priority: 0 },
    { id: 'BL-543', priority: 0 },
    { id: 'BL-545', priority: 0 },
    { id: 'BL-558', priority: 0 },
    { id: 'BL-594', priority: 0 },
    { id: 'BL-564', priority: 10 },
  ];
  assertPositionShift(sortEpicsByPriority(nineTiedAtZero), 'BL-594', 'up', -1);
});

test('site 1/2 (evidence): symmetric down-move within a tied run shifts by exactly one position', () => {
  const tied = [
    { id: 'BL-517', priority: 0 },
    { id: 'BL-539', priority: 0 },
    { id: 'BL-540', priority: 0 },
  ];
  assertPositionShift(sortEpicsByPriority(tied), 'BL-539', 'down', 1);
});

test('site 3 (evidence): a swapped-in value already held by a third epic must not reorder that third epic', () => {
  const withThirdPartyCollision = [
    { id: 'BL-900', priority: 10 },
    { id: 'BL-100', priority: 20 },
    { id: 'BL-200', priority: 20 },
  ];
  const before = sortEpicsByPriority(withThirdPartyCollision);
  const result = assertPositionShift(before, 'BL-100', 'up', -1);
  assert.ok(!result.writes.some((w) => w.id === 'BL-200'));
});

test('a run-internal tie collision (neighbour tied with the epic before it) does not misplace the mover past that epic too', () => {
  const beforeTiedWithNeighbor = [
    { id: 'BL-050', priority: 5 },
    { id: 'BL-060', priority: 5 },
    { id: 'BL-010', priority: 6 },
  ];
  assertPositionShift(sortEpicsByPriority(beforeTiedWithNeighbor), 'BL-010', 'up', -1);
});

test('a three-way tie moving the middle item up shifts by exactly one position', () => {
  const threeWayTie = [
    { id: 'BL-001', priority: 20 },
    { id: 'BL-002', priority: 20 },
    { id: 'BL-003', priority: 20 },
  ];
  assertPositionShift(sortEpicsByPriority(threeWayTie), 'BL-002', 'up', -1);
});

// --- Architect bounce #2 regressions: never refuse -------------------------

test('computeEpicReorder: three epics tied at the floor - a move that bounce #1\'s algorithm refused now succeeds', () => {
  const allTiedAtFloor = [
    { id: 'BL-001', priority: 0 },
    { id: 'BL-002', priority: 0 },
    { id: 'BL-003', priority: 0 },
  ];
  const sorted = sortEpicsByPriority(allTiedAtFloor);
  assertPositionShift(sorted, 'BL-001', 'down', 1);
});

test('computeEpicReorder: every move inside a nine-epic run tied at the floor succeeds (bounce #2\'s reproduction, all 24 moves)', () => {
  const ids = ['BL-517', 'BL-539', 'BL-540', 'BL-541', 'BL-542', 'BL-543', 'BL-545', 'BL-558', 'BL-594'];
  const base = sortEpicsByPriority(ids.map((id) => ({ id, priority: 0 })));
  for (const id of ids) {
    for (const direction of ['up', 'down']) {
      const index = indexOf(base, id);
      const neighborIndex = direction === 'up' ? index - 1 : index + 1;
      if (neighborIndex < 0 || neighborIndex >= base.length) {
        continue; // true list boundary - legally a no-op, not part of this regression
      }
      const expectedShift = direction === 'up' ? -1 : 1;
      assertPositionShift(base, id, direction, expectedShift);
    }
  }
});

test('computeEpicReorder: a move inside a tied run at the floor never writes a negative priority', () => {
  const nearFloor = [
    { id: 'BL-001', priority: 0 },
    { id: 'BL-002', priority: 0 },
    { id: 'BL-003', priority: 0 },
    { id: 'BL-004', priority: 0 },
    { id: 'BL-005', priority: 5 },
  ];
  const sorted = sortEpicsByPriority(nearFloor);
  const result = computeEpicReorder(sorted, 'BL-004', 'up');
  assert.notEqual(result, null);
  const after = applyWrites(sorted, result.writes);
  assert.ok(after.every((e) => e.priority >= 0));
});

test('computeEpicReorder: a tie-run rewrite never writes an epic above the moved pair, even when it also rewrites epics after it', () => {
  // Four tied at 0: moving the third up rewrites the (now-displaced) neighbour
  // and, to keep the trailing epic's relative order, the epic after it too -
  // but never the untouched epic before the pair.
  const fourTiedAtZero = [
    { id: 'BL-960', priority: 0 },
    { id: 'BL-961', priority: 0 },
    { id: 'BL-962', priority: 0 },
    { id: 'BL-963', priority: 0 },
  ];
  const sorted = sortEpicsByPriority(fourTiedAtZero);
  const result = assertPositionShift(sorted, 'BL-962', 'up', -1);
  assert.ok(!result.writes.some((w) => w.id === 'BL-960'), 'the untouched epic before the pair must never be written');
  assert.ok(result.writes.length >= 2, `expected the cascade to extend beyond the pair, got ${JSON.stringify(result.writes)}`);
});

test('computeEpicReorder: a squeeze against the epic before the pair (id sorts unsafely) still finds room without refusing', () => {
  // 'BL-999' ties with the low-slot epic at the SAME value the mover would
  // naturally take, and its id sorts AFTER the mover's - an unsafe tie the
  // naive swap can't just assume away.
  const squeeze = [
    { id: 'BL-999', priority: 5 },
    { id: 'BL-100', priority: 5 },
    { id: 'BL-001', priority: 20 },
  ];
  const sorted = sortEpicsByPriority(squeeze);
  assertPositionShift(sorted, 'BL-001', 'up', -1);
});
