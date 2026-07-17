const assert = require('node:assert/strict');
const { reconstructionHeaderText, decideTopicRestore, recreateFoldTopic } = require('../out/concierge/topicRecreation');

// BL-332/BL-495: repairs a ticket's Telegram topic when it has genuinely
// gone. BL-495 (topic-consolidation epic): post-BL-493 there is no
// per-ticket topic anymore - the repair path targets a ticket's FOLD
// target (its epic's topic, or the standing Backlog topic), never
// resurrecting the retired per-ticket model.

// ── reconstructionHeaderText (pure) ──────────────────────────────────────

test('recreate-topic-02: the reconstruction header names the rebuild date and explicitly says it is NOT the original conversation', () => {
  const text = reconstructionHeaderText(Date.parse('2026-07-14T09:00:00Z'));
  assert.match(text, /2026-07-14/);
  assert.match(text, /reconstructed/i);
  assert.match(text, /not the original/i);
});

// ── decideTopicRestore (pure) ─────────────────────────────────────────────

test('topic-recreation-epic-aware-01: a fold target still mapped (closed, never deleted) prefers the cheap, high-fidelity reopen path', () => {
  assert.deepEqual(decideTopicRestore(42), { action: 'reopen', topicId: 42 });
});

test('topic-recreation-epic-aware-01: a fold target with no mapping at all (genuinely deleted) falls back to recreate', () => {
  assert.deepEqual(decideTopicRestore(undefined), { action: 'recreate' });
});

// ── recreateFoldTopic (adapter-injected) ─────────────────────────────────

function fakeAdapters(overrides = {}) {
  const posted = [];
  const recorded = [];
  return {
    posted,
    recorded,
    adapters: {
      createTopic: async () => 555,
      postMessage: async (topicId, text) => {
        posted.push({ topicId, text });
        return true;
      },
      recordTopicId: (topicId) => {
        recorded.push(topicId);
      },
      ...overrides,
    },
  };
}

test('recreateFoldTopic creates a fresh topic under the given name and posts only the reconstruction header - no per-ticket history replay', async () => {
  const { posted, adapters } = fakeAdapters();
  const result = await recreateFoldTopic('EPIC — a fine initiative', adapters, Date.parse('2026-07-14T00:00:00Z'));
  assert.equal(result.success, true);
  assert.equal(result.topicId, 555);
  assert.equal(posted.length, 1, 'expected only the reconstruction header, never a per-ticket message replay');
  assert.match(posted[0].text, /reconstructed/i);
  assert.equal(posted[0].topicId, 555);
});

test('recreateFoldTopic passes the exact name through to createTopic - the caller decides epic vs Backlog naming', async () => {
  const names = [];
  const { adapters } = fakeAdapters({
    createTopic: async (name) => {
      names.push(name);
      return 555;
    },
  });
  await recreateFoldTopic('Backlog', adapters, 0);
  assert.deepEqual(names, ['Backlog']);
});

test('recreateFoldTopic records the new topic id on success', async () => {
  const { recorded, adapters } = fakeAdapters();
  await recreateFoldTopic('Backlog', adapters, 0);
  assert.deepEqual(recorded, [555]);
});

test('a failed topic creation is a clean no-op: no message posted, nothing recorded', async () => {
  const { posted, recorded, adapters } = fakeAdapters({ createTopic: async () => undefined });
  const result = await recreateFoldTopic('Backlog', adapters, 0);
  assert.equal(result.success, false);
  assert.equal(posted.length, 0);
  assert.equal(recorded.length, 0);
});

test('a header postMessage failure fails the whole recreate and never records the mapping', async () => {
  const { recorded, adapters } = fakeAdapters({ postMessage: async () => false });
  const result = await recreateFoldTopic('Backlog', adapters, 0);
  assert.equal(result.success, false);
  assert.equal(result.topicId, 555, 'the created topic id is still reported even on a failed post, so the caller can diagnose');
  assert.equal(recorded.length, 0);
});
