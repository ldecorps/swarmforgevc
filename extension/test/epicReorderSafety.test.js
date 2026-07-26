const assert = require('node:assert/strict');
const { sortEpicsByPriority, computeEpicReorder } = require('../out/bridge/epicReorderSafety');

// Architect bounce #1 (backlog/evidence/BL-572-architect-bounce1-20260726.md)
// found that value-pair assertions ("selected ends with a lower value than
// its neighbour") stayed green while the mover silently teleported many
// positions, because priority is only a partial order key (ties break by
// id) and the old implementation derived writes from raw values instead of
// from position. These helpers apply a move's writes and re-derive the
// resulting FULL LIST INDEX, so every test below can assert on the thing
// that actually matters: does the selected epic move by exactly one
// position, and does every untouched epic keep its exact relative order.

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

// Asserts the full-list-index property from the evidence: the selected epic
// moves by exactly `expectedShift` positions, and every epic NOT named in
// the write set keeps its exact relative order to every other untouched
// epic (an id-ordered subsequence comparison, not just "still present").
function assertPositionShift(before, selectedId, direction, expectedShift) {
  const beforeOrder = before.map((e) => e.id);
  const beforeIndex = indexOf(before, selectedId);
  const result = computeEpicReorder(before, selectedId, direction);
  assert.notEqual(result, null, 'expected a move, got a no-op');
  assert.ok(result.writes.length <= 2, `expected at most 2 writes, got ${result.writes.length}`);

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

test('computeEpicReorder: moving a mid-list epic up swaps its priority with its neighbour above', () => {
  const epics = [
    { id: 'BL-001', priority: 10 },
    { id: 'BL-002', priority: 20 },
    { id: 'BL-003', priority: 30 },
  ];
  const result = computeEpicReorder(epics, 'BL-002', 'up');
  assert.notEqual(result, null);
  assert.deepEqual(
    result.writes.sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: 'BL-001', priority: 20 },
      { id: 'BL-002', priority: 10 },
    ]
  );
});

test('computeEpicReorder: moving a mid-list epic down swaps its priority with its neighbour below', () => {
  const epics = [
    { id: 'BL-001', priority: 10 },
    { id: 'BL-002', priority: 20 },
    { id: 'BL-003', priority: 30 },
  ];
  const result = computeEpicReorder(epics, 'BL-002', 'down');
  assert.notEqual(result, null);
  assert.deepEqual(
    result.writes.sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: 'BL-002', priority: 30 },
      { id: 'BL-003', priority: 20 },
    ]
  );
});

test('computeEpicReorder: moving the first epic up is a no-op (already at the top)', () => {
  const epics = [
    { id: 'BL-001', priority: 10 },
    { id: 'BL-002', priority: 20 },
  ];
  assert.equal(computeEpicReorder(epics, 'BL-001', 'up'), null);
});

test('computeEpicReorder: moving the last epic down is a no-op (already at the bottom)', () => {
  const epics = [
    { id: 'BL-001', priority: 10 },
    { id: 'BL-002', priority: 20 },
  ];
  assert.equal(computeEpicReorder(epics, 'BL-002', 'down'), null);
});

test('computeEpicReorder: an unknown selected id is a no-op', () => {
  const epics = [
    { id: 'BL-001', priority: 10 },
    { id: 'BL-002', priority: 20 },
  ];
  assert.equal(computeEpicReorder(epics, 'BL-999', 'up'), null);
});

test('computeEpicReorder: a single-item list is always a no-op', () => {
  const epics = [{ id: 'BL-001', priority: 10 }];
  assert.equal(computeEpicReorder(epics, 'BL-001', 'up'), null);
  assert.equal(computeEpicReorder(epics, 'BL-001', 'down'), null);
});

test('computeEpicReorder: tied priorities moving up still produces a strict ordering', () => {
  const epics = [
    { id: 'BL-001', priority: 20 },
    { id: 'BL-002', priority: 20 },
  ];
  const result = computeEpicReorder(epics, 'BL-002', 'up');
  assert.notEqual(result, null);
  const after = new Map(applyWrites(epics, result.writes).map((e) => [e.id, e.priority]));
  assert.ok(after.get('BL-002') < after.get('BL-001'));
});

test('computeEpicReorder: tied priorities moving down still produces a strict ordering', () => {
  const epics = [
    { id: 'BL-001', priority: 20 },
    { id: 'BL-002', priority: 20 },
  ];
  const result = computeEpicReorder(epics, 'BL-001', 'down');
  assert.notEqual(result, null);
  const after = new Map(applyWrites(epics, result.writes).map((e) => [e.id, e.priority]));
  assert.ok(after.get('BL-001') > after.get('BL-002'));
});

test('computeEpicReorder: never modifies any epic other than the selected one and its immediate neighbour', () => {
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
// backlog/evidence/BL-572-architect-bounce1-20260726.md: value-pair
// assertions passed while the mover jumped many positions. Each of these
// reproduces one of the three cited sites (or a closely related one) and
// asserts on the resulting FULL LIST index, not a value pair.

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
  // BL-200 (untouched, tied with the mover's old value) must not appear in
  // the write set at all - this is the exact defect site 3 named.
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

test('computeEpicReorder: refuses a move it cannot perform without breaking the floor or touching a third file', () => {
  // Three epics tied at the priority floor (0): moving the first one down
  // would require its new neighbour relationship with the untouched third
  // epic to hold at a value below 0, which the floor forbids. Refusing
  // (null, same as a boundary no-op) is correct here - silently writing a
  // negative priority or touching the third epic would reproduce exactly
  // the class of defect architect bounce #1 found.
  const allTiedAtFloor = [
    { id: 'BL-001', priority: 0 },
    { id: 'BL-002', priority: 0 },
    { id: 'BL-003', priority: 0 },
  ];
  const sorted = sortEpicsByPriority(allTiedAtFloor);
  assert.equal(computeEpicReorder(sorted, 'BL-001', 'down'), null);
});

test('computeEpicReorder: never produces a negative priority', () => {
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

// --- Exact-value pins for the internal boundary helpers --------------------
// The tests above assert on the position/ordering invariant, which several
// boundary comparisons inside lowerLimit/upperLimit/resolveOverlappingSlots
// can get wrong while still landing on a position-equivalent outcome (e.g.
// swapping in 6 instead of 5 still sorts in the same slot). These pin the
// exact `writes` values computeEpicReorder returns for hand-picked windows
// that make each boundary comparison load-bearing, so a flipped or
// off-by-one comparison shows up as a wrong number, not just a possibly-
// coincidentally-still-correct order.

test('lowerLimit: the low-slot resident may tie with a lower-id predecessor', () => {
  // beforeEpic (BL-100) ties in priority with lowEpic; beforeEpic's id
  // sorts first, so highEpic is allowed to land on that same value without
  // displacing beforeEpic. A floor of priority+1 here (the wrong branch)
  // would land highEpic one higher than expected.
  const epics = [
    { id: 'BL-100', priority: 5 },
    { id: 'BL-101', priority: 5 },
    { id: 'BL-999', priority: 10 },
  ];
  const result = computeEpicReorder(epics, 'BL-999', 'up');
  const writesById = Object.fromEntries(result.writes.map((w) => [w.id, w.priority]));
  assert.deepEqual(writesById, { 'BL-999': 5, 'BL-101': 10 });
});

test('upperLimit: the high-slot resident may tie with a higher-id successor', () => {
  // afterEpic (BL-030) ties in priority with highEpic; lowEpic's id sorts
  // before afterEpic's, so lowEpic is allowed to land on that same value.
  const epics = [
    { id: 'BL-010', priority: 5 },
    { id: 'BL-020', priority: 10 },
    { id: 'BL-030', priority: 10 },
  ];
  const result = computeEpicReorder(epics, 'BL-020', 'up');
  const writesById = Object.fromEntries(result.writes.map((w) => [w.id, w.priority]));
  assert.deepEqual(writesById, { 'BL-020': 5, 'BL-010': 10 });
});

test('upperLimit: a higher-id low-slot resident must stay strictly below its successor', () => {
  // Same shape, but lowEpic's id now sorts AFTER afterEpic's: a tie would
  // put lowEpic ahead of afterEpic on the id tie-break, so lowEpic must
  // land one below afterEpic's value instead of tying with it.
  const epics = [
    { id: 'BL-999', priority: 5 },
    { id: 'BL-005', priority: 10 },
    { id: 'BL-010', priority: 10 },
  ];
  const result = computeEpicReorder(epics, 'BL-005', 'up');
  const writesById = Object.fromEntries(result.writes.map((w) => [w.id, w.priority]));
  assert.deepEqual(writesById, { 'BL-005': 5, 'BL-999': 9 });
});

test('computeSlotValues: a generous ceiling still only bumps the low slot up by one', () => {
  // ceiling sits well above the tied pair's value: the swap collapses to a
  // tie (low === high), so the resolver must free room on the high side by
  // exactly one rather than jumping all the way to the ceiling.
  const epics = [
    { id: 'BL-100', priority: 10 },
    { id: 'BL-200', priority: 10 },
    { id: 'BL-999', priority: 15 },
  ];
  const result = computeEpicReorder(epics, 'BL-200', 'up');
  const writesById = Object.fromEntries(result.writes.map((w) => [w.id, w.priority]));
  assert.deepEqual(writesById, { 'BL-100': 11 });
});

test('computeSlotValues: a ceiling exactly one above the tied pair still resolves inside it', () => {
  // ceiling == low + 1 exactly: the boundary comparison must be inclusive
  // (<=), not strict (<), or this collapses to the floor-side fallback.
  const epics = [
    { id: 'BL-100', priority: 10 },
    { id: 'BL-200', priority: 10 },
    { id: 'BL-999', priority: 11 },
  ];
  const result = computeEpicReorder(epics, 'BL-200', 'up');
  const writesById = Object.fromEntries(result.writes.map((w) => [w.id, w.priority]));
  assert.deepEqual(writesById, { 'BL-100': 11 });
});

test('computeSlotValues: a ceiling flush with the tied pair falls back to the high side', () => {
  // ceiling == low exactly (no room above): the resolver must fall back to
  // freeing room below high instead of wrongly reporting room above.
  const epics = [
    { id: 'BL-100', priority: 10 },
    { id: 'BL-200', priority: 10 },
    { id: 'BL-999', priority: 10 },
  ];
  const result = computeEpicReorder(epics, 'BL-200', 'up');
  const writesById = Object.fromEntries(result.writes.map((w) => [w.id, w.priority]));
  assert.deepEqual(writesById, { 'BL-200': 9 });
});

test('resolveOverlappingSlots: a beforeEpic close to the tied pair still lands one below it, not at the tied pair itself', () => {
  // beforeEpic pins floor to 19, one below the tied pair's own value (20),
  // with no ceiling room: the high-side fallback must land at high - 1
  // (19), not at high itself or at some other off-by-one value.
  const epics = [
    { id: 'BL-050', priority: 19 },
    { id: 'BL-100', priority: 20 },
    { id: 'BL-200', priority: 20 },
    { id: 'BL-300', priority: 20 },
  ];
  const result = computeEpicReorder(epics, 'BL-200', 'up');
  const writesById = Object.fromEntries(result.writes.map((w) => [w.id, w.priority]));
  assert.deepEqual(writesById, { 'BL-200': 19 });
});

test('findMoveWindow: an unknown selected id going down does not fall through to the neighbour guard', () => {
  // 'up' on an unknown id happens to also fail the neighbour-index guard,
  // which can mask a broken not-found check. 'down' does not: neighborIndex
  // lands in range, so only the not-found guard itself can catch it.
  const epics = [
    { id: 'BL-001', priority: 10 },
    { id: 'BL-002', priority: 20 },
  ];
  assert.equal(computeEpicReorder(epics, 'BL-999', 'down'), null);
});

test('buildSwapWrites: the low-slot resident is omitted when its resolved value already matches', () => {
  // Same three-way-tie shape as the floor-fallback case above, read from the
  // other side: the high-slot resident's resolved value (5) already equals
  // its own prior priority, so it must be omitted from writes entirely -
  // not merely written with an unchanged value.
  const epics = [
    { id: 'BL-100', priority: 5 },
    { id: 'BL-200', priority: 5 },
    { id: 'BL-300', priority: 5 },
  ];
  const result = computeEpicReorder(epics, 'BL-200', 'up');
  const writesById = Object.fromEntries(result.writes.map((w) => [w.id, w.priority]));
  assert.deepEqual(writesById, { 'BL-200': 4 });
});
