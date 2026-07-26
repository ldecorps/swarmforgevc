const assert = require('node:assert/strict');
const { computeMakeTopPriority } = require('../out/bridge/makeTopPrioritySafety');
const { sortEpicsByPriority } = require('../out/bridge/epicReorderSafety');

// BL-673: computeMakeTopPriority generalized with an optional peer-scoped
// dominationSet (BL-672 left it defaulted to the whole live set). These
// tests mirror the 8 Gherkin scenarios in
// specs/features/BL-673-topic-make-top-priority.feature - global dependency
// resolution, but the "must rank above" requirement scoped to the target's
// own epic's live topics, never the whole backlog.

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

// Background: epic EA has A1,A2,A3 at 1,4,6; epic EB has B1,B2 at 2,5.
// Global sorted order: A1(1), B1(2), A2(4), B2(5), A3(6) - EA and EB
// topics are interleaved, not grouped, in the global list.
function backgroundItems(extra = {}) {
  const base = [
    { id: 'A1', priority: 1, epic: 'EA', dependsOn: [] },
    { id: 'A2', priority: 4, epic: 'EA', dependsOn: [] },
    { id: 'A3', priority: 6, epic: 'EA', dependsOn: [] },
    { id: 'B1', priority: 2, epic: 'EB', dependsOn: [] },
    { id: 'B2', priority: 5, epic: 'EB', dependsOn: [] },
  ];
  return sortEpicsByPriority(base.map((i) => (extra[i.id] ? { ...i, ...extra[i.id] } : i)));
}

function peersOfEpic(items, epic, excludeId) {
  return items.filter((i) => i.epic === epic && i.id !== excludeId);
}

test('BL-673-01: a dependency-free topic becomes the strict top of its own epic peers only', () => {
  const before = backgroundItems();
  const peers = peersOfEpic(before, 'EA', 'A3');
  const result = computeMakeTopPriority(before, 'A3', neverResolves, peers, "epic EA's live topics");
  assert.equal(result.changed, true);
  const after = apply(before, result.writes);
  const a3Priority = after.find((i) => i.id === 'A3').priority;
  for (const id of ['A1', 'A2']) {
    assert.ok(a3Priority < after.find((i) => i.id === id).priority, `expected A3 to rank before ${id}`);
  }
});

test('BL-673-02: a within-epic move never reshuffles other epics topics relative order', () => {
  const before = backgroundItems();
  const peers = peersOfEpic(before, 'EA', 'A3');
  const result = computeMakeTopPriority(before, 'A3', neverResolves, peers, "epic EA's live topics");
  const after = apply(before, result.writes);
  const others = ['A1', 'A2', 'B1', 'B2'];
  assert.deepEqual(
    after.filter((i) => others.includes(i.id)).map((i) => i.id),
    before.filter((i) => others.includes(i.id)).map((i) => i.id)
  );
});

test('BL-673-03: a better-ranked live dependency (also a peer) bounds the move below itself', () => {
  const before = backgroundItems({ A3: { dependsOn: ['A1'] } });
  const peers = peersOfEpic(before, 'EA', 'A3');
  const result = computeMakeTopPriority(before, 'A3', neverResolves, peers, "epic EA's live topics");
  assert.equal(result.changed, true);
  assert.match(result.reason, /A1/);
  const after = apply(before, result.writes);
  const a1Index = after.findIndex((i) => i.id === 'A1');
  const a3Index = after.findIndex((i) => i.id === 'A3');
  assert.equal(a3Index, a1Index + 1, 'expected A3 immediately after A1');
});

test('BL-673-04: a cross-epic live dependency ranked worse refuses the move', () => {
  const before = backgroundItems({ A3: { dependsOn: ['B2'] } });
  const peers = peersOfEpic(before, 'EA', 'A3');
  const beforeA3 = before.find((i) => i.id === 'A3').priority;
  const result = computeMakeTopPriority(before, 'A3', neverResolves, peers, "epic EA's live topics");
  assert.equal(result.changed, false);
  assert.deepEqual(result.writes, []);
  assert.match(result.reason, /B2/);
  assert.equal(before.find((i) => i.id === 'A3').priority, beforeA3, 'input must never be mutated');
});

test('BL-673-05a: a cyclic depends_on chain refuses fail-closed', () => {
  const before = backgroundItems({ A3: { dependsOn: ['A4'] } });
  const withA4 = sortEpicsByPriority([...before, { id: 'A4', priority: 0, epic: 'EA', dependsOn: ['A3'] }]);
  const peers = peersOfEpic(withA4, 'EA', 'A3');
  const result = computeMakeTopPriority(withA4, 'A3', neverResolves, peers, "epic EA's live topics");
  assert.equal(result.changed, false);
  assert.match(result.reason, /cycle/);
});

test('BL-673-05b: a dangling depends_on id refuses fail-closed', () => {
  const before = backgroundItems({ A3: { dependsOn: ['GHOST-1'] } });
  const peers = peersOfEpic(before, 'EA', 'A3');
  const result = computeMakeTopPriority(before, 'A3', neverResolves, peers, "epic EA's live topics");
  assert.equal(result.changed, false);
  assert.match(result.reason, /GHOST-1/);
});

test('BL-673-06: done and active dependencies neither bound nor refuse the move', () => {
  const before = backgroundItems({ A3: { dependsOn: ['DONE-1', 'ACTIVE-1'] } });
  const peers = peersOfEpic(before, 'EA', 'A3');
  const resolve = (id) => (id === 'DONE-1' ? 'done' : id === 'ACTIVE-1' ? 'active' : 'unknown');
  const result = computeMakeTopPriority(before, 'A3', resolve, peers, "epic EA's live topics");
  assert.equal(result.changed, true);
  const after = apply(before, result.writes);
  const a3Priority = after.find((i) => i.id === 'A3').priority;
  for (const id of ['A1', 'A2']) {
    assert.ok(a3Priority < after.find((i) => i.id === id).priority);
  }
});

test('BL-673-08: re-applying to a topic already in its best permitted slot is a no-op with a reason', () => {
  const before = backgroundItems();
  const peers = peersOfEpic(before, 'EA', 'A3');
  const first = computeMakeTopPriority(before, 'A3', neverResolves, peers, "epic EA's live topics");
  const top = apply(before, first.writes);
  const peersAfter = peersOfEpic(top, 'EA', 'A3');
  const second = computeMakeTopPriority(top, 'A3', neverResolves, peersAfter, "epic EA's live topics");
  assert.equal(second.changed, false);
  assert.deepEqual(second.writes, []);
  assert.equal(typeof second.reason, 'string');
  assert.ok(second.reason.length > 0);
});

test('BL-673: a foreign (different-epic) item interleaved between peers is never treated as a blocker', () => {
  // Global order: A1(1), B1(2), A2(4), B2(5), A3(6). A3 (no deps) must
  // overtake ONLY A1 and A2 - B1/B2 are neither peers nor dependencies, so
  // whether A3 ends up before or after them is unconstrained, but A3 must
  // land strictly before A1 (the best-ranked EA peer), even though B1 sits
  // between them in the global order today.
  const before = backgroundItems();
  const peers = peersOfEpic(before, 'EA', 'A3');
  const result = computeMakeTopPriority(before, 'A3', neverResolves, peers, "epic EA's live topics");
  assert.equal(result.changed, true);
  const after = apply(before, result.writes);
  const a3Index = after.findIndex((i) => i.id === 'A3');
  const a1Index = after.findIndex((i) => i.id === 'A1');
  assert.ok(a3Index < a1Index, 'expected A3 to rank before A1 despite B1/B2 sitting between them originally');
});

test('BL-673: target already dominating its peers (with a foreign item ranked better) is recognized as a no-op', () => {
  // Foreign X ranks better than everyone; A3 already ranks better than its
  // own peers A1/A2 despite X sitting ahead of it globally - X is neither a
  // peer nor a dependency, so it must not block the "already best" verdict.
  const items = sortEpicsByPriority([
    { id: 'X', priority: 0, epic: 'EX', dependsOn: [] },
    { id: 'A3', priority: 1, epic: 'EA', dependsOn: [] },
    { id: 'A1', priority: 2, epic: 'EA', dependsOn: [] },
    { id: 'A2', priority: 3, epic: 'EA', dependsOn: [] },
  ]);
  const peers = peersOfEpic(items, 'EA', 'A3');
  const result = computeMakeTopPriority(items, 'A3', neverResolves, peers, "epic EA's live topics");
  assert.equal(result.changed, false);
  assert.deepEqual(result.writes, []);
});

test('BL-673: default dominationSet (unspecified) preserves BL-672 whole-backlog behavior exactly', () => {
  const before = backgroundItems();
  const result = computeMakeTopPriority(before, 'A3', neverResolves);
  assert.equal(result.changed, true);
  const after = apply(before, result.writes);
  assert.equal(after[0].id, 'A3', 'with no dominationSet argument, make-top must still mean top of the WHOLE backlog');
});
