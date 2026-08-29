'use strict';

const assert = require('node:assert/strict');
const {
  HOST_ACTIVITY_FEED_BOUND,
  beginHostActivitySession,
  endHostActivitySession,
  recordHostActivityLine,
  readHostActivityFeed,
  subscribeHostActivity,
  __setHostActivityAppendHookForTests,
  __resetHostActivityFeedForTests,
} = require('../out/bridge/hostActivityFeed');

// BL-1220: node:test hangs beforeEach off `test`; Vitest provides it as its
// own global, so the binding moves with the import that declared it.
beforeEach(() => {
  __resetHostActivityFeedForTests();
});

test('quiet when no session', () => {
  assert.deepEqual(readHostActivityFeed(), { status: 'quiet' });
});

test('records only emitted lines and never invents', () => {
  beginHostActivitySession('s1');
  recordHostActivityLine('🔧 grep');
  recordHostActivityLine('✓ grep');
  const feed = readHostActivityFeed();
  assert.equal(feed.status, 'active');
  assert.deepEqual(feed.lines, ['🔧 grep', '✓ grep']);
});

test('bound evicts oldest first', () => {
  beginHostActivitySession('s1');
  for (let i = 0; i < HOST_ACTIVITY_FEED_BOUND + 5; i += 1) {
    recordHostActivityLine(`line-${i}`);
  }
  const feed = readHostActivityFeed();
  assert.equal(feed.lines.length, HOST_ACTIVITY_FEED_BOUND);
  assert.equal(feed.lines[0], 'line-5');
  assert.equal(feed.lines[feed.lines.length - 1], `line-${HOST_ACTIVITY_FEED_BOUND + 4}`);
});

test('subscribe receives live lines', () => {
  beginHostActivitySession('s1');
  const seen = [];
  const unsub = subscribeHostActivity((p) => seen.push(p.line));
  recordHostActivityLine('a');
  recordHostActivityLine('b');
  unsub();
  recordHostActivityLine('c');
  assert.deepEqual(seen, ['a', 'b']);
});

test('append failure does not throw to caller', () => {
  beginHostActivitySession('s1');
  __setHostActivityAppendHookForTests(() => {
    throw new Error('disk full');
  });
  assert.doesNotThrow(() => recordHostActivityLine('x'));
  assert.deepEqual(readHostActivityFeed().lines, []);
});

test('end session returns quiet', () => {
  beginHostActivitySession('s1');
  recordHostActivityLine('x');
  endHostActivitySession();
  assert.deepEqual(readHostActivityFeed(), { status: 'quiet' });
});
