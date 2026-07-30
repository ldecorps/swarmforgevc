const assert = require('node:assert/strict');
const { epicIdsForSlug, computeEpicTopics, resolveTopicMembership } = require('../out/bridge/epicTopicSlugMatch');

// BL-686 hardening: direct unit coverage for the pure slug-matching core.
// epicTopicSlugMatch.property.test.js proves the two declared invariants
// hold across generated inputs, but property tests are excluded from the
// mutation/coverage/CRAP commands (engineering.prompt separation rule), so
// resolveTopicMembership's peers filter had no example-based test isolating
// each of its three independent predicates (type !== 'epic', epic match,
// id !== topicId) - Stryker's dry run showed 18 survivors all on that one
// filter/return, killed by these fixed-fixture cases below.

test('epicIdsForSlug: undefined slug returns [] directly, short-circuiting before any epic is examined', () => {
  // An epic ticket with its own `epic` field undefined would, absent the
  // early return, equality-match an undefined `slug` in the filter below -
  // this fixture is what actually distinguishes "short-circuit before
  // filtering" from "fall through and filter anyway" (both happen to
  // return [] against an epics list with no undefined-epic rows).
  const epics = [
    { id: 'EPIC-A', epic: undefined },
    { id: 'EPIC-B', epic: 'slug-x' },
  ];
  assert.deepEqual(epicIdsForSlug(epics, undefined), []);
  assert.deepEqual(epicIdsForSlug(epics, ''), []);
});

test('epicIdsForSlug: a defined slug matches every epic ticket declaring it, in order, ids only', () => {
  const epics = [
    { id: 'EPIC-A', epic: 'slug-x' },
    { id: 'EPIC-B', epic: 'slug-y' },
    { id: 'EPIC-C', epic: 'slug-x' },
  ];
  assert.deepEqual(epicIdsForSlug(epics, 'slug-x'), ['EPIC-A', 'EPIC-C']);
});

test('computeEpicTopics: an item without an epic slug is excluded from topics entirely', () => {
  const epics = [{ id: 'EPIC-A', epic: 'slug-x' }];
  assert.deepEqual(computeEpicTopics([{ id: 'T1', type: 'feature', epic: undefined }], epics), []);
});

test('resolveTopicMembership: unknown epicId returns null', () => {
  const epics = [{ id: 'EPIC-A', epic: 'slug-x' }];
  const liveItems = [{ id: 'T1', type: 'feature', epic: 'slug-x' }];
  assert.equal(resolveTopicMembership(liveItems, epics, 'EPIC-MISSING', 'T1'), null);
});

test('resolveTopicMembership: topicId not present among live items returns null', () => {
  const epics = [{ id: 'EPIC-A', epic: 'slug-x' }];
  const liveItems = [{ id: 'T1', type: 'feature', epic: 'slug-x' }];
  assert.equal(resolveTopicMembership(liveItems, epics, 'EPIC-A', 'T-MISSING'), null);
});

test('resolveTopicMembership: a type:epic row sharing the target slug is excluded from both target and peers', () => {
  const epics = [{ id: 'EPIC-A', epic: 'slug-x' }];
  const liveItems = [
    { id: 'T1', type: 'feature', epic: 'slug-x' },
    { id: 'EPIC-A', type: 'epic', epic: 'slug-x' },
  ];
  const result = resolveTopicMembership(liveItems, epics, 'EPIC-A', 'T1');
  assert.equal(result.target.id, 'T1');
  assert.deepEqual(
    result.peers.map((p) => p.id),
    []
  );
  // The epic tracker can never be the target either.
  assert.equal(resolveTopicMembership(liveItems, epics, 'EPIC-A', 'EPIC-A'), null);
});

test('resolveTopicMembership: an item with a non-matching epic slug is excluded from peers', () => {
  const epics = [{ id: 'EPIC-A', epic: 'slug-x' }];
  const liveItems = [
    { id: 'T1', type: 'feature', epic: 'slug-x' },
    { id: 'T2', type: 'feature', epic: 'slug-y' },
  ];
  const result = resolveTopicMembership(liveItems, epics, 'EPIC-A', 'T1');
  assert.deepEqual(
    result.peers.map((p) => p.id),
    []
  );
});

test('resolveTopicMembership: the target itself is excluded from its own peers set', () => {
  const epics = [{ id: 'EPIC-A', epic: 'slug-x' }];
  const liveItems = [
    { id: 'T1', type: 'feature', epic: 'slug-x' },
    { id: 'T2', type: 'feature', epic: 'slug-x' },
  ];
  const result = resolveTopicMembership(liveItems, epics, 'EPIC-A', 'T1');
  assert.deepEqual(
    result.peers.map((p) => p.id).sort(),
    ['T2']
  );
  assert.ok(!result.peers.some((p) => p.id === 'T1'));
});

test('resolveTopicMembership: returns the exact {target, peers} shape, not an empty object', () => {
  const epics = [{ id: 'EPIC-A', epic: 'slug-x' }];
  const liveItems = [
    { id: 'T1', type: 'feature', epic: 'slug-x' },
    { id: 'T2', type: 'feature', epic: 'slug-x' },
  ];
  const result = resolveTopicMembership(liveItems, epics, 'EPIC-A', 'T1');
  assert.deepEqual(Object.keys(result).sort(), ['peers', 'target']);
  assert.equal(result.target.id, 'T1');
  assert.equal(result.peers.length, 1);
});

test('resolveTopicMembership: a peer must satisfy type, epic, AND id conditions together, not any single one', () => {
  const epics = [{ id: 'EPIC-A', epic: 'slug-x' }];
  const liveItems = [
    { id: 'T1', type: 'feature', epic: 'slug-x' },
    // wrong type only
    { id: 'EPIC-B', type: 'epic', epic: 'slug-x' },
    // wrong epic only
    { id: 'T3', type: 'feature', epic: 'slug-y' },
    // is the target itself
    { id: 'T1-dup-check', type: 'feature', epic: 'slug-x' },
    // the genuine peer
    { id: 'T4', type: 'feature', epic: 'slug-x' },
  ];
  const result = resolveTopicMembership(liveItems, epics, 'EPIC-A', 'T1');
  assert.deepEqual(
    result.peers.map((p) => p.id).sort(),
    ['T1-dup-check', 'T4']
  );
});
