const assert = require('node:assert/strict');
const { syncTopicIcon } = require('../out/concierge/topicIconSync');

function fakeAdapters(overrides = {}) {
  return {
    getIconStickers: async () => [
      { emoji: '✅', customEmojiId: 'id-check' },
      { emoji: '🦠', customEmojiId: 'id-microbe' },
      { emoji: '💡', customEmojiId: 'id-bulb' },
      { emoji: '🔍', customEmojiId: 'id-magnifier' },
    ],
    setTopicIcon: async () => true,
    readSwarmIconId: () => undefined,
    recordSwarmIconId: () => {},
    ...overrides,
  };
}

// ── BL-342 scenario 01: a brand-new topic is always free to set its icon ──

test('syncTopicIcon sets the icon on a brand-new topic and records ownership', async () => {
  const setCalls = [];
  const recordCalls = [];
  const outcome = await syncTopicIcon(
    'BL-900',
    42,
    '💡',
    true,
    fakeAdapters({
      setTopicIcon: async (topicId, iconId) => {
        setCalls.push({ topicId, iconId });
        return true;
      },
      recordSwarmIconId: (ticketId, iconId) => recordCalls.push({ ticketId, iconId }),
    })
  );

  assert.equal(outcome, 'updated');
  assert.deepEqual(setCalls, [{ topicId: 42, iconId: 'id-bulb' }]);
  assert.deepEqual(recordCalls, [{ ticketId: 'BL-900', iconId: 'id-bulb' }]);
});

// ── BL-342 scenario 02/03: an EXISTING topic the swarm already owns updates
//    freely, even when its topic is closed (syncTopicIcon has no closed/
//    open concept at all - editForumTopic itself is what tolerates a
//    closed topic, verified at the client layer) ──────────────────────────

test('syncTopicIcon updates an existing topic\'s icon when the swarm already owns it', async () => {
  const outcome = await syncTopicIcon('BL-900', 42, '✅', false, fakeAdapters({ readSwarmIconId: () => 'id-bulb' }));
  assert.equal(outcome, 'updated');
});

// ── BL-342 scenario 04/05: never touch an icon the swarm did not set ──────

test('syncTopicIcon skips an existing topic whose icon was set by a human (no swarm marker)', async () => {
  const setCalls = [];
  const outcome = await syncTopicIcon(
    'BL-900',
    42,
    '✅',
    false,
    fakeAdapters({
      readSwarmIconId: () => undefined,
      setTopicIcon: async (...args) => {
        setCalls.push(args);
        return true;
      },
    })
  );
  assert.equal(outcome, 'skipped-not-owned');
  assert.deepEqual(setCalls, [], 'expected setTopicIcon to never be called for an icon the swarm does not own');
});

test('syncTopicIcon skips an existing topic of unknown icon origin identically to a human-set one', async () => {
  // Same code path as the human-set case above - "no marker" resolves the
  // same way regardless of WHY the marker is absent.
  const outcome = await syncTopicIcon('BL-900', 42, '✅', false, fakeAdapters({ readSwarmIconId: () => undefined }));
  assert.equal(outcome, 'skipped-not-owned');
});

// ── BL-342 scenario 06: icon ids are validated against the real set ───────

test('syncTopicIcon never calls setTopicIcon with an emoji absent from the fetched sticker set', async () => {
  const setCalls = [];
  const outcome = await syncTopicIcon(
    'BL-900',
    42,
    '🏆',
    true,
    fakeAdapters({
      setTopicIcon: async (...args) => {
        setCalls.push(args);
        return true;
      },
    })
  );
  assert.equal(outcome, 'skipped-unresolved-icon');
  assert.deepEqual(setCalls, []);
});

// ── failure path ────────────────────────────────────────────────────────

test('syncTopicIcon reports failure and does NOT record ownership when setTopicIcon itself fails', async () => {
  const recordCalls = [];
  const outcome = await syncTopicIcon(
    'BL-900',
    42,
    '✅',
    true,
    fakeAdapters({
      setTopicIcon: async () => false,
      recordSwarmIconId: (...args) => recordCalls.push(args),
    })
  );
  assert.equal(outcome, 'failed');
  assert.deepEqual(recordCalls, [], 'expected no ownership recorded for a failed set - the swarm never actually got to set it');
});
