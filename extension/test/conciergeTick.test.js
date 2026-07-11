const assert = require('node:assert/strict');
const { runConciergeTick } = require('../out/concierge/conciergeTick');

function folders(overrides = {}) {
  return { active: [], paused: [], done: [], ...overrides };
}

function fakeAdapters(overrides = {}) {
  const state = { snapshot: null, emittedKeys: [] };
  const topicMap = {};
  const created = [];
  const sent = [];
  const closed = [];
  let currentFolders = folders();
  return {
    state,
    topicMap,
    created,
    sent,
    closed,
    setFolders: (f) => {
      currentFolders = f;
    },
    adapters: {
      readFolders: () => currentFolders,
      readTickState: () => state,
      writeTickState: (next) => {
        state.snapshot = next.snapshot;
        state.emittedKeys = next.emittedKeys;
      },
      routeAdapters: {
        getTopicMap: () => topicMap,
        createTopic: async (name) => {
          created.push(name);
          return { success: true, topicId: 800 + created.length };
        },
        recordTopicId: (backlogId, topicId) => {
          topicMap[backlogId] = topicId;
        },
        sendMessage: async (topicId, text) => {
          sent.push({ topicId, text });
          return true;
        },
        closeTopic: async (topicId) => {
          closed.push(topicId);
          return true;
        },
      },
      ...overrides,
    },
  };
}

// ── concierge-wiring-01 [started being worked] ────────────────────────────

test('concierge-wiring-01: a newly-active item creates its topic, posts its opening message, and persists the mapping', async () => {
  const { adapters, setFolders, created, sent, topicMap, state } = fakeAdapters();
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature' }] }));

  const result = await runConciergeTick(adapters);

  assert.deepEqual(created, ['BL-1 - a fine feature']);
  assert.deepEqual(sent, [{ topicId: 801, text: 'TaskStarted: BL-1' }]);
  assert.equal(topicMap['BL-1'], 801);
  assert.equal(result.routed, 1);
  assert.equal(state.snapshot.backlog.active[0], 'BL-1');
});

// ── concierge-wiring-01 [completed] ───────────────────────────────────────

test('concierge-wiring-01: a newly-completed item posts a completion summary into its topic and closes it', async () => {
  const { adapters, setFolders, sent, closed } = fakeAdapters();
  // First tick: item is active (opens its topic).
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature' }] }));
  await runConciergeTick(adapters);

  // Second tick: item moved to done.
  setFolders(folders({ done: [{ id: 'BL-1', title: 'a fine feature' }] }));
  const result = await runConciergeTick(adapters);

  assert.deepEqual(sent[sent.length - 1], { topicId: 801, text: 'BL-1 - a fine feature is complete.' });
  assert.deepEqual(closed, [801]);
  assert.equal(result.routed, 1);
});

// ── concierge-wiring-02: durable restart-safe dedup ───────────────────────

test('concierge-wiring-02: an event already routed is not re-routed on a later tick with no change', async () => {
  const { adapters, setFolders, created, sent } = fakeAdapters();
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature' }] }));
  await runConciergeTick(adapters);
  const result = await runConciergeTick(adapters); // no change

  assert.equal(created.length, 1);
  assert.equal(sent.length, 1);
  assert.equal(result.routed, 0);
});

test('concierge-wiring-02: reloading the durable state fresh (simulated restart) still prevents a re-route', async () => {
  const first = fakeAdapters();
  first.setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature' }] }));
  await runConciergeTick(first.adapters);

  // Simulate a restart: a FRESH adapters object, but readTickState/
  // readFolders/topicMap are backed by the SAME persisted state (as a real
  // restart would read the same files back off disk).
  const second = fakeAdapters();
  second.state.snapshot = first.state.snapshot;
  second.state.emittedKeys = [...first.state.emittedKeys];
  Object.assign(second.topicMap, first.topicMap);
  second.setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature' }] }));

  const result = await runConciergeTick(second.adapters);

  assert.equal(second.created.length, 0);
  assert.equal(second.sent.length, 0);
  assert.equal(result.routed, 0);
});

test('the tick state always advances (writeTickState is called every tick, even with nothing to route)', async () => {
  const { adapters, state } = fakeAdapters();
  await runConciergeTick(adapters);
  assert.notEqual(state.snapshot, null);
  assert.deepEqual(state.snapshot.backlog, { active: [], paused: [], done: [] });
});

test('a title is looked up per event from the folders snapshot, not hardcoded', async () => {
  const { adapters, setFolders, created } = fakeAdapters();
  setFolders(
    folders({
      active: [
        { id: 'BL-1', title: 'first item' },
        { id: 'BL-2', title: 'second item' },
      ],
    })
  );
  await runConciergeTick(adapters);
  assert.deepEqual(created.sort(), ['BL-1 - first item', 'BL-2 - second item']);
});

test('routing multiple events in one tick only marks the SUCCESSFULLY posted ones as emitted', async () => {
  const { adapters, setFolders, state } = fakeAdapters();
  adapters.routeAdapters.createTopic = async (name) => (name.startsWith('BL-1 ') ? { success: false } : { success: true, topicId: 900 });
  setFolders(
    folders({
      active: [
        { id: 'BL-1', title: 'fails to open' },
        { id: 'BL-2', title: 'opens fine' },
      ],
    })
  );
  const result = await runConciergeTick(adapters);
  assert.equal(result.routed, 1);
  assert.ok(state.emittedKeys.includes('TaskStarted:BL-2'));
  assert.ok(!state.emittedKeys.includes('TaskStarted:BL-1'));
});

// Regression (found during cleaner review): a failed route was never
// marked emitted, but the persisted snapshot advanced past the transition
// anyway, so the diff could never see it as "new" again on a later tick -
// a transient createTopic failure silently and permanently dropped the
// event. Fixed by holding a failed transition's id back out of the
// persisted snapshot so the next tick's diff still treats it as pending.
test('a route that fails to post is retried on a later tick once the transition is still pending', async () => {
  const { adapters, setFolders, created, state } = fakeAdapters();
  let shouldFail = true;
  adapters.routeAdapters.createTopic = async (name) => {
    created.push(name);
    return shouldFail ? { success: false } : { success: true, topicId: 950 };
  };
  setFolders(folders({ active: [{ id: 'BL-1', title: 'flaky open' }] }));

  const first = await runConciergeTick(adapters);
  assert.equal(first.routed, 0);
  assert.ok(!state.emittedKeys.includes('TaskStarted:BL-1'));

  shouldFail = false;
  const second = await runConciergeTick(adapters); // folders unchanged - still active
  assert.equal(second.routed, 1);
  assert.deepEqual(created, ['BL-1 - flaky open', 'BL-1 - flaky open']);
  assert.ok(state.emittedKeys.includes('TaskStarted:BL-1'));
});
