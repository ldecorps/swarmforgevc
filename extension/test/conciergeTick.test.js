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
  const iconsSet = [];
  const iconOwnership = {};
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
    iconsSet,
    iconOwnership,
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
        state.standingIconSeenIds = next.standingIconSeenIds;
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
      // BL-342: an EMPTY sticker list by default - resolveIconStickerId
      // then never finds a match, so syncTopicIcon safely no-ops
      // ('skipped-unresolved-icon') for every test that does not care
      // about icons, never accidentally calling setTopicIcon. Tests that
      // DO exercise icon sync override iconAdapters.getIconStickers.
      iconAdapters: {
        getIconStickers: async () => [],
        setTopicIcon: async (topicId, iconId) => {
          iconsSet.push({ topicId, iconId });
          return true;
        },
        readSwarmIconId: (ticketId) => iconOwnership[ticketId],
        recordSwarmIconId: (ticketId, iconId) => {
          iconOwnership[ticketId] = iconId;
        },
      },
      // BL-418: no standing topics by default - tests that exercise the
      // standing-topic icon sync override this via `overrides`.
      readStandingTopics: () => [],
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

// BL-408: paused tickets awaiting approval are now asked too - they sit in
// paused/ until promotion. Only done/ tickets are out of scope.
test('BL-408: a paused ticket pending approval IS asked in its own topic', async () => {
  const { adapters, setFolders, created, sent, topicMap } = fakeAdapters();
  setFolders(folders({ paused: [{ id: 'BL-2', title: 'awaiting promotion', humanApproval: 'pending' }] }));

  const result = await runConciergeTick(adapters);

  // Approval request for paused ticket fires (no TaskStarted since not yet
  // active), so only ApprovalRequested routes - creates the topic on demand.
  assert.equal(created.length, 1);
  assert.equal(topicMap['BL-2'], 801);
  assert.ok(sent.some((m) => m.text === 'This ticket needs your approval before it can proceed. Reply here with "approve" to approve it.' && m.topicId === 801));
  assert.equal(result.routed, 1);
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

// ── BL-394: epic-progress announcements are change-gated ──────────────────
//
// The live incident: an epic's own message has no dedup of its own, so
// whenever its TRIGGERING ticket event re-derives - e.g. a held-back retry
// after that ticket's OWN per-ticket post fails - the epic side effect
// tags along and reposts the identical, unchanged text every such retry.
// Every test below forces exactly that re-derivation (a ticket-level post
// that keeps failing) to prove the epic's OWN durable, content-based dedup
// actually suppresses the repeat - a fixture with no retry at all would
// pass even on the old, unfixed code, since the outer event-level dedup
// already prevents re-derivation when nothing is retrying.

test('BL-394 epic-gate-01: an unchanged epic progress is announced only once, even while its own ticket post keeps retrying', async () => {
  const { adapters, setFolders, sent } = fakeAdapters();
  const epicTicket = epicDefTicket('dynamic-routing', 'Dynamic Routing');
  setFolders(folders({
    paused: [epicTicket],
    active: [{ id: 'BL-1', title: 'first slice', epic: 'dynamic-routing' }, { id: 'BL-2', title: 'second slice', epic: 'dynamic-routing' }],
  }));
  await runConciergeTick(adapters);

  // BL-1's own per-ticket completion post is stuck retrying (mirrors the
  // real incident) - its TaskCompleted event keeps re-deriving every tick,
  // dragging the epic side-effect along, while the epic's own progress
  // text stays unchanged across every one of these retries.
  adapters.routeAdapters.sendMessage = async (topicId, text) => {
    sent.push({ topicId, text });
    return text !== 'BL-1 - first slice is complete.';
  };
  setFolders(folders({
    paused: [epicTicket],
    active: [{ id: 'BL-2', title: 'second slice', epic: 'dynamic-routing' }],
    done: [{ id: 'BL-1', title: 'first slice', epic: 'dynamic-routing' }],
  }));
  await runConciergeTick(adapters);
  await runConciergeTick(adapters);
  await runConciergeTick(adapters);

  assert.equal(sent.filter((m) => m.text.includes('ticketed slice')).length, 1, 'an unchanged epic progress must not repost on repeated retried ticks');
});

test('BL-394 epic-gate-02: a real progress change is announced exactly once and recorded as announced', async () => {
  const { adapters, setFolders, sent, state } = fakeAdapters();
  const epicTicket = epicDefTicket('dynamic-routing', 'Dynamic Routing');
  setFolders(folders({
    paused: [epicTicket],
    active: [{ id: 'BL-1', title: 'first slice', epic: 'dynamic-routing' }, { id: 'BL-2', title: 'second slice', epic: 'dynamic-routing' }],
  }));
  await runConciergeTick(adapters);

  setFolders(folders({
    paused: [epicTicket],
    active: [{ id: 'BL-2', title: 'second slice', epic: 'dynamic-routing' }],
    done: [{ id: 'BL-1', title: 'first slice', epic: 'dynamic-routing' }],
  }));
  await runConciergeTick(adapters);

  const progressMessages = sent.filter((m) => m.text.includes('ticketed slice'));
  assert.equal(progressMessages.length, 1, 'exactly one epic-progress message carries the new progress');
  assert.equal(progressMessages[0].text, '1 of 2 ticketed slice(s) complete.');
  assert.ok(
    state.emittedKeys.some((k) => k.includes('1 of 2 ticketed slice(s) complete.')),
    'the new progress is durably recorded as announced'
  );

  // A subsequent, genuinely unchanged tick must not repeat it.
  await runConciergeTick(adapters);
  assert.equal(sent.filter((m) => m.text.includes('ticketed slice')).length, 1);
});

test('BL-394 epic-gate-03: a restart against unchanged, durably-recorded progress announces nothing', async () => {
  const first = fakeAdapters();
  const epicTicket = epicDefTicket('dynamic-routing', 'Dynamic Routing');
  // BL-1's own per-ticket completion post is stuck retrying, same as
  // epic-gate-01, so its TaskCompleted event keeps re-deriving across
  // ticks AND across the simulated restart below.
  first.adapters.routeAdapters.sendMessage = async (topicId, text) => {
    first.sent.push({ topicId, text });
    return text !== 'BL-1 - a fine feature is complete.';
  };
  first.setFolders(folders({ paused: [epicTicket], active: [{ id: 'BL-1', title: 'a fine feature', epic: 'dynamic-routing' }] }));
  await runConciergeTick(first.adapters);
  first.setFolders(folders({ paused: [epicTicket], done: [{ id: 'BL-1', title: 'a fine feature', epic: 'dynamic-routing' }] }));
  await runConciergeTick(first.adapters);
  assert.equal(first.sent.filter((m) => m.text.includes('ticketed slice')).length, 1);

  // "Restart": a BRAND NEW adapters instance, seeded only with the
  // persisted snapshot + emittedKeys the prior process wrote to disk -
  // exactly what a real relaunch rehydrates from, never the in-memory Set
  // (runConciergeTick already rebuilds alreadyEmitted from state.emittedKeys
  // on every call, so this is the honest way to prove durability rather
  // than relying on JS object continuity within one fakeAdapters instance).
  const restarted = fakeAdapters();
  restarted.state.snapshot = first.state.snapshot;
  restarted.state.emittedKeys = [...first.state.emittedKeys];
  Object.assign(restarted.topicMap, first.topicMap);
  restarted.adapters.routeAdapters.sendMessage = async (topicId, text) => {
    restarted.sent.push({ topicId, text });
    return text !== 'BL-1 - a fine feature is complete.';
  };
  restarted.setFolders(folders({ paused: [epicTicket], done: [{ id: 'BL-1', title: 'a fine feature', epic: 'dynamic-routing' }] }));

  await runConciergeTick(restarted.adapters);

  assert.equal(
    restarted.sent.filter((m) => m.text.includes('ticketed slice')).length,
    0,
    'a restart against unchanged, durably-recorded progress must not repost'
  );
});

test('BL-394 epic-gate-04: a repeated opening for an already-opened epic announces nothing', async () => {
  const { adapters, setFolders, sent } = fakeAdapters();
  const epicTicket = epicDefTicket('dynamic-routing', 'Dynamic Routing');
  // BL-1's own per-ticket opening post is stuck retrying; the epic's own
  // one-time opening line must still fire exactly once despite that.
  adapters.routeAdapters.sendMessage = async (topicId, text) => {
    sent.push({ topicId, text });
    return text !== 'What it is: a fine feature';
  };
  setFolders(folders({ paused: [epicTicket], active: [{ id: 'BL-1', title: 'a fine feature', epic: 'dynamic-routing' }] }));

  await runConciergeTick(adapters);
  await runConciergeTick(adapters);
  await runConciergeTick(adapters);

  assert.equal(sent.filter((m) => m.text === 'Epic: Dynamic Routing').length, 1, 'the epic opening must not repeat on a retried tick');
});

test('BL-394 epic-gate-05: a failed epic post is not recorded as announced, and retries once it succeeds', async () => {
  const { adapters, setFolders, sent, state } = fakeAdapters();
  const epicTicket = epicDefTicket('dynamic-routing', 'Dynamic Routing');
  setFolders(folders({
    paused: [epicTicket],
    active: [{ id: 'BL-1', title: 'first slice', epic: 'dynamic-routing' }, { id: 'BL-2', title: 'second slice', epic: 'dynamic-routing' }],
  }));
  await runConciergeTick(adapters);

  // Every prior epic-gate test above fails only the TICKET-level post and
  // always lets the epic's OWN post through - none of them prove
  // postEpicUpdateIfApplicable's own "record only after a SUCCESSFUL post"
  // contract. Here the ticket-level post keeps failing (forcing the same
  // TaskCompleted event to re-derive every tick, same mechanism as
  // epic-gate-01) AND the epic's own progress post fails on its first
  // attempt too.
  let epicPostAttempts = 0;
  adapters.routeAdapters.sendMessage = async (topicId, text) => {
    sent.push({ topicId, text });
    if (text.includes('ticketed slice')) {
      epicPostAttempts += 1;
      return epicPostAttempts > 1;
    }
    return false;
  };
  setFolders(folders({
    paused: [epicTicket],
    active: [{ id: 'BL-2', title: 'second slice', epic: 'dynamic-routing' }],
    done: [{ id: 'BL-1', title: 'first slice', epic: 'dynamic-routing' }],
  }));
  await runConciergeTick(adapters);
  assert.ok(
    !state.emittedKeys.some((k) => k.includes('1 of 2 ticketed slice(s) complete.')),
    'a failed epic post must not be durably recorded as announced'
  );

  await runConciergeTick(adapters);
  assert.equal(
    sent.filter((m) => m.text === '1 of 2 ticketed slice(s) complete.').length,
    2,
    'the same unchanged progress is retried after a failed post and announced once it succeeds'
  );
  assert.ok(
    state.emittedKeys.some((k) => k.includes('1 of 2 ticketed slice(s) complete.')),
    'the successful retry is durably recorded as announced'
  );
});

// ── BL-342: topic icons track ticket state - rides the SAME TaskStarted/
//    TaskCompleted transitions, plus a paused-diff of its own ────────────

const ICON_STICKERS = [
  { emoji: '✅', customEmojiId: 'id-check' },
  { emoji: '🦠', customEmojiId: 'id-microbe' },
  { emoji: '🎵', customEmojiId: 'id-note' },
  { emoji: '🔍', customEmojiId: 'id-magnifier' },
];

// BL-417: feature-in-flight remapped from the bulb to the musical note.
test('BL-417/BL-342 topic-icons-01: a newly-active feature ticket gets the musical-note icon on its brand-new topic', async () => {
  const { adapters, setFolders, iconsSet, iconOwnership, topicMap } = fakeAdapters();
  adapters.iconAdapters.getIconStickers = async () => ICON_STICKERS;
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature', type: 'feature' }] }));

  await runConciergeTick(adapters);

  const topicId = topicMap['BL-1'];
  assert.deepEqual(iconsSet, [{ topicId, iconId: 'id-note' }]);
  assert.equal(iconOwnership['BL-1'], 'id-note');
});

// BL-417 feature-topic-icon-musical-note-03: a live sticker set lacking the
// musical note skips the icon (topicIconSync.ts's existing scenario-06
// unresolved-icon path) rather than crashing the tick.
test('BL-417 feature-topic-icon-musical-note-03: a live sticker set without the musical note skips the icon without failing the tick', async () => {
  const { adapters, setFolders, iconsSet } = fakeAdapters();
  adapters.iconAdapters.getIconStickers = async () => ICON_STICKERS.filter((s) => s.emoji !== '🎵');
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature', type: 'feature' }] }));

  await runConciergeTick(adapters);

  assert.deepEqual(iconsSet, [], 'expected no icon to be set when the musical note is absent from the live sticker set');
});

test('BL-342 topic-icons-01: a newly-active bug ticket gets the microbe icon', async () => {
  const { adapters, setFolders, iconsSet, topicMap } = fakeAdapters();
  adapters.iconAdapters.getIconStickers = async () => ICON_STICKERS;
  setFolders(folders({ active: [{ id: 'BL-2', title: 'a nasty defect', type: 'bug' }] }));

  await runConciergeTick(adapters);

  assert.deepEqual(iconsSet, [{ topicId: topicMap['BL-2'], iconId: 'id-microbe' }]);
});

test('BL-342 topic-icons-02/03: a ticket the swarm already owns gets the check icon on completion, even though its topic is closed', async () => {
  const { adapters, setFolders, iconsSet, iconOwnership, topicMap } = fakeAdapters();
  adapters.iconAdapters.getIconStickers = async () => ICON_STICKERS;
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature', type: 'feature' }] }));
  await runConciergeTick(adapters);
  iconsSet.length = 0;
  assert.equal(iconOwnership['BL-1'], 'id-note', 'expected ownership already established from TaskStarted');

  setFolders(folders({ done: [{ id: 'BL-1', title: 'a fine feature', type: 'feature' }] }));
  await runConciergeTick(adapters);

  assert.deepEqual(iconsSet, [{ topicId: topicMap['BL-1'], iconId: 'id-check' }]);
  assert.equal(iconOwnership['BL-1'], 'id-check');
});

test('BL-342 topic-icons-04/05: an existing topic the swarm never set an icon for is left alone on a state change', async () => {
  const { adapters, setFolders, iconsSet, topicMap } = fakeAdapters();
  adapters.iconAdapters.getIconStickers = async () => ICON_STICKERS;
  // Simulate a topic that already existed (e.g. hand-set by a human, or
  // pre-dating this ticket) BEFORE any tick ever ran - no ownership marker.
  topicMap['BL-1'] = 555;

  setFolders(folders({ done: [{ id: 'BL-1', title: 'a fine feature', type: 'feature' }] }));
  await runConciergeTick(adapters);

  assert.deepEqual(iconsSet, [], 'expected the swarm to never call setTopicIcon for a topic it does not own');
});

test('BL-342 topic-icons-02: a paused ticket promoted into active for the first time gets the musical-note icon, reusing its existing topic', async () => {
  // NOT a done->active bounce: diffTaskStarted's own durable emittedKeys
  // dedup (swarmEventStream.ts) means a (TaskStarted, backlogId) key, once
  // emitted, never re-fires even if the ticket later returns to active -
  // a pre-existing platform characteristic, not something BL-342 changes.
  // A genuinely fresh promotion is paused -> active (this ticket's own
  // TaskStarted key has never been emitted before) - the realistic shape
  // of "promoted -> in flight" the ticket's own convention describes; a
  // pipeline BOUNCE (QA/architect sending a parcel back) never moves the
  // ticket's OWN backlog folder at all, so it needs no icon change either.
  const { adapters, setFolders, iconsSet, iconOwnership, topicMap } = fakeAdapters();
  adapters.iconAdapters.getIconStickers = async () => ICON_STICKERS;
  // A topic already exists for this ticket (opened on an earlier paused
  // -> active -> paused round-trip) and the swarm already owns its icon.
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature', type: 'feature' }] }));
  await runConciergeTick(adapters);
  setFolders(folders({ paused: [{ id: 'BL-1', title: 'a fine feature', type: 'feature' }] }));
  await runConciergeTick(adapters);
  assert.equal(iconOwnership['BL-1'], 'id-magnifier');
  iconsSet.length = 0;

  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature', type: 'feature' }] }));
  await runConciergeTick(adapters);

  assert.deepEqual(iconsSet, [{ topicId: topicMap['BL-1'], iconId: 'id-note' }]);
});

test('BL-342 topic-icons-02 [paused]: a ticket newly entering paused gets the magnifier icon (no SwarmEvent needed)', async () => {
  const { adapters, setFolders, iconsSet, iconOwnership, topicMap } = fakeAdapters();
  adapters.iconAdapters.getIconStickers = async () => ICON_STICKERS;
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature', type: 'feature' }] }));
  await runConciergeTick(adapters);
  iconsSet.length = 0;

  setFolders(folders({ paused: [{ id: 'BL-1', title: 'a fine feature', type: 'feature' }] }));
  await runConciergeTick(adapters);

  assert.deepEqual(iconsSet, [{ topicId: topicMap['BL-1'], iconId: 'id-magnifier' }]);
  assert.equal(iconOwnership['BL-1'], 'id-magnifier');
});

test('BL-342: a ticket newly entering paused with no topic at all yet (never promoted) is a silent no-op', async () => {
  const { adapters, setFolders, iconsSet } = fakeAdapters();
  adapters.iconAdapters.getIconStickers = async () => ICON_STICKERS;
  setFolders(folders({ paused: [{ id: 'BL-9', title: 'freshly specced, never promoted', type: 'feature' }] }));

  await assert.doesNotReject(() => runConciergeTick(adapters));
  assert.deepEqual(iconsSet, []);
});

test('BL-342: the paused diff does not re-fire on a later tick where the ticket is still paused (edge-triggered, not level-triggered)', async () => {
  const { adapters, setFolders, iconsSet } = fakeAdapters();
  adapters.iconAdapters.getIconStickers = async () => ICON_STICKERS;
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature', type: 'feature' }] }));
  await runConciergeTick(adapters);
  setFolders(folders({ paused: [{ id: 'BL-1', title: 'a fine feature', type: 'feature' }] }));
  await runConciergeTick(adapters);
  iconsSet.length = 0;

  // Still paused, nothing changed - a second tick must not re-set the icon.
  await runConciergeTick(adapters);

  assert.deepEqual(iconsSet, []);
});

test('BL-342 topic-icons-06: an epic-defining ticket is never a target of icon sync at all', async () => {
  const { adapters, setFolders, iconsSet } = fakeAdapters();
  adapters.iconAdapters.getIconStickers = async () => ICON_STICKERS;
  setFolders(folders({ active: [{ id: 'BL-500', title: 'EPIC — some initiative', type: 'epic', epic: 'some-initiative' }] }));

  await runConciergeTick(adapters);

  assert.deepEqual(iconsSet, [], 'expected an epic-defining ticket to never receive an automated ticket-state icon');
});

// ── BL-418: the standing (non-ticket) topics' own icon sync ──────────────

const STANDING_ICON_STICKERS = [
  { emoji: '🎟', customEmojiId: 'id-ticket' },
  { emoji: '🏛', customEmojiId: 'id-opera-house' },
];

// BL-418 standing-topic-icons-01
test('BL-418 standing-topic-icons-01: the support/intake topic gets the box-office icon and the Operator topic gets the opera-house icon', async () => {
  const { adapters, iconsSet, iconOwnership } = fakeAdapters({
    readStandingTopics: () => [
      { id: 'SUP-001', topicId: 801, iconKey: 'support/intake' },
      { id: 'OPERATOR', topicId: 701, iconKey: 'operator' },
    ],
  });
  adapters.iconAdapters.getIconStickers = async () => STANDING_ICON_STICKERS;

  await runConciergeTick(adapters);

  assert.deepEqual(
    iconsSet.sort((a, b) => a.topicId - b.topicId),
    [
      { topicId: 701, iconId: 'id-opera-house' },
      { topicId: 801, iconId: 'id-ticket' },
    ]
  );
  assert.equal(iconOwnership['SUP-001'], 'id-ticket');
  assert.equal(iconOwnership['OPERATOR'], 'id-opera-house');
});

// BL-418 standing-topic-icons-02 (wiring level): a standing topic already
// known BEFORE this feature's first tick (simulating one that pre-dates
// BL-418 and may already carry a human-customised icon - the backfill
// script is what seeds this set for anything genuinely pre-existing) is
// never touched, even though the swarm has no ownership marker for it.
test('BL-418 standing-topic-icons-02: a standing topic already in the seen-set with no ownership marker is left untouched (never overwrites a human-customised icon)', async () => {
  const { adapters, iconsSet } = fakeAdapters({
    readStandingTopics: () => [{ id: 'SUP-999', topicId: 999, iconKey: 'support/intake' }],
  });
  adapters.iconAdapters.getIconStickers = async () => STANDING_ICON_STICKERS;
  // Simulates the backfill (or a prior tick) having already seen this topic.
  adapters.readTickState().standingIconSeenIds = ['SUP-999'];

  await runConciergeTick(adapters);

  assert.deepEqual(iconsSet, [], 'expected no icon to be set for an already-seen, not-swarm-owned standing topic');
});

// BL-418 standing-topic-icons-03
test('BL-418 standing-topic-icons-03: a live sticker set lacking a standing topic\'s icon skips it without failing the tick', async () => {
  const { adapters, iconsSet } = fakeAdapters({
    readStandingTopics: () => [{ id: 'OPERATOR', topicId: 701, iconKey: 'operator' }],
  });
  adapters.iconAdapters.getIconStickers = async () => STANDING_ICON_STICKERS.filter((s) => s.emoji !== '🏛');

  await assert.doesNotReject(() => runConciergeTick(adapters));
  assert.deepEqual(iconsSet, [], 'expected no icon to be set when the opera-house sticker is absent from the live set');
});

// A standing topic's id is added to the durable seen-set unconditionally on
// its first appearance, regardless of whether setTopicIcon itself actually
// succeeded - the same best-effort, no-dedicated-retry posture this module
// already documents for per-ticket icon sync and epic-progress posts
// (syncStandingTopicIcons' own docstring: "isNewTopic is always true...
// correct precisely because... this ticket's own definition of 'genuinely
// new'"). Unlike the sticker-absent skip above (permanent by construction -
// a nonexistent sticker can never resolve), this is a TRANSIENT failure
// (e.g. a Telegram API error) that the live tick will never retry, since
// the seen-set has no removal path - only the backfill script's own
// always-eligible pass (backfill-standing-topic-icons.ts) can recover it.
// Previously unproven: every prior standing-topic test had setTopicIcon
// return true.
test('BL-418: a setTopicIcon failure on a standing topic\'s first tick still marks it seen - the live tick never retries it', async () => {
  const { adapters, iconsSet, iconOwnership, state } = fakeAdapters({
    readStandingTopics: () => [{ id: 'OPERATOR', topicId: 701, iconKey: 'operator' }],
  });
  adapters.iconAdapters.getIconStickers = async () => STANDING_ICON_STICKERS;
  adapters.iconAdapters.setTopicIcon = async () => false;

  await runConciergeTick(adapters);

  assert.deepEqual(iconsSet, [], 'setTopicIcon returning false means nothing was actually recorded as set');
  assert.equal(iconOwnership.OPERATOR, undefined, 'a failed set never records ownership');
  assert.deepEqual(state.standingIconSeenIds, ['OPERATOR'], 'the id is marked seen despite the failure');

  // A later tick, even with a now-working setTopicIcon, never retries -
  // the seen-set gate has no memory of the earlier failure.
  adapters.iconAdapters.setTopicIcon = async (topicId, iconId) => {
    iconsSet.push({ topicId, iconId });
    return true;
  };
  await runConciergeTick(adapters);

  assert.deepEqual(iconsSet, [], 'a standing topic already in the seen-set is never retried, even after a prior failure');
});

// qa_e2e item 2: fires once, then change-gated on the very next tick.
test('BL-418 wiring: a standing topic is synced once on its first tick, then never re-set on a later tick', async () => {
  const { adapters, iconsSet } = fakeAdapters({
    readStandingTopics: () => [{ id: 'OPERATOR', topicId: 701, iconKey: 'operator' }],
  });
  adapters.iconAdapters.getIconStickers = async () => STANDING_ICON_STICKERS;

  await runConciergeTick(adapters);
  assert.deepEqual(iconsSet, [{ topicId: 701, iconId: 'id-opera-house' }]);
  iconsSet.length = 0;

  await runConciergeTick(adapters);
  assert.deepEqual(iconsSet, [], 'expected the second tick to be a no-op - the standing topic is already in the seen-set');
});

test('BL-418 wiring: standingIconSeenIds persists and grows across ticks rather than being clobbered', async () => {
  const { adapters, state } = fakeAdapters({
    readStandingTopics: () => [{ id: 'OPERATOR', topicId: 701, iconKey: 'operator' }],
  });
  adapters.iconAdapters.getIconStickers = async () => STANDING_ICON_STICKERS;
  await runConciergeTick(adapters);
  assert.deepEqual(state.standingIconSeenIds, ['OPERATOR']);

  // A new support topic appears on a later tick alongside the already-seen
  // Operator topic - both must end up in the persisted seen-set, and only
  // the genuinely new one gets its icon set.
  adapters.readStandingTopics = () => [
    { id: 'OPERATOR', topicId: 701, iconKey: 'operator' },
    { id: 'SUP-001', topicId: 801, iconKey: 'support/intake' },
  ];
  await runConciergeTick(adapters);

  assert.deepEqual([...state.standingIconSeenIds].sort(), ['OPERATOR', 'SUP-001']);
});
