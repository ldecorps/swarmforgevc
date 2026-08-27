const assert = require('node:assert/strict');
const { syncTopicTitle } = require('../out/concierge/topicTitleSync');

const HOUR_MS = 60 * 60 * 1000;

function fakeAdapters(overrides = {}) {
  return {
    readLastActivityMs: () => 0,
    setTopicTitle: async () => true,
    ...overrides,
  };
}

test('syncTopicTitle updates the title once on a bucket transition and reports the new bucket', async () => {
  const setCalls = [];
  const result = await syncTopicTitle(
    'BL-900',
    42,
    'BL-900 a fine feature',
    3 * HOUR_MS,
    'fresh',
    fakeAdapters({
      setTopicTitle: async (topicId, title) => {
        setCalls.push({ topicId, title });
        return true;
      },
    })
  );

  assert.equal(result.outcome, 'updated');
  assert.equal(result.bucket, 'hours');
  assert.deepEqual(setCalls, [{ topicId: 42, title: 'BL-900 a fine feature · 3h ago' }]);
});

test('syncTopicTitle skips a ticket with no recorded activity yet, leaving prevBucket untouched', async () => {
  const setCalls = [];
  const result = await syncTopicTitle(
    'BL-900',
    42,
    'BL-900 a fine feature',
    3 * HOUR_MS,
    undefined,
    fakeAdapters({
      readLastActivityMs: () => undefined,
      setTopicTitle: async (...args) => {
        setCalls.push(args);
        return true;
      },
    })
  );

  assert.equal(result.outcome, 'skipped-no-activity');
  assert.equal(result.bucket, undefined);
  assert.deepEqual(setCalls, []);
});

test('syncTopicTitle does not call setTopicTitle when the bucket is unchanged', async () => {
  const setCalls = [];
  const result = await syncTopicTitle(
    'BL-900',
    42,
    'BL-900 a fine feature',
    5 * HOUR_MS,
    'hours',
    fakeAdapters({
      readLastActivityMs: () => 0,
      setTopicTitle: async (...args) => {
        setCalls.push(args);
        return true;
      },
    })
  );

  assert.equal(result.outcome, 'skipped-unchanged-bucket');
  assert.equal(result.bucket, 'hours');
  assert.deepEqual(setCalls, []);
});

test('syncTopicTitle reports failure and leaves the persisted bucket at prevBucket when setTopicTitle itself fails', async () => {
  const result = await syncTopicTitle(
    'BL-900',
    42,
    'BL-900 a fine feature',
    3 * HOUR_MS,
    'fresh',
    fakeAdapters({
      readLastActivityMs: () => 0,
      setTopicTitle: async () => false,
    })
  );

  assert.equal(result.outcome, 'failed');
  assert.equal(result.bucket, 'fresh', 'expected the persisted bucket to stay at prevBucket so the next tick retries');
});
