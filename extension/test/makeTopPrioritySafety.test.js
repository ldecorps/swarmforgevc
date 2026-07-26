const assert = require('node:assert/strict');
const { computeMakeTopPriority } = require('../out/bridge/makeTopPrioritySafety');
const { sortEpicsByPriority } = require('../out/bridge/epicReorderSafety');

// BL-672: unit coverage mirroring the 7 Gherkin scenarios in
// specs/features/BL-672-epic-make-top-priority.feature - each scenario here
// is the same fixture the acceptance step handlers drive against the real
// bridge, checked directly against the pure core.

function apply(items, writes) {
  const byId = new Map(items.map((i) => [i.id, i.priority]));
  for (const w of writes) {
    byId.set(w.id, w.priority);
  }
  return sortEpicsByPriority(items.map((i) => ({ ...i, priority: byId.get(i.id) })));
}

function neverResolves() {
  return 'unknown';
}

// Background: epics E1,E2,E3 at priorities 0,0,2 and topics T1,T2 at 0,5.
function backgroundItems(extra = {}) {
  return sortEpicsByPriority([
    { id: 'E1', priority: 0, dependsOn: [] },
    { id: 'E2', priority: 0, dependsOn: [] },
    { id: 'E3', priority: 2, dependsOn: [] },
    { id: 'T1', priority: 0, dependsOn: [] },
    { id: 'T2', priority: 5, dependsOn: [] },
  ].map((i) => (extra[i.id] ? { ...i, ...extra[i.id] } : i)));
}

test('BL-672-01: make-top on a dependency-free epic makes it the unique top', () => {
  const result = computeMakeTopPriority(backgroundItems(), 'E3', neverResolves);
  assert.equal(result.changed, true);
  const after = apply(backgroundItems(), result.writes);
  assert.equal(after[0].id, 'E3');
  assert.equal(after.filter((i) => i.priority === after[0].priority).length, 1, 'E3 must be the UNIQUE occupant of its priority');
});

test('BL-672-02: displaced items keep their relative order through the floor tie-run', () => {
  const before = backgroundItems();
  const result = computeMakeTopPriority(before, 'E3', neverResolves);
  const after = apply(before, result.writes);
  const others = ['E1', 'E2', 'T1', 'T2'];
  assert.deepEqual(
    after.filter((i) => others.includes(i.id)).map((i) => i.id),
    before.filter((i) => others.includes(i.id)).map((i) => i.id)
  );
});

test('BL-672-03: re-applying to an already-top epic is a no-op with a reason', () => {
  const before = backgroundItems();
  const first = computeMakeTopPriority(before, 'E3', neverResolves);
  const top = apply(before, first.writes);
  const second = computeMakeTopPriority(top, 'E3', neverResolves);
  assert.equal(second.changed, false);
  assert.deepEqual(second.writes, []);
  assert.equal(typeof second.reason, 'string');
  assert.ok(second.reason.length > 0);
});

test('BL-672-04: a live better-ranked dependency bounds the move instead of being outranked', () => {
  const before = backgroundItems({ E3: { dependsOn: ['E1'] } });
  const result = computeMakeTopPriority(before, 'E3', neverResolves);
  assert.equal(result.changed, true);
  assert.match(result.reason, /E1/, 'a bounded success must name the bounding dependency, same as a refusal would');
  const after = apply(before, result.writes);
  const e1Index = after.findIndex((i) => i.id === 'E1');
  const e3Index = after.findIndex((i) => i.id === 'E3');
  assert.equal(e3Index, e1Index + 1, 'expected E3 immediately after E1');
});

test('BL-672-05a: a live dependency ranked worse than the target refuses fail-closed', () => {
  const before = sortEpicsByPriority([
    { id: 'E1', priority: 0, dependsOn: [] },
    { id: 'E3', priority: 2, dependsOn: ['T2'] },
    { id: 'T2', priority: 5, dependsOn: [] },
  ]);
  const result = computeMakeTopPriority(before, 'E3', neverResolves);
  assert.equal(result.changed, false);
  assert.deepEqual(result.writes, []);
  assert.match(result.reason, /T2/);
});

test('BL-672-05b: a cyclic depends_on chain back to itself refuses fail-closed', () => {
  const before = sortEpicsByPriority([
    { id: 'E3', priority: 2, dependsOn: ['E4'] },
    { id: 'E4', priority: 0, dependsOn: ['E3'] },
  ]);
  const result = computeMakeTopPriority(before, 'E3', neverResolves);
  assert.equal(result.changed, false);
  assert.deepEqual(result.writes, []);
  assert.match(result.reason, /cycle/);
});

test('BL-672-05c: a depends_on id resolving to no backlog item refuses fail-closed', () => {
  const before = sortEpicsByPriority([{ id: 'E3', priority: 2, dependsOn: ['GHOST-1'] }]);
  const result = computeMakeTopPriority(before, 'E3', neverResolves);
  assert.equal(result.changed, false);
  assert.deepEqual(result.writes, []);
  assert.match(result.reason, /GHOST-1/);
});

test('BL-672-06: done and active dependencies do not bound or refuse the move', () => {
  const before = sortEpicsByPriority([
    { id: 'E1', priority: 0, dependsOn: [] },
    { id: 'E3', priority: 2, dependsOn: ['DONE-1', 'ACTIVE-1'] },
  ]);
  const resolve = (id) => (id === 'DONE-1' ? 'done' : id === 'ACTIVE-1' ? 'active' : 'unknown');
  const result = computeMakeTopPriority(before, 'E3', resolve);
  assert.equal(result.changed, true);
  const after = apply(before, result.writes);
  assert.equal(after[0].id, 'E3');
});

test('BL-672: an id not present in the live set returns null (not found)', () => {
  const result = computeMakeTopPriority(backgroundItems(), 'NOPE', neverResolves);
  assert.equal(result, null);
});

test('BL-672: an epic already immediately after its bound is a no-op naming the bound', () => {
  // E1(0), E3(1) depends_on E1 - E3 is already immediately after E1.
  const before = sortEpicsByPriority([
    { id: 'E1', priority: 0, dependsOn: [] },
    { id: 'E3', priority: 1, dependsOn: ['E1'] },
  ]);
  const result = computeMakeTopPriority(before, 'E3', neverResolves);
  assert.equal(result.changed, false);
  assert.match(result.reason, /E1/);
});

test('BL-672: transitive live dependencies are bounded by the worst-ranked one', () => {
  // E1(0) <- E2(1) <- E3(3): E3 depends on E2, E2 depends on E1. Both live,
  // both ranked better than E3, and T1 sits BETWEEN E2 and E3 so a real move
  // is required. Bound must be E2 (the closer/worse-ranked of the two),
  // landing E3 immediately after E2 - displacing T1 - not after E1.
  const before = sortEpicsByPriority([
    { id: 'E1', priority: 0, dependsOn: [] },
    { id: 'E2', priority: 1, dependsOn: ['E1'] },
    { id: 'T1', priority: 2, dependsOn: [] },
    { id: 'E3', priority: 3, dependsOn: ['E2'] },
  ]);
  const result = computeMakeTopPriority(before, 'E3', neverResolves);
  assert.equal(result.changed, true);
  const after = apply(before, result.writes);
  const e2Index = after.findIndex((i) => i.id === 'E2');
  const e3Index = after.findIndex((i) => i.id === 'E3');
  assert.equal(e3Index, e2Index + 1, 'expected E3 immediately after E2, the worst-ranked live dependency');
});

test('BL-672: a transitively (not directly) worse-ranked dependency still refuses', () => {
  // E3 depends on E2, which depends on T2 (ranked worse than E3). The
  // refusal must fire even though E3's DIRECT dependency (E2) ranks better.
  const before = sortEpicsByPriority([
    { id: 'E2', priority: 0, dependsOn: ['T2'] },
    { id: 'E3', priority: 2, dependsOn: ['E2'] },
    { id: 'T2', priority: 5, dependsOn: [] },
  ]);
  const result = computeMakeTopPriority(before, 'E3', neverResolves);
  assert.equal(result.changed, false);
  assert.match(result.reason, /T2/);
});
