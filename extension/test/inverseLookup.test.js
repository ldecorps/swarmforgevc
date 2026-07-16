const assert = require('node:assert/strict');
const { keyForId } = require('../out/util/inverseLookup');

// BL-425 cleaner pass: extracted out of topicRouter.ts's backlogForTopic and
// roleTopicMapStore.ts's roleForTopic, which had each carried the exact same
// 4-line body (jscpd-flagged clone). Both call sites keep their own coverage
// (backlogTopicRouting.test.js / roleTopicMapStore.test.js); this is the
// direct unit coverage for the shared implementation itself.

test('keyForId resolves a mapped id to its key', () => {
  assert.equal(keyForId({ coder: 42, QA: 55 }, 42), 'coder');
});

test('keyForId returns undefined for an unmapped id, never a crash', () => {
  assert.equal(keyForId({ coder: 42 }, 999), undefined);
});

test('keyForId returns undefined for an undefined id, never scanning the map', () => {
  assert.equal(keyForId({ coder: 42 }, undefined), undefined);
});

test('keyForId resolves each key to ITS OWN id, not another key\'s, when several are mapped', () => {
  const map = { coder: 42, cleaner: 43, QA: 44 };
  assert.equal(keyForId(map, 42), 'coder');
  assert.equal(keyForId(map, 43), 'cleaner');
  assert.equal(keyForId(map, 44), 'QA');
});

test('keyForId returns undefined for an empty map', () => {
  assert.equal(keyForId({}, 1), undefined);
});
