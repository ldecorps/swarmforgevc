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
  let currentGates = [];
  let currentRoleTicket = {};
  return {
    state,
    topicMap,
    created,
    sent,
    closed,
    setFolders: (f) => {
      currentFolders = f;
    },
    setGates: (g) => {
      currentGates = g;
    },
    setRoleTicket: (rt) => {
      currentRoleTicket = rt;
    },
    adapters: {
      readFolders: () => currentFolders,
      readGates: () => currentGates,
      readRoleTicket: () => currentRoleTicket,
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

// ── needs-approval-01/02 — BL-301 ─────────────────────────────────────────

test('needs-approval-01 [a backlog item]: a newly-gated role holding a ticket posts NeedsApproval into that ticket\'s topic', async () => {
  const { adapters, setFolders, setGates, setRoleTicket, created, sent, topicMap } = fakeAdapters();
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature' }] }));
  setRoleTicket({ coder: 'BL-1' });
  setGates([{ role: 'coder', gated: true }]);

  const result = await runConciergeTick(adapters);

  // Both TaskStarted (newly active) and NeedsApproval (newly gated,
  // tagged BL-1) derive on this same first tick - both route into BL-1's
  // ONE topic (created once), never two topics for one item.
  assert.equal(created.length, 1);
  assert.equal(topicMap['BL-1'], 801);
  assert.ok(sent.some((m) => m.text === 'NeedsApproval: BL-1' && m.topicId === 801));
  assert.equal(result.routed, 2);
});

test('needs-approval-01 [no backlog item]: a newly-gated role holding no ticket posts no NeedsApproval anywhere', async () => {
  const { adapters, setGates, setRoleTicket, created, sent } = fakeAdapters();
  setGates([{ role: 'coder', gated: true }]);
  setRoleTicket({}); // coder holds nothing

  const result = await runConciergeTick(adapters);

  assert.deepEqual(created, []);
  assert.deepEqual(sent, []);
  assert.equal(result.routed, 0);
});

test('needs-approval-01: a gate that stays captured across two polls only posts once (no duplicate NeedsApproval)', async () => {
  const { adapters, setFolders, setGates, setRoleTicket, sent } = fakeAdapters();
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature' }] }));
  setRoleTicket({ coder: 'BL-1' });
  setGates([{ role: 'coder', gated: true }]);
  await runConciergeTick(adapters);
  const sentAfterFirst = sent.length;

  const result = await runConciergeTick(adapters); // gate still true, nothing changed

  assert.equal(sent.length, sentAfterFirst);
  assert.equal(result.routed, 0);
});

// ── needs-approval-02 — BL-301 retry symmetry ─────────────────────────────

test('needs-approval-02: a NeedsApproval whose post fails is retried on the next tick, not dropped', async () => {
  const { adapters, setFolders, setGates, setRoleTicket, state } = fakeAdapters();
  // The item already has a topic (an earlier TaskStarted already opened
  // it) and is NOT newly active this tick - isolates the scenario to ONLY
  // the NeedsApproval transition, so only its own send can fail/retry.
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature' }] }));
  adapters.writeTickState({ snapshot: { backlog: { active: ['BL-1'], paused: [], done: [] }, gates: [], roleTicket: {} }, emittedKeys: ['TaskStarted:BL-1'] });
  setRoleTicket({ coder: 'BL-1' });
  setGates([{ role: 'coder', gated: true }]);
  adapters.routeAdapters.getTopicMap = () => ({ 'BL-1': 42 });
  let shouldFail = true;
  const sent = [];
  adapters.routeAdapters.sendMessage = async (topicId, text) => {
    if (shouldFail) {
      return false;
    }
    sent.push({ topicId, text });
    return true;
  };

  const first = await runConciergeTick(adapters);
  assert.equal(first.routed, 0);
  assert.ok(!state.emittedKeys.includes('NeedsApproval:BL-1'));
  // The gate transition must still be pending in the persisted snapshot -
  // a real restart/next tick re-reads the SAME live gate (still true).
  assert.equal(state.snapshot.gates.find((g) => g.role === 'coder').gated, false);

  shouldFail = false;
  const second = await runConciergeTick(adapters); // gate still true, unchanged live state
  assert.equal(second.routed, 1);
  assert.deepEqual(sent, [{ topicId: 42, text: 'NeedsApproval: BL-1' }]);
  assert.ok(state.emittedKeys.includes('NeedsApproval:BL-1'));
});
