const assert = require('node:assert/strict');
const { sortEpicsByPriority, computeEpicReorder } = require('../out/bridge/epicReorderSafety');

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

test('computeEpicReorder: tied priorities moving up still produces a strict ordering, writing only the mover', () => {
  const epics = [
    { id: 'BL-001', priority: 20 },
    { id: 'BL-002', priority: 20 },
  ];
  const result = computeEpicReorder(epics, 'BL-002', 'up');
  assert.notEqual(result, null);
  assert.deepEqual(result.writes, [{ id: 'BL-002', priority: 19 }]);
});

test('computeEpicReorder: tied priorities moving down still produces a strict ordering, writing only the mover', () => {
  const epics = [
    { id: 'BL-001', priority: 20 },
    { id: 'BL-002', priority: 20 },
  ];
  const result = computeEpicReorder(epics, 'BL-001', 'down');
  assert.notEqual(result, null);
  assert.deepEqual(result.writes, [{ id: 'BL-001', priority: 21 }]);
});

test('computeEpicReorder: a three-way tie moving the middle item up still ends strictly below its new neighbour above', () => {
  const epics = [
    { id: 'BL-001', priority: 20 },
    { id: 'BL-002', priority: 20 },
    { id: 'BL-003', priority: 20 },
  ];
  const result = computeEpicReorder(epics, 'BL-002', 'up');
  assert.notEqual(result, null);
  assert.deepEqual(result.writes, [{ id: 'BL-002', priority: 19 }]);
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
