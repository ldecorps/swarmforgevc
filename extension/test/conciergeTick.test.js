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
  const recorded = [];
  let currentFolders = folders();
  let currentGates = [];
  let currentRoleTicket = {};
  let operatorTopicId = 700;
  return {
    state,
    topicMap,
    created,
    sent,
    closed,
    recorded,
    setOperatorTopicId: (id) => {
      operatorTopicId = id;
    },
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
        recordMessage: (backlogId, text) => {
          recorded.push({ backlogId, text });
        },
        ensureOperatorTopic: async () => operatorTopicId,
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
  // BL-322: TaskStarted now renders a derived summary, not the bare
  // "TaskStarted: BL-1" line - title-only here since this fixture's
  // BacklogFolderItem carries no notes/firstAcceptanceStep.
  assert.deepEqual(sent, [{ topicId: 801, text: 'What it is: a fine feature' }]);
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

// BL-358: an untagged gate (holds no ticket) used to be dropped entirely -
// now it reaches the standing Operator topic instead, never a per-ticket
// topic (no createTopic call at all - there is no ticket to name one after).
test('needs-approval-01 [no backlog item]: a newly-gated role holding no ticket posts NeedsApproval into the standing Operator topic', async () => {
  const { adapters, setGates, setRoleTicket, setOperatorTopicId, created, sent } = fakeAdapters();
  setOperatorTopicId(700);
  setGates([{ role: 'coder', gated: true }]);
  setRoleTicket({}); // coder holds nothing

  const result = await runConciergeTick(adapters);

  assert.deepEqual(created, [], 'an untagged gate has no ticket to create a per-item topic for');
  assert.deepEqual(sent, [{ topicId: 700, text: 'NeedsApproval: coder' }]);
  assert.equal(result.routed, 1);
});

test('needs-approval-01 [no backlog item]: the untagged post carries the role\'s own snippet, same as a tagged one', async () => {
  const { adapters, setGates, setRoleTicket, sent } = fakeAdapters();
  setGates([{ role: 'specifier', gated: true, snippet: 'Which design should I pick? (1/2/3)' }]);
  setRoleTicket({});

  await runConciergeTick(adapters);

  assert.deepEqual(sent, [{ topicId: 700, text: 'NeedsApproval: specifier - Which design should I pick? (1/2/3)' }]);
});

test('needs-approval-01 [no backlog item]: a role that stays gated with no ticket is asked about once, not every tick', async () => {
  const { adapters, setGates, setRoleTicket, sent } = fakeAdapters();
  setGates([{ role: 'coder', gated: true }]);
  setRoleTicket({});
  await runConciergeTick(adapters);
  const sentAfterFirst = sent.length;

  const result = await runConciergeTick(adapters); // still gated, still no ticket

  assert.equal(sent.length, sentAfterFirst);
  assert.equal(result.routed, 0);
});

// BL-358 retry symmetry: mirrors needs-approval-02's tagged-event test below
// - an untagged NeedsApproval whose post fails must also be retried, not
// silently and permanently dropped.
test('needs-approval-02 [no backlog item]: an untagged NeedsApproval whose post fails is retried on the next tick', async () => {
  const { adapters, setGates, setRoleTicket, state } = fakeAdapters();
  setGates([{ role: 'coder', gated: true }]);
  setRoleTicket({});
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
  assert.ok(!state.emittedKeys.includes('NeedsApproval:role:coder'));
  assert.equal(state.snapshot.gates.find((g) => g.role === 'coder').gated, false);

  shouldFail = false;
  const second = await runConciergeTick(adapters); // gate still true, unchanged live state
  assert.equal(second.routed, 1);
  assert.deepEqual(sent, [{ topicId: 700, text: 'NeedsApproval: coder' }]);
  assert.ok(state.emittedKeys.includes('NeedsApproval:role:coder'));
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

// ── pending-approval-asks (BL-357) ────────────────────────────────────────

test('BL-357: an active ticket newly pending approval asks for it in its own topic', async () => {
  const { adapters, setFolders, created, sent, topicMap } = fakeAdapters();
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature', humanApproval: 'pending' }] }));

  const result = await runConciergeTick(adapters);

  // TaskStarted (newly active) and ApprovalRequested (newly pending) both
  // derive on this same first tick and route into BL-1's ONE topic.
  assert.equal(created.length, 1);
  assert.equal(topicMap['BL-1'], 801);
  assert.ok(sent.some((m) => m.text === 'This ticket needs your approval before it can proceed. Reply here with "approve" to approve it.' && m.topicId === 801));
  assert.equal(result.routed, 2);
});

test('BL-357: a ticket that stays pending across ticks is asked once, not on every tick', async () => {
  const { adapters, setFolders, sent } = fakeAdapters();
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature', humanApproval: 'pending' }] }));
  await runConciergeTick(adapters);
  const sentAfterFirst = sent.length;

  const result = await runConciergeTick(adapters); // still pending, nothing changed

  assert.equal(sent.length, sentAfterFirst);
  assert.equal(result.routed, 0);
});

test('BL-357: an active ticket whose approval is not pending is never asked about', async () => {
  const { adapters, setFolders, sent } = fakeAdapters();
  setFolders(folders({ active: [{ id: 'BL-1', title: 'no approval needed' }] }));

  await runConciergeTick(adapters);

  assert.deepEqual(sent.filter((m) => m.text.includes('needs your approval')), []);
});

test('BL-357: a paused ticket defaulted to pending is never asked - only active tickets are in scope', async () => {
  const { adapters, setFolders, created, sent } = fakeAdapters();
  setFolders(folders({ paused: [{ id: 'BL-2', title: 'not yet promoted', humanApproval: 'pending' }] }));

  const result = await runConciergeTick(adapters);

  assert.deepEqual(created, []);
  assert.deepEqual(sent, []);
  assert.equal(result.routed, 0);
});

test('BL-357: an ApprovalRequested that fails to post is retried on a later tick', async () => {
  const { adapters, setFolders, state } = fakeAdapters();
  // Isolate to ONLY the ApprovalRequested transition: the item already has
  // a topic and is not newly active this tick, mirroring needs-approval-02.
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature', humanApproval: 'pending' }] }));
  adapters.writeTickState({
    snapshot: { backlog: { active: ['BL-1'], paused: [], done: [] }, gates: [], roleTicket: {}, ticketSummaries: {}, pendingApproval: [] },
    emittedKeys: ['TaskStarted:BL-1'],
  });
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
  assert.ok(!state.emittedKeys.includes('ApprovalRequested:BL-1'));
  // The transition must still be pending in the persisted snapshot so the
  // next tick's diff re-derives + retries it.
  assert.deepEqual(state.snapshot.pendingApproval, []);

  shouldFail = false;
  const second = await runConciergeTick(adapters); // still pending, unchanged live state
  assert.equal(second.routed, 1);
  assert.deepEqual(sent, [{ topicId: 42, text: 'This ticket needs your approval before it can proceed. Reply here with "approve" to approve it.' }]);
  assert.ok(state.emittedKeys.includes('ApprovalRequested:BL-1'));
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

// ── epics-as-first-class-topics (BL-341) ──────────────────────────────────

// BL-341: the epic-defining ticket itself - an ALREADY-LIVE convention
// this ticket discovered (BL-384's `type: epic`), reused rather than a
// second data source. Kept in the PAUSED folder in every fixture below
// (mirrors BL-384's own real status: "not directly promotable") so it
// never itself triggers TaskStarted/TaskCompleted noise that would
// contaminate assertions about its SLICES' own routing.
function epicDefTicket(id, title, remainingSlices = []) {
  return { id: `${id}-epic-ticket`, title, type: 'epic', epic: id, remainingSlices };
}

test('BL-341 epics-01/02: a slice declaring an epic opens the epic\'s topic on its first appearance', async () => {
  const { adapters, setFolders, created, sent, topicMap } = fakeAdapters();
  setFolders(folders({
    paused: [epicDefTicket('dynamic-routing', 'Dynamic Routing')],
    active: [{ id: 'BL-1', title: 'a fine feature', epic: 'dynamic-routing' }],
  }));

  await runConciergeTick(adapters);

  assert.ok(created.includes('EPIC — Dynamic Routing'));
  assert.ok(topicMap['dynamic-routing'] !== undefined, 'the epic id is recorded in the SAME topic map as ticket ids');
  assert.ok(sent.some((m) => m.topicId === topicMap['dynamic-routing'] && m.text === 'Epic: Dynamic Routing'));
});

test('BL-341 epics-03: a second slice for the SAME epic reuses its topic - created once, not once per slice', async () => {
  const { adapters, setFolders, created, topicMap } = fakeAdapters();
  const epicTicket = epicDefTicket('dynamic-routing', 'Dynamic Routing');
  setFolders(folders({ paused: [epicTicket], active: [{ id: 'BL-1', title: 'first slice', epic: 'dynamic-routing' }] }));
  await runConciergeTick(adapters);
  const epicTopicId = topicMap['dynamic-routing'];
  const epicTopicsCreatedAfterFirst = created.filter((name) => name.startsWith('EPIC — ')).length;

  // BL-2 is a brand new ticket, so it DOES get its own per-ticket topic
  // (created grows by one for that) - the assertion below is scoped to the
  // EPIC topic specifically, never re-created for BL-2's slice.
  setFolders(folders({
    paused: [epicTicket],
    active: [{ id: 'BL-1', title: 'first slice', epic: 'dynamic-routing' }, { id: 'BL-2', title: 'second slice', epic: 'dynamic-routing' }],
  }));
  await runConciergeTick(adapters);

  assert.equal(created.filter((name) => name.startsWith('EPIC — ')).length, epicTopicsCreatedAfterFirst, 'no second epic topic created');
  assert.equal(topicMap['dynamic-routing'], epicTopicId, 'the same epic topic id is reused');
});

test('BL-341 epics-04: a slice completing posts progress into its epic\'s topic, stating how many slices remain', async () => {
  const { adapters, setFolders, sent, topicMap } = fakeAdapters();
  const epicTicket = epicDefTicket('dynamic-routing', 'Dynamic Routing');
  setFolders(folders({
    paused: [epicTicket],
    active: [{ id: 'BL-1', title: 'a fine feature', epic: 'dynamic-routing' }, { id: 'BL-2', title: 'another slice', epic: 'dynamic-routing' }],
  }));
  await runConciergeTick(adapters);
  const epicTopicId = topicMap['dynamic-routing'];

  setFolders(folders({
    paused: [epicTicket],
    active: [{ id: 'BL-2', title: 'another slice', epic: 'dynamic-routing' }],
    done: [{ id: 'BL-1', title: 'a fine feature', epic: 'dynamic-routing' }],
  }));
  await runConciergeTick(adapters);

  assert.ok(sent.some((m) => m.topicId === epicTopicId && m.text === '1 of 2 ticketed slice(s) complete.'));
});

test('BL-341 epics-05/06: the epic states a remaining slice that has no ticket, and is never reported complete while it exists', async () => {
  const { adapters, setFolders, sent, topicMap } = fakeAdapters();
  const epicTicket = epicDefTicket('dynamic-routing', 'Dynamic Routing', ['warm-core/break-even tuning']);
  setFolders(folders({ paused: [epicTicket], active: [{ id: 'BL-1', title: 'a fine feature', epic: 'dynamic-routing' }] }));
  await runConciergeTick(adapters);
  const epicTopicId = topicMap['dynamic-routing'];

  // Every TICKETED slice of the epic completes...
  setFolders(folders({ paused: [epicTicket], done: [{ id: 'BL-1', title: 'a fine feature', epic: 'dynamic-routing' }] }));
  await runConciergeTick(adapters);

  const progressMessages = sent.filter((m) => m.topicId === epicTopicId && m.text.includes('ticketed slice'));
  const last = progressMessages[progressMessages.length - 1];
  assert.match(last.text, /warm-core\/break-even tuning/, 'the untracked remaining slice is named');
  assert.equal(last.text.includes('Epic complete'), false, 'never reported complete while an untracked slice remains');
});

test('BL-341 epics-07: a ticket with no epic behaves exactly as before - no epic topic created or posted into', async () => {
  const { adapters, setFolders, created, sent } = fakeAdapters();
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature' }] }));

  await runConciergeTick(adapters);
  setFolders(folders({ done: [{ id: 'BL-1', title: 'a fine feature' }] }));
  await runConciergeTick(adapters);

  assert.deepEqual(created, ['BL-1 - a fine feature']);
  assert.ok(!sent.some((m) => m.text.includes('ticketed slice') || m.text.startsWith('Epic:')));
});

test('BL-341 epics-08: an epic with no defining ticket yet still gets a topic, falling back to its own id as the title', async () => {
  const { adapters, setFolders, created } = fakeAdapters();
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature', epic: 'undocumented-epic' }] }));

  await runConciergeTick(adapters);

  assert.ok(created.includes('EPIC — undocumented-epic'));
});

// An epic topic's own createTopic failure is a no-op here, never a
// fallback post anywhere else - it is deliberately NOT part of the
// transition-held-back retry mechanism (that mechanism retries the
// TICKET's own TaskStarted/TaskCompleted transition, which still posts
// into the ticket's own topic independently of the epic side effect).
test('BL-341: an epic topic that fails to create is not posted into', async () => {
  const { adapters, setFolders, created, sent } = fakeAdapters();
  adapters.routeAdapters.createTopic = async (name) => {
    created.push(name);
    return name.startsWith('EPIC — ') ? { success: false } : { success: true, topicId: 800 + created.length };
  };
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature', epic: 'undocumented-epic' }] }));

  await runConciergeTick(adapters);

  assert.ok(created.includes('EPIC — undocumented-epic'));
  assert.ok(!sent.some((m) => m.text === 'Epic: undocumented-epic'));
});

// Hardening gap: every epics-0x test above ran with exactly ONE epic in
// play. epicDefinitionsFor/epicSlicesFor key everything off epicId, but
// that keying was never proven with two DIFFERENT epics active in the
// SAME tick - a wrong filter (e.g. matching on type: 'epic' alone, or
// counting slices without checking which epic they declare) would still
// pass every single-epic test above yet silently blend one epic's slice
// count into the other's. Per the hardener's own standing rule: a
// selector is only proven at 2+ concurrent candidates.
test('BL-341 hardening: two epics active in the same tick keep separate topics and separate slice counts, never blended', async () => {
  const { adapters, setFolders, sent, topicMap } = fakeAdapters();
  const routingEpic = epicDefTicket('dynamic-routing', 'Dynamic Routing');
  const benchmarkEpic = epicDefTicket('role-benchmarking', 'Role Benchmarking');
  setFolders(folders({
    paused: [routingEpic, benchmarkEpic],
    active: [
      { id: 'BL-1', title: 'routing slice one', epic: 'dynamic-routing' },
      { id: 'BL-2', title: 'routing slice two', epic: 'dynamic-routing' },
      { id: 'BL-3', title: 'benchmark slice one', epic: 'role-benchmarking' },
    ],
  }));
  await runConciergeTick(adapters);
  const routingTopicId = topicMap['dynamic-routing'];
  const benchmarkTopicId = topicMap['role-benchmarking'];
  assert.notEqual(routingTopicId, benchmarkTopicId, 'each epic gets its OWN topic');

  // Complete one of routing's two slices, and benchmark's only slice, in
  // the same tick.
  setFolders(folders({
    paused: [routingEpic, benchmarkEpic],
    active: [{ id: 'BL-2', title: 'routing slice two', epic: 'dynamic-routing' }],
    done: [
      { id: 'BL-1', title: 'routing slice one', epic: 'dynamic-routing' },
      { id: 'BL-3', title: 'benchmark slice one', epic: 'role-benchmarking' },
    ],
  }));
  await runConciergeTick(adapters);

  // Routing: 1 of 2 done. Benchmark: 1 of 1 done, epic complete - each
  // count reflects only its OWN epic's slices, never the other's.
  assert.ok(sent.some((m) => m.topicId === routingTopicId && m.text === '1 of 2 ticketed slice(s) complete.'));
  assert.ok(sent.some((m) => m.topicId === benchmarkTopicId && m.text.includes('1 of 1 ticketed slice(s) complete.') && m.text.includes('Epic complete')));
});
