const assert = require('node:assert/strict');
const { reconstructionHeaderText, renderedMessageText, decideTopicRestore, recreateTopicFromRecord } = require('../out/concierge/topicRecreation');

// BL-332: recreates a ticket's Telegram topic from its own durable
// serialised record - the slice that proves BL-331's deletion is actually
// reversible, not merely claimed to be.

function record(messages) {
  return { id: 'BL-900', messages };
}

function msg(overrides = {}) {
  return { seq: 0, ts: 1700000000000, author: 'human', type: 'inbound', text: 'hello', ...overrides };
}

// ── reconstructionHeaderText / renderedMessageText (pure) ────────────────

test('recreate-topic-02: the reconstruction header names the rebuild date and explicitly says it is NOT the original conversation', () => {
  const text = reconstructionHeaderText(Date.parse('2026-07-14T09:00:00Z'));
  assert.match(text, /2026-07-14/);
  assert.match(text, /reconstructed/i);
  assert.match(text, /not the original/i);
});

test('recreate-topic-03: a rendered message preserves its ORIGINAL author and timestamp, not the bot/now', () => {
  const m = msg({ author: 'human', ts: Date.parse('2026-01-02T03:04:05Z'), text: 'the actual words' });
  const text = renderedMessageText(m);
  assert.match(text, /human/);
  assert.match(text, /2026-01-02T03:04:05/);
  assert.match(text, /the actual words/);
});

test('renderedMessageText distinguishes swarm vs human authors', () => {
  const swarmText = renderedMessageText(msg({ author: 'swarm', text: 'a swarm message' }));
  const humanText = renderedMessageText(msg({ author: 'human', text: 'a human message' }));
  assert.match(swarmText, /swarm/);
  assert.match(humanText, /human/);
});

// ── decideTopicRestore (pure) ─────────────────────────────────────────────

test('a topic still mapped (closed, never deleted) prefers the cheap, high-fidelity reopen path', () => {
  const decision = decideTopicRestore({ 'BL-900': 42 }, 'BL-900');
  assert.deepEqual(decision, { action: 'reopen', topicId: 42 });
});

test('a topic with no mapping at all (genuinely deleted) falls back to recreate+replay', () => {
  const decision = decideTopicRestore({}, 'BL-900');
  assert.deepEqual(decision, { action: 'recreate' });
});

test('decideTopicRestore only ever looks at the ONE ticket asked about - an unrelated mapped ticket never leaks in', () => {
  const decision = decideTopicRestore({ 'BL-111': 99 }, 'BL-900');
  assert.deepEqual(decision, { action: 'recreate' });
});

// ── recreateTopicFromRecord (adapter-injected) ────────────────────────────

function fakeAdapters(rec, overrides = {}) {
  const posted = [];
  const recorded = [];
  return {
    posted,
    recorded,
    adapters: {
      readRecord: () => rec,
      createTopic: async () => 555,
      postMessage: async (topicId, text) => {
        posted.push({ topicId, text });
        return true;
      },
      recordTopicId: (id, topicId) => {
        recorded.push({ id, topicId });
      },
      ...overrides,
    },
  };
}

// recreate-topic-01: the round trip - content matches the serialised record
test('recreate-topic-01: every serialised message is replayed, in order, into the new topic', async () => {
  const rec = record([msg({ seq: 0, author: 'human', text: 'first' }), msg({ seq: 1, author: 'swarm', text: 'second' })]);
  const { posted, adapters } = fakeAdapters(rec);
  const result = await recreateTopicFromRecord('BL-900', 'a fine feature', adapters, Date.parse('2026-07-14T00:00:00Z'));
  assert.equal(result.success, true);
  assert.equal(result.topicId, 555);
  // header first, then the two messages in the record's own order
  assert.equal(posted.length, 3);
  assert.match(posted[0].text, /reconstructed/i);
  assert.match(posted[1].text, /first/);
  assert.match(posted[2].text, /second/);
  assert.ok(posted.every((p) => p.topicId === 555));
});

// recreate-topic-02
test('recreate-topic-02: the FIRST message posted into the recreated topic is the reconstruction label', async () => {
  const rec = record([msg({ text: 'whatever' })]);
  const { posted, adapters } = fakeAdapters(rec);
  await recreateTopicFromRecord('BL-900', 'a fine feature', adapters, Date.parse('2026-07-14T00:00:00Z'));
  assert.match(posted[0].text, /reconstructed/i);
});

// recreate-topic-03
test('recreate-topic-03: messages from both the swarm and the human each preserve their own original author/timestamp', async () => {
  const rec = record([
    msg({ author: 'human', ts: Date.parse('2026-01-01T00:00:00Z'), text: 'asked a question' }),
    msg({ author: 'swarm', ts: Date.parse('2026-01-01T00:05:00Z'), text: 'answered it' }),
  ]);
  const { posted, adapters } = fakeAdapters(rec);
  await recreateTopicFromRecord('BL-900', 'a fine feature', adapters, Date.parse('2026-07-14T00:00:00Z'));
  assert.match(posted[1].text, /human/);
  assert.match(posted[1].text, /2026-01-01T00:00:00/);
  assert.match(posted[2].text, /swarm/);
  assert.match(posted[2].text, /2026-01-01T00:05:00/);
});

// recreate-topic-04
test('recreate-topic-04: the new topic id is recorded so the ticket maps to it going forward', async () => {
  const rec = record([msg()]);
  const { recorded, adapters } = fakeAdapters(rec);
  await recreateTopicFromRecord('BL-900', 'a fine feature', adapters, Date.parse('2026-07-14T00:00:00Z'));
  assert.deepEqual(recorded, [{ id: 'BL-900', topicId: 555 }]);
});

// recreate-topic-05
test('recreate-topic-05: recreating reads the record via the injected adapter and never mutates the record object itself', async () => {
  const rec = record([msg({ text: 'do not touch me' })]);
  const before = JSON.stringify(rec);
  const { adapters } = fakeAdapters(rec);
  await recreateTopicFromRecord('BL-900', 'a fine feature', adapters, Date.parse('2026-07-14T00:00:00Z'));
  assert.equal(JSON.stringify(rec), before, 'the record must be left byte-identical - recreate is a pure read, never a consume/move');
});

test('a failed topic creation is a clean no-op: no messages posted, nothing recorded', async () => {
  const rec = record([msg({ text: 'never posted' })]);
  const { posted, recorded, adapters } = fakeAdapters(rec, { createTopic: async () => undefined });
  const result = await recreateTopicFromRecord('BL-900', 'a fine feature', adapters, Date.parse('2026-07-14T00:00:00Z'));
  assert.equal(result.success, false);
  assert.equal(posted.length, 0);
  assert.equal(recorded.length, 0);
});

test('an empty record still gets its reconstruction header - a topic recreated from nothing is still honestly labelled', async () => {
  const rec = record([]);
  const { posted, adapters } = fakeAdapters(rec);
  await recreateTopicFromRecord('BL-900', 'a fine feature', adapters, Date.parse('2026-07-14T00:00:00Z'));
  assert.equal(posted.length, 1);
  assert.match(posted[0].text, /reconstructed/i);
});
