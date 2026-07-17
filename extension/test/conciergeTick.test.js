const assert = require('node:assert/strict');
const { runConciergeTick } = require('../out/concierge/conciergeTick');
// BL-414 hardener bounce: only the one rate-limit wiring test below needs
// the REAL Telegram-facing retry function - conciergeTick.ts itself stays
// Telegram-agnostic (see its own header comment); every other test in this
// file uses the plain always-succeeds titlesSet stub from fakeAdapters.
const { editForumTopicWithRateLimitRetry } = require('../out/notify/telegramClient');
const { wrapPipelineBoardHtml } = require('../out/concierge/pipelineBoard');

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
  const titlesSet = [];
  const lastActivityByTicket = {};
  let currentFolders = folders();
  let currentGates = [];
  let currentRoleTicket = {};
  let operatorTopicId = 700;
  let approvalsTopicId = 750;
  return {
    state,
    topicMap,
    created,
    sent,
    closed,
    recorded,
    iconsSet,
    iconOwnership,
    titlesSet,
    lastActivityByTicket,
    setLastActivityMs: (ticketId, ms) => {
      lastActivityByTicket[ticketId] = ms;
    },
    setOperatorTopicId: (id) => {
      operatorTopicId = id;
    },
    setApprovalsTopicId: (id) => {
      approvalsTopicId = id;
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
        state.roleIconSeenIds = next.roleIconSeenIds;
        state.titleAgeBuckets = next.titleAgeBuckets;
        state.pipelineBoard = next.pipelineBoard;
        state.approvalsRoster = next.approvalsRoster;
        state.recertPosted = next.recertPosted;
        state.doneClosedAtMs = next.doneClosedAtMs;
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
        ensureApprovalsTopic: async () => approvalsTopicId,
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
      // BL-469: no per-agent role topics by default - tests that exercise
      // the per-agent steering-topic icon sync override this via
      // `overrides`, the same safe-default posture as readStandingTopics.
      readRoleTopics: () => [],
      // BL-414: no recorded activity by default (readLastActivityMs
      // undefined -> 'skipped-no-activity') - a safe, always-no-op default
      // exactly like iconAdapters' own empty sticker list above, so every
      // existing test that never calls setLastActivityMs is completely
      // unaffected. Tests that DO exercise title-age sync call
      // setLastActivityMs to seed a real ms value.
      titleAdapters: {
        readLastActivityMs: (ticketId) => lastActivityByTicket[ticketId],
        setTopicTitle: async (topicId, title) => {
          titlesSet.push({ topicId, title });
          return true;
        },
      },
      // BL-452: no role holds any ticket by default, and ensureBoardTopic
      // resolves to undefined ('failed-no-topic', a harmless no-op) - the
      // same safe-default posture as iconAdapters' empty sticker list and
      // titleAdapters' undefined activity above, so every existing test
      // that never touches the board is completely unaffected. Tests that
      // DO exercise the board override readRoleHeldTickets/boardAdapters.
      readRoleHeldTickets: () => ({}),
      boardAdapters: {
        ensureBoardTopic: async () => undefined,
        postMessage: async () => undefined,
        deleteMessage: async () => true,
      },
      // BL-434: a safe no-op default (ensureApprovalsTopic resolves to
      // undefined -> 'failed-no-topic', harmless) mirroring boardAdapters'
      // own posture above, so every existing test that never touches the
      // roster is completely unaffected. Tests that DO exercise the roster
      // override rosterAdapters.
      rosterAdapters: {
        ensureApprovalsTopic: async () => undefined,
        postMessage: async () => undefined,
        editMessage: async () => true,
      },
      // BL-450: no scenario currently up for recert by default - a safe
      // no-op posture mirroring rosterAdapters above, so every existing
      // test that never touches recert posting is completely unaffected.
      // Tests that DO exercise it override readRecertScenario/
      // recertPostingAdapters.
      readRecertScenario: () => undefined,
      recertPostingAdapters: {
        ensureRecertTopic: async () => undefined,
        postMessage: async () => undefined,
        editMessage: async () => true,
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

test('BL-434: an active ticket newly pending approval asks for it in the standing Approvals topic, not its own topic', async () => {
  const { adapters, setFolders, created, sent, topicMap } = fakeAdapters();
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature', humanApproval: 'pending' }] }));

  const result = await runConciergeTick(adapters);

  // TaskStarted (newly active) creates BL-1's own topic; ApprovalRequested
  // (newly pending) routes to the standing Approvals topic instead - no
  // second per-ticket topic is created for it.
  assert.equal(created.length, 1);
  assert.equal(topicMap['BL-1'], 801);
  assert.ok(sent.some((m) => m.text.includes('BL-1 needs your approval') && m.topicId === 750));
  assert.ok(!sent.some((m) => m.text.includes('needs your approval') && m.topicId === 801), "the ask must not be posted into the ticket's own topic");
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
test('BL-434: a paused ticket pending approval IS asked in the standing Approvals topic, not its own topic', async () => {
  const { adapters, setFolders, sent, topicMap } = fakeAdapters();
  setFolders(folders({ paused: [{ id: 'BL-2', title: 'awaiting promotion', humanApproval: 'pending' }] }));

  const result = await runConciergeTick(adapters);

  // Approval request for the paused ticket fires (no TaskStarted since not
  // yet active) and routes to the standing Approvals topic. A per-ticket
  // topic IS created as a side effect (BL-424: the icon sync needs one to
  // set the awaiting-approval icon on), but never receives the ask itself.
  assert.equal(topicMap['BL-2'], 801);
  assert.ok(!sent.some((m) => m.topicId === 801), "the ask must never post into the ticket's own topic");
  assert.ok(sent.some((m) => m.text.includes('BL-2 needs your approval') && m.topicId === 750));
  assert.equal(result.routed, 1);
});

// BL-480: pendingApprovalFor already scans active AND paused for pending
// approvals (BL-408), but ticketSummariesFor used to build its map from
// ACTIVE tickets only - so a paused ticket's ApprovalRequested ask silently
// degraded to the bare id-only line even when its own YAML carried a title/
// notes, exactly the ticket meat this feature exists to surface. Proves the
// paused-ticket summary now reaches the rendered ask, not just its id.
test('BL-480: a paused ticket pending approval renders its title/notes in the ask, not just the bare id', async () => {
  const { adapters, setFolders, sent } = fakeAdapters();
  setFolders(
    folders({
      paused: [{ id: 'BL-2', title: 'awaiting promotion', notes: 'this ticket fixes the widget', humanApproval: 'pending' }],
    })
  );

  await runConciergeTick(adapters);

  const ask = sent.find((m) => m.text.includes('BL-2 needs your approval') && m.topicId === 750);
  assert.ok(ask, 'expected the standing Approvals-topic ask');
  assert.ok(ask.text.includes('awaiting promotion'), `expected the paused ticket's title in the ask, got: ${ask.text}`);
  assert.ok(ask.text.includes('this ticket fixes the widget'), `expected the paused ticket's notes in the ask, got: ${ask.text}`);
});

test('BL-434: an ApprovalRequested that fails to post is retried on a later tick', async () => {
  const { adapters, setFolders, state } = fakeAdapters();
  // Isolate to ONLY the ApprovalRequested transition: not newly active this
  // tick, mirroring needs-approval-02. The ask routes to the standing
  // Approvals topic regardless of any per-ticket topic mapping.
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature', humanApproval: 'pending' }] }));
  adapters.writeTickState({
    snapshot: { backlog: { active: ['BL-1'], paused: [], done: [] }, gates: [], roleTicket: {}, ticketSummaries: {}, pendingApproval: [] },
    emittedKeys: ['TaskStarted:BL-1'],
  });
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
  assert.equal(sent.length, 1);
  assert.equal(sent[0].topicId, 750);
  assert.match(sent[0].text, /BL-1 needs your approval/);
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

// ── BL-449: a newly-created epic topic gets its musical-form icon ─────────

const EPIC_STICKERS = [
  { emoji: '🎙', customEmojiId: 'id-mic' },
  { emoji: '🎭', customEmojiId: 'id-masks' },
  { emoji: '🎬', customEmojiId: 'id-clapper' },
  { emoji: '🎤', customEmojiId: 'id-mic2' },
];

test('BL-449: a brand-new epic topic is assigned its resolved musical-form icon on creation', async () => {
  const { adapters, setFolders, topicMap, iconsSet, iconOwnership } = fakeAdapters({
    iconAdapters: {
      getIconStickers: async () => EPIC_STICKERS,
      setTopicIcon: async (topicId, iconId) => {
        iconsSet.push({ topicId, iconId });
        return true;
      },
      readSwarmIconId: (id) => iconOwnership[id],
      recordSwarmIconId: (id, iconId) => {
        iconOwnership[id] = iconId;
      },
    },
  });
  setFolders(folders({
    paused: [epicDefTicket('role-benchmarking', 'Swarm Role Benchmarking')],
    active: [{ id: 'BL-1', title: 'a fine feature', epic: 'role-benchmarking' }],
  }));

  await runConciergeTick(adapters);

  const epicTopicId = topicMap['role-benchmarking'];
  assert.ok(iconsSet.some((s) => s.topicId === epicTopicId && s.iconId === 'id-mic'), `expected the epic topic's icon to be set to id-mic, got: ${JSON.stringify(iconsSet)}`);
  assert.equal(iconOwnership['role-benchmarking'], 'id-mic');
});

test('BL-449: two different new epics created in the same tick get distinct pool icons', async () => {
  const { adapters, setFolders, iconsSet } = fakeAdapters({
    iconAdapters: {
      getIconStickers: async () => EPIC_STICKERS,
      setTopicIcon: async (topicId, iconId) => {
        iconsSet.push({ topicId, iconId });
        return true;
      },
      readSwarmIconId: () => undefined,
      recordSwarmIconId: () => {},
    },
  });
  setFolders(folders({
    active: [
      { id: 'BL-1', title: 'routing slice', epic: 'undocumented-epic-a' },
      { id: 'BL-2', title: 'benchmark slice', epic: 'undocumented-epic-b' },
    ],
  }));

  await runConciergeTick(adapters);

  assert.equal(iconsSet.length, 2);
  assert.notEqual(iconsSet[0].iconId, iconsSet[1].iconId, 'expected two distinct epics created in one tick to get distinct pool icons');
});

test('BL-449: reusing an already-created epic topic for a second slice never re-sets its icon', async () => {
  const { adapters, setFolders, iconsSet } = fakeAdapters({
    iconAdapters: {
      getIconStickers: async () => EPIC_STICKERS,
      setTopicIcon: async (topicId, iconId) => {
        iconsSet.push({ topicId, iconId });
        return true;
      },
      readSwarmIconId: () => 'id-mic',
      recordSwarmIconId: () => {},
    },
  });
  const epicTicket = epicDefTicket('dynamic-routing', 'Dynamic Routing');
  setFolders(folders({ paused: [epicTicket], active: [{ id: 'BL-1', title: 'first slice', epic: 'dynamic-routing' }] }));
  await runConciergeTick(adapters);
  const iconSetCountAfterFirst = iconsSet.length;

  setFolders(folders({
    paused: [epicTicket],
    active: [{ id: 'BL-1', title: 'first slice', epic: 'dynamic-routing' }, { id: 'BL-2', title: 'second slice', epic: 'dynamic-routing' }],
  }));
  await runConciergeTick(adapters);

  assert.equal(iconsSet.length, iconSetCountAfterFirst, 'expected no further setTopicIcon call for a REUSED epic topic');
});

test('BL-449: a failed epic-topic creation never attempts to set an icon', async () => {
  const { adapters, setFolders, created, iconsSet } = fakeAdapters({
    iconAdapters: {
      getIconStickers: async () => EPIC_STICKERS,
      setTopicIcon: async (topicId, iconId) => {
        iconsSet.push({ topicId, iconId });
        return true;
      },
      readSwarmIconId: () => undefined,
      recordSwarmIconId: () => {},
    },
  });
  adapters.routeAdapters.createTopic = async (name) => {
    created.push(name);
    return name.startsWith('EPIC — ') ? { success: false } : { success: true, topicId: 800 + created.length };
  };
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature', epic: 'undocumented-epic' }] }));

  await runConciergeTick(adapters);

  assert.deepEqual(iconsSet, []);
});

test('BL-449: an epic emoji absent from the live sticker set is skipped without failing the tick or the epic post', async () => {
  const { adapters, setFolders, sent, iconsSet, topicMap } = fakeAdapters({
    iconAdapters: {
      getIconStickers: async () => [], // no stickers at all - every resolution is unresolved
      setTopicIcon: async (topicId, iconId) => {
        iconsSet.push({ topicId, iconId });
        return true;
      },
      readSwarmIconId: () => undefined,
      recordSwarmIconId: () => {},
    },
  });
  setFolders(folders({
    paused: [epicDefTicket('role-benchmarking', 'Swarm Role Benchmarking')],
    active: [{ id: 'BL-1', title: 'a fine feature', epic: 'role-benchmarking' }],
  }));

  await runConciergeTick(adapters);

  assert.deepEqual(iconsSet, [], 'expected no setTopicIcon call when the desired emoji is absent from the live set');
  assert.ok(topicMap['role-benchmarking'] !== undefined, 'the epic topic itself is still created');
  assert.ok(sent.some((m) => m.text === 'Epic: Swarm Role Benchmarking'), 'the epic opening message still posts - icon resolution failure is best-effort, never blocking');
});

test('BL-449: exhausting the epic icon pool within one tick logs a reuse warning and still assigns an icon', async () => {
  // Every pool icon needs its own sticker so resolveIconStickerId can match
  // it and setTopicIcon actually fires for all 11 epics below - EPIC_STICKERS
  // only covers 4 of the pool's 10 icons, not enough to exhaust it.
  const FULL_POOL_STICKERS = ['🎙', '🎭', '🎬', '🎤', '🎨', '🎩', '🕺', '💃', '✍️', '📚'].map((emoji, i) => ({
    emoji,
    customEmojiId: `id-${i}`,
  }));
  const { adapters, setFolders, iconsSet } = fakeAdapters({
    iconAdapters: {
      getIconStickers: async () => FULL_POOL_STICKERS,
      setTopicIcon: async (topicId, iconId) => {
        iconsSet.push({ topicId, iconId });
        return true;
      },
      readSwarmIconId: () => undefined,
      recordSwarmIconId: () => {},
    },
  });
  // EPIC_ICON_POOL has 10 icons; an 11th distinct epic in the same tick
  // must fall back to reusing the pool's last icon rather than crashing.
  const active = Array.from({ length: 11 }, (_, i) => ({
    id: `BL-${i}`,
    title: `slice ${i}`,
    epic: `undocumented-epic-${i}`,
  }));
  setFolders(folders({ active }));
  const originalErrorWrite = process.stderr.write;
  const errors = [];
  process.stderr.write = (chunk) => {
    errors.push(chunk);
    return true;
  };
  try {
    await runConciergeTick(adapters);
  } finally {
    process.stderr.write = originalErrorWrite;
  }

  assert.equal(iconsSet.length, 11, 'expected every one of the 11 epics to still get an icon assigned');
  assert.ok(errors.some((e) => e.includes('epic icon pool exhausted')), `expected a pool-exhaustion warning, got: ${JSON.stringify(errors)}`);
});

test('BL-457: known epics reserve their pinned glyphs before unknown epics draw from the pool - no spurious "pool exhausted" warning, no duplicate icons', async () => {
  // Same full sticker set as the exhaustion test so setTopicIcon fires for
  // every pool glyph - the only icons that resolve here are the epic ones
  // (ticket-state glyphs are absent from this set), so iconsSet is exactly
  // one entry per epic topic.
  const FULL_POOL_STICKERS = ['🎙', '🎭', '🎬', '🎤', '🎨', '🎩', '🕺', '💃', '✍️', '📚'].map((emoji, i) => ({
    emoji,
    customEmojiId: `id-${i}`,
  }));
  const { adapters, setFolders, iconsSet } = fakeAdapters({
    iconAdapters: {
      getIconStickers: async () => FULL_POOL_STICKERS,
      setTopicIcon: async (topicId, iconId) => {
        iconsSet.push({ topicId, iconId });
        return true;
      },
      readSwarmIconId: () => undefined,
      recordSwarmIconId: () => {},
    },
  });
  // Mirrors the live backlog that produced the false warning: three KNOWN
  // epics (fixed glyphs 🎙/🎭/🎬) and three unknown epics, with the unknowns
  // traversed FIRST. Pre-fix the unknowns greedily grabbed the knowns' pinned
  // glyphs, so every known epic then "collided" and warned each tick - though
  // only 6 of the pool's 10 slots are ever in play.
  const knownEpics = ['role-benchmarking', 'dynamic-routing', 'onboarding-target-repo'];
  const unknownEpics = ['fleet-second-swarm', 'recert-telegram-move', 'swarm-self-optimization'];
  setFolders(folders({
    active: [
      ...unknownEpics.map((epic, i) => ({ id: `BL-U${i}`, title: `unknown slice ${i}`, epic })),
      ...knownEpics.map((epic, i) => ({ id: `BL-K${i}`, title: `known slice ${i}`, epic })),
    ],
  }));
  const originalErrorWrite = process.stderr.write;
  const errors = [];
  process.stderr.write = (chunk) => {
    errors.push(chunk);
    return true;
  };
  try {
    await runConciergeTick(adapters);
  } finally {
    process.stderr.write = originalErrorWrite;
  }

  assert.ok(
    !errors.some((e) => e.includes('epic icon pool exhausted')),
    `expected NO pool-exhaustion warning for 6 epics in a 10-slot pool, got: ${JSON.stringify(errors)}`,
  );
  assert.equal(iconsSet.length, 6, 'expected each of the six epic topics to receive an icon');
  const iconIds = iconsSet.map((s) => s.iconId);
  assert.equal(new Set(iconIds).size, iconIds.length, `expected every epic topic to get a DISTINCT icon, got: ${JSON.stringify(iconsSet)}`);
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
  { emoji: '👀', customEmojiId: 'id-eyes' },
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

// ── BL-424 approval-icon-state-01/02: the icon-sync caller now reads
//    human_approval off the same folders snapshot and passes it through to
//    resolveIconState - a paused ticket blocked ONLY on the human's
//    approval gets a distinct icon from any other paused hold ────────────

test('BL-424: a ticket newly entering paused with human_approval pending gets the eyes icon, not the plain magnifier', async () => {
  const { adapters, setFolders, iconsSet, iconOwnership, topicMap } = fakeAdapters();
  adapters.iconAdapters.getIconStickers = async () => ICON_STICKERS;
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature', type: 'feature' }] }));
  await runConciergeTick(adapters);
  iconsSet.length = 0;

  setFolders(folders({ paused: [{ id: 'BL-1', title: 'a fine feature', type: 'feature', humanApproval: 'pending' }] }));
  await runConciergeTick(adapters);

  assert.deepEqual(iconsSet, [{ topicId: topicMap['BL-1'], iconId: 'id-eyes' }]);
  assert.equal(iconOwnership['BL-1'], 'id-eyes');
});

// BL-424: proves the wiring actually READS human_approval off the fixture
// (the "wiring test that adds a new on-disk input" engineering rule) -
// break-then-fix: blank the field on an otherwise-identical fixture and
// confirm the icon reverts to the plain paused magnifier, then restore it.
test('BL-424: a paused ticket with no human_approval field gets the plain magnifier icon, not the eyes icon (break-then-fix)', async () => {
  const { adapters, setFolders, iconsSet, topicMap } = fakeAdapters();
  adapters.iconAdapters.getIconStickers = async () => ICON_STICKERS;
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature', type: 'feature' }] }));
  await runConciergeTick(adapters);
  iconsSet.length = 0;

  // BROKEN: human_approval blanked/absent on this fixture.
  setFolders(folders({ paused: [{ id: 'BL-1', title: 'a fine feature', type: 'feature' }] }));
  await runConciergeTick(adapters);
  assert.deepEqual(
    iconsSet,
    [{ topicId: topicMap['BL-1'], iconId: 'id-magnifier' }],
    'expected the plain paused icon when human_approval is absent from the fixture'
  );
  iconsSet.length = 0;

  // FIXED: a fresh ticket restores human_approval: pending and gets the
  // distinct eyes icon - proving the earlier magnifier result above was
  // really driven by the field's absence, not some other cause.
  setFolders(folders({ paused: [{ id: 'BL-2', title: 'another feature', type: 'feature', humanApproval: 'pending' }] }));
  await runConciergeTick(adapters);
  assert.deepEqual(iconsSet, [{ topicId: topicMap['BL-2'], iconId: 'id-eyes' }]);
});

test('BL-424: a paused ticket that is approved (not pending) keeps the plain magnifier icon', async () => {
  const { adapters, setFolders, iconsSet, topicMap } = fakeAdapters();
  adapters.iconAdapters.getIconStickers = async () => ICON_STICKERS;
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature', type: 'feature' }] }));
  await runConciergeTick(adapters);
  iconsSet.length = 0;

  setFolders(folders({ paused: [{ id: 'BL-1', title: 'a fine feature', type: 'feature', humanApproval: 'approved' }] }));
  await runConciergeTick(adapters);

  assert.deepEqual(iconsSet, [{ topicId: topicMap['BL-1'], iconId: 'id-magnifier' }]);
});

// BL-424 approval-icon-fallback-02: the eyes glyph absent from the live set
// falls back to the plain paused icon rather than skipping the topic.
test('BL-424: a live sticker set without the eyes glyph falls back to the plain magnifier icon for an awaiting-approval ticket', async () => {
  const { adapters, setFolders, iconsSet, topicMap } = fakeAdapters();
  adapters.iconAdapters.getIconStickers = async () => ICON_STICKERS.filter((s) => s.emoji !== '👀');

  setFolders(folders({ paused: [{ id: 'BL-1', title: 'a fine feature', type: 'feature', humanApproval: 'pending' }] }));
  await runConciergeTick(adapters);

  assert.deepEqual(
    iconsSet,
    [{ topicId: topicMap['BL-1'], iconId: 'id-magnifier' }],
    'expected the fallback to the plain paused icon rather than skipping the topic entirely'
  );
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
  { emoji: '🛎', customEmojiId: 'id-bell' },
];

// BL-418 standing-topic-icons-01
test('BL-418 standing-topic-icons-01: the support/intake topic gets the box-office icon and the Operator topic gets the bell icon', async () => {
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
      { topicId: 701, iconId: 'id-bell' },
      { topicId: 801, iconId: 'id-ticket' },
    ]
  );
  assert.equal(iconOwnership['SUP-001'], 'id-ticket');
  assert.equal(iconOwnership['OPERATOR'], 'id-bell');
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
  adapters.iconAdapters.getIconStickers = async () => STANDING_ICON_STICKERS.filter((s) => s.emoji !== '🛎');

  await assert.doesNotReject(() => runConciergeTick(adapters));
  assert.deepEqual(iconsSet, [], 'expected no icon to be set when the bell sticker is absent from the live set');
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
  assert.deepEqual(iconsSet, [{ topicId: 701, iconId: 'id-bell' }]);
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

// ── BL-469: per-agent Telegram steering-topic icons ───────────────────────
// Reuses syncStandingTopicIcons' EXACT change-gated (newly-entering-only)
// posture, generalized to per-agent role topics rather than standing ones -
// see syncPerAgentTopicIcons' own docstring in conciergeTick.ts.

const ROLE_ICON_STICKERS = [
  { emoji: '📣', customEmojiId: 'id-megaphone' },
  { emoji: '📝', customEmojiId: 'id-note' },
  { emoji: '🏛', customEmojiId: 'id-building' },
  { emoji: '💻', customEmojiId: 'id-laptop' },
  { emoji: '🧼', customEmojiId: 'id-soap' },
  { emoji: '🧪', customEmojiId: 'id-tube' },
  { emoji: '🔎', customEmojiId: 'id-magnifier-tilted' },
  { emoji: '📰', customEmojiId: 'id-newspaper' },
];

const ALL_ROLE_TOPIC_TARGETS = [
  { role: 'coordinator', topicId: 901 },
  { role: 'specifier', topicId: 902 },
  { role: 'architect', topicId: 903 },
  { role: 'coder', topicId: 904 },
  { role: 'cleaner', topicId: 905 },
  { role: 'hardender', topicId: 906 },
  { role: 'QA', topicId: 907 },
  { role: 'documenter', topicId: 908 },
];

// BL-469 per-agent-steering-topic-icon-01
test('BL-469 per-agent-steering-topic-icon-01: each of the 8 role topics gets its own mapped icon on first tick', async () => {
  const { adapters, iconsSet, iconOwnership } = fakeAdapters({
    readRoleTopics: () => ALL_ROLE_TOPIC_TARGETS,
  });
  adapters.iconAdapters.getIconStickers = async () => ROLE_ICON_STICKERS;

  await runConciergeTick(adapters);

  assert.deepEqual(
    iconsSet.sort((a, b) => a.topicId - b.topicId),
    [
      { topicId: 901, iconId: 'id-megaphone' },
      { topicId: 902, iconId: 'id-note' },
      { topicId: 903, iconId: 'id-building' },
      { topicId: 904, iconId: 'id-laptop' },
      { topicId: 905, iconId: 'id-soap' },
      { topicId: 906, iconId: 'id-tube' },
      { topicId: 907, iconId: 'id-magnifier-tilted' },
      { topicId: 908, iconId: 'id-newspaper' },
    ]
  );
  assert.equal(iconOwnership.coordinator, 'id-megaphone');
  assert.equal(iconOwnership.coder, 'id-laptop');
  assert.equal(iconOwnership.QA, 'id-magnifier-tilted');
});

// BL-469 per-agent-steering-topic-icon-02
test('BL-469 per-agent-steering-topic-icon-02: an icon Telegram does not offer is surfaced (skipped-unresolved-icon) and does not block the other roles', async () => {
  const { adapters, iconsSet, iconOwnership } = fakeAdapters({
    readRoleTopics: () => ALL_ROLE_TOPIC_TARGETS,
  });
  // The coder's laptop sticker is absent from the live set; every other
  // role's mapped icon is still offered.
  adapters.iconAdapters.getIconStickers = async () => ROLE_ICON_STICKERS.filter((s) => s.emoji !== '💻');

  await assert.doesNotReject(() => runConciergeTick(adapters));

  assert.equal(
    iconsSet.find((s) => s.topicId === 904),
    undefined,
    'the coder topic never got an icon set - its sticker is unresolved'
  );
  assert.equal(iconOwnership.coder, undefined, 'a skipped-unresolved icon never records ownership');
  // Every other role still resolved and got its own mapped icon.
  assert.equal(iconsSet.length, 7);
  assert.equal(iconOwnership.QA, 'id-magnifier-tilted');
  assert.equal(iconOwnership.documenter, 'id-newspaper');
});

// BL-469 per-agent-steering-topic-icon-03
test('BL-469 per-agent-steering-topic-icon-03: a steady-state tick does not re-edit an already-set per-agent topic icon', async () => {
  const { adapters, iconsSet } = fakeAdapters({
    readRoleTopics: () => ALL_ROLE_TOPIC_TARGETS,
  });
  adapters.iconAdapters.getIconStickers = async () => ROLE_ICON_STICKERS;

  await runConciergeTick(adapters);
  assert.equal(iconsSet.length, 8);
  iconsSet.length = 0;

  await runConciergeTick(adapters);
  assert.deepEqual(iconsSet, [], 'expected the second, unchanged tick to be a no-op for every already-seen role topic');
});

// BL-469 wiring: a role topic already known BEFORE this feature's first
// tick (simulating one that predates BL-469 and may already carry a
// human-customised icon) is never touched, even though the swarm has no
// ownership marker for it - mirrors BL-418 standing-topic-icons-02.
test('BL-469: a role topic already in the seen-set with no ownership marker is left untouched', async () => {
  const { adapters, iconsSet } = fakeAdapters({
    readRoleTopics: () => [{ role: 'coder', topicId: 904 }],
  });
  adapters.iconAdapters.getIconStickers = async () => ROLE_ICON_STICKERS;
  adapters.readTickState().roleIconSeenIds = ['coder'];

  await runConciergeTick(adapters);

  assert.deepEqual(iconsSet, [], 'expected no icon to be set for an already-seen, not-swarm-owned role topic');
});

// BL-469 wiring: roleIconSeenIds persists and grows across ticks rather
// than being clobbered - mirrors BL-418's own standingIconSeenIds test.
test('BL-469: roleIconSeenIds persists and grows across ticks rather than being clobbered', async () => {
  const { adapters, state } = fakeAdapters({
    readRoleTopics: () => [{ role: 'coordinator', topicId: 901 }],
  });
  adapters.iconAdapters.getIconStickers = async () => ROLE_ICON_STICKERS;
  await runConciergeTick(adapters);
  assert.deepEqual(state.roleIconSeenIds, ['coordinator']);

  // A second role's topic appears on a later tick alongside the
  // already-seen coordinator topic - both must end up in the persisted
  // seen-set, and only the genuinely new one gets its icon set.
  adapters.readRoleTopics = () => [
    { role: 'coordinator', topicId: 901 },
    { role: 'coder', topicId: 904 },
  ];
  await runConciergeTick(adapters);

  assert.deepEqual([...state.roleIconSeenIds].sort(), ['coder', 'coordinator']);
});

// ── BL-414: topic-title age suffix ────────────────────────────────────────

const TITLE_AGE_HOUR_MS = 60 * 60 * 1000;

// BL-414 topic-title-age-suffix-01/02
test('BL-414 wiring: crossing into a staler bucket edits the title once; an unchanged bucket does not re-edit', async () => {
  const { adapters, setFolders, topicMap, titlesSet, setLastActivityMs, state } = fakeAdapters();
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature' }] }));
  topicMap['BL-1'] = 900;
  state.titleAgeBuckets = { 'BL-1': 'fresh' };
  setLastActivityMs('BL-1', 0);

  await runConciergeTick(adapters, 3 * TITLE_AGE_HOUR_MS);
  assert.deepEqual(titlesSet, [{ topicId: 900, title: 'a fine feature · 3h ago' }]);
  assert.equal(state.titleAgeBuckets['BL-1'], 'hours');

  titlesSet.length = 0;
  await runConciergeTick(adapters, 5 * TITLE_AGE_HOUR_MS); // still within the "hours" bucket
  assert.deepEqual(titlesSet, [], 'expected no re-edit while the bucket stays unchanged');
  assert.equal(state.titleAgeBuckets['BL-1'], 'hours');
});

// BL-414 topic-title-age-suffix-03
test('BL-414 wiring: new activity resets the suffix to the freshest bucket on the next tick', async () => {
  const { adapters, setFolders, topicMap, titlesSet, setLastActivityMs, state } = fakeAdapters();
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature' }] }));
  topicMap['BL-1'] = 900;
  state.titleAgeBuckets = { 'BL-1': 'stale' };
  const nowMs = 100 * TITLE_AGE_HOUR_MS;
  // New activity landed 30 minutes before "now" - a fresh elapsed time.
  setLastActivityMs('BL-1', nowMs - 30 * 60 * 1000);

  await runConciergeTick(adapters, nowMs);

  assert.deepEqual(titlesSet, [{ topicId: 900, title: 'a fine feature' }], 'expected the fresh edit to strip the stale-looking suffix');
  assert.equal(state.titleAgeBuckets['BL-1'], 'fresh');
});

test('BL-414: an epic-defining ticket is never a target of title-age sync', async () => {
  const { adapters, setFolders, topicMap, titlesSet, setLastActivityMs } = fakeAdapters();
  setFolders(folders({ active: [{ id: 'EPIC-1', title: 'an epic', type: 'epic', epic: 'EPIC-1' }] }));
  topicMap['EPIC-1'] = 900;
  setLastActivityMs('EPIC-1', 0);

  await runConciergeTick(adapters, 5 * TITLE_AGE_HOUR_MS);

  assert.deepEqual(titlesSet, []);
});

test('BL-414: a ticket with no topic yet is a silent no-op for title-age sync', async () => {
  // paused (never active) so no SwarmEvent fires and no topic is created by
  // the event-routing path this tick also runs - the same "never promoted"
  // shape topicIconsTrackTicketStateSteps.js's own no-topic-yet test uses.
  const { adapters, setFolders, titlesSet, setLastActivityMs } = fakeAdapters();
  setFolders(folders({ paused: [{ id: 'BL-1', title: 'a fine feature' }] }));
  setLastActivityMs('BL-1', 0);

  await runConciergeTick(adapters, 5 * TITLE_AGE_HOUR_MS);

  assert.deepEqual(titlesSet, []);
});

test('BL-414: a ticket whose topic has no recorded activity yet is left alone (no crash, no edit)', async () => {
  const { adapters, setFolders, topicMap, titlesSet } = fakeAdapters();
  setFolders(folders({ active: [{ id: 'BL-1', title: 'a fine feature' }] }));
  topicMap['BL-1'] = 900;
  // setLastActivityMs deliberately never called - readLastActivityMs returns undefined.

  await runConciergeTick(adapters, 5 * TITLE_AGE_HOUR_MS);

  assert.deepEqual(titlesSet, []);
});

test('BL-414: omitting titleAdapters entirely leaves the tick unaffected - existing adapters fixtures built before this field existed keep working unchanged', async () => {
  const { adapters, setFolders, topicMap } = fakeAdapters();
  delete adapters.titleAdapters;
  setFolders(folders({ paused: [{ id: 'BL-1', title: 'a fine feature' }] }));
  topicMap['BL-1'] = 900;

  const result = await runConciergeTick(adapters, 5 * TITLE_AGE_HOUR_MS);

  assert.equal(result.routed, 0);
});

// ── BL-414 hardener bounce (2026-07-15): the FIRST tick this sync ever
// runs transitions EVERY existing ticket's bucket from unset to real at
// once - syncAllTitleAgeBuckets loops one editForumTopic call per ticket,
// back-to-back, gated only by decideTitleAge's steady-state bucket-equality
// check (which does nothing on this very first tick). Unthrottled, that
// reproduces BL-342's own live repro ("Too Many Requests: retry after 26"
// after 19 of 26 calls, 7 silently dropped) - at 2026-07-15's tracked-topic
// count (113), roughly 4x the volume that already tripped the limit once.
// 30 tickets here mirrors the backfill's own "N > the historical trip
// threshold (26)" scale (backfillTopicIconsCli.test.js's 26-topic test),
// with the SAME rate-limit hit partway through. This wires the REAL
// editForumTopicWithRateLimitRetry as titleAdapters.setTopicTitle - proving
// not just that the loop calls setTopicTitle once per ticket (that much is
// true by construction), but that the PRODUCTION retry mechanism actually
// waits out a 429 rather than the sync treating it as an ordinary,
// unrecoverable failure.
test('BL-414 hardener bounce: a first-tick mass fan-out over many tickets honours a mid-batch 429 and drops none', async () => {
  const TICKET_COUNT = 30;
  const { adapters, setFolders, topicMap, setLastActivityMs, state } = fakeAdapters();
  const items = [];
  for (let i = 1; i <= TICKET_COUNT; i++) {
    const id = `BL-${i}`;
    items.push({ id, title: `ticket ${i}` });
    topicMap[id] = 100 + i;
    setLastActivityMs(id, 0); // real activity - every ticket's bucket starts unset
  }
  setFolders(folders({ active: items }));
  state.titleAgeBuckets = {}; // first tick this sync has ever run: no prior buckets

  let editCalls = 0;
  const waits = [];
  const postFn = async () => {
    editCalls += 1;
    if (editCalls === 20) {
      // matches BL-342's own live repro: hit the limit AFTER 19 calls.
      return { ok: false, status: 429, json: { ok: false, description: 'retry after 26', parameters: { retry_after: 26 } } };
    }
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };
  adapters.titleAdapters.setTopicTitle = (topicId, title) =>
    editForumTopicWithRateLimitRetry('fake-token', 'fake-chat', topicId, { name: title }, async (ms) => waits.push(ms), postFn);

  await runConciergeTick(adapters, 5 * TITLE_AGE_HOUR_MS);

  assert.equal(editCalls, TICKET_COUNT + 1, 'expected the rate-limited call to be retried once, never dropped');
  assert.deepEqual(waits, [26000], 'expected exactly one rate-limit wait, honouring the server-told duration');
  assert.equal(Object.keys(state.titleAgeBuckets).length, TICKET_COUNT, 'expected every ticket to end up with an announced bucket, none silently dropped');
  for (const { id } of items) {
    assert.equal(state.titleAgeBuckets[id], 'hours', `expected ${id}'s bucket to be persisted, not left unset`);
  }
});

// ── BL-452/BL-462: pipeline board wiring ──────────────────────────────────

test('BL-462: the pipeline board reposts at the bottom (delete + post) on a stage change, and is a complete no-op - including the footer time - when unchanged', async () => {
  const { adapters, state } = fakeAdapters();
  const ensured = [];
  const posted = [];
  const deleted = [];
  const T1 = Date.UTC(2026, 6, 16, 20, 5);
  const T2 = Date.UTC(2026, 6, 16, 20, 6);
  adapters.readRoleHeldTickets = () => ({ coder: ['BL-1'] });
  adapters.boardAdapters = {
    ensureBoardTopic: async () => {
      ensured.push(true);
      return 900;
    },
    postMessage: async (topicId, text) => {
      posted.push({ topicId, text });
      return 42;
    },
    deleteMessage: async (topicId, messageId) => {
      deleted.push({ topicId, messageId });
      return true;
    },
  };

  await runConciergeTick(adapters, T1);

  assert.equal(ensured.length, 1);
  assert.equal(posted.length, 1);
  assert.equal(deleted.length, 0, 'expected no delete - nothing was posted before');
  assert.equal(posted[0].topicId, 900);
  assert.ok(posted[0].text.includes('BL-1'));
  assert.ok(posted[0].text.endsWith('updated at Jul 16 20:05'), `expected a footer stamped with T1, got:\n${posted[0].text}`);
  assert.equal(state.pipelineBoard.topicId, 900);
  assert.equal(state.pipelineBoard.messageId, 42);
  assert.equal(state.pipelineBoard.lastChangeMs, T1);

  // The ticket moves from coder to QA - a content change: the old message is
  // deleted and a fresh one posted at the bottom, footer bumped to T2.
  adapters.readRoleHeldTickets = () => ({ QA: ['BL-1'] });
  await runConciergeTick(adapters, T2);

  assert.equal(ensured.length, 1, 'expected the topic to be created only once');
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].topicId, 900);
  assert.equal(deleted[0].messageId, 42);
  assert.equal(posted.length, 2, 'expected the fresh message posted as a new message, never an edit');
  assert.equal(posted[1].topicId, 900);
  assert.ok(posted[1].text.endsWith('updated at Jul 16 20:06'), `expected the footer bumped to T2, got:\n${posted[1].text}`);
  assert.equal(state.pipelineBoard.messageId, 42, 'expected the new messageId returned by postMessage, never edited in place');
  assert.equal(state.pipelineBoard.lastChangeMs, T2);

  // No stage change this tick, even though the clock advances further - a
  // complete no-op: no delete, no post, and the footer keeps showing T2.
  const postedCountBefore = posted.length;
  const deletedCountBefore = deleted.length;
  await runConciergeTick(adapters, Date.UTC(2026, 6, 16, 21, 0));
  assert.equal(posted.length, postedCountBefore, 'expected no re-post when no ticket stage changed');
  assert.equal(deleted.length, deletedCountBefore, 'expected no delete either');
  assert.equal(state.pipelineBoard.lastChangeMs, T2, 'expected the footer to stay at the last REAL content change');
});

test('BL-455: role-held tickets are joined to their backlog item epic/title - grouped by epic, and shown with a derived slug', async () => {
  const { adapters, setFolders } = fakeAdapters();
  const posted = [];
  adapters.boardAdapters.postMessage = async (topicId, text) => {
    posted.push(text);
    return 1;
  };
  adapters.boardAdapters.ensureBoardTopic = async () => 900;
  adapters.readRoleHeldTickets = () => ({ coder: ['BL-1'], QA: ['BL-2'] });
  setFolders(
    folders({
      active: [
        { id: 'BL-1', title: 'fix the pipeline board', epic: 'Concerto' },
        { id: 'BL-2', title: 'unrelated ticket' },
      ],
    })
  );

  await runConciergeTick(adapters);

  const lines = posted[0].split('\n');
  // Break-then-fix would show this line missing/empty if the join were
  // dropped - the epic heading and slug only appear when folders.active's
  // epic/title actually reach computePipelineBoard, proving the wiring load-
  // bearing rather than the pure function's own (separately unit-tested)
  // grouping logic.
  const concertoIndex = lines.findIndex((l) => l.includes('Concerto'));
  assert.ok(concertoIndex >= 0, `expected a Concerto epic heading, got:\n${posted[0]}`);
  assert.ok(lines[concertoIndex + 1].startsWith('BL-1'), 'expected BL-1 grouped directly under its epic heading');
  // BL-465: the grid's own slug column now shows a SHORT (2-3 word) kebab
  // slug, not the full title - "fix the pipeline board" -> "fix-the-pipeline".
  assert.ok(posted[0].includes('fix-the-pipeline'), 'expected BL-1 row to carry its derived kebab slug');
  assert.ok(posted[0].includes('unrelated-ticket'), 'expected BL-2 (no epic) to still carry its own kebab slug');
  const noEpicIndex = lines.findIndex((l) => l.trim() === '-- (no epic) --');
  assert.ok(noEpicIndex > concertoIndex, 'expected the no-epic group to sort after the named epic group');
});

test('BL-455: a paused ticket awaiting human approval and a plain paused ticket both render in the below-grid parked list, not as grid rows', async () => {
  const { adapters, setFolders } = fakeAdapters();
  const posted = [];
  adapters.boardAdapters.postMessage = async (topicId, text) => {
    posted.push(text);
    return 1;
  };
  adapters.boardAdapters.ensureBoardTopic = async () => 900;
  setFolders(
    folders({
      paused: [
        { id: 'BL-2', title: 'blocked', humanApproval: 'pending' },
        { id: 'BL-3', title: 'on hold' },
      ],
    })
  );

  await runConciergeTick(adapters);

  const lines = posted[0].split('\n');
  // BL-465: awaiting-approval now gets its OWN section (no per-line AA/PK
  // label anymore) - the section header itself is the label.
  const parkedHeaderIndex = lines.findIndex((l) => l.trim() === 'PARKED:');
  const awaitingHeaderIndex = lines.findIndex((l) => l.trim() === 'AWAITING APPROVAL:');
  assert.ok(parkedHeaderIndex > 0, `expected a PARKED: section, got:\n${posted[0]}`);
  assert.ok(awaitingHeaderIndex > 0, `expected an AWAITING APPROVAL: section, got:\n${posted[0]}`);
  const gridLines = lines.slice(0, Math.min(parkedHeaderIndex, awaitingHeaderIndex));
  assert.ok(!gridLines.some((l) => l.trim().split(/\s+/)[0] === 'BL-2'), 'expected BL-2 absent from the grid');
  assert.ok(!gridLines.some((l) => l.trim().split(/\s+/)[0] === 'BL-3'), 'expected BL-3 absent from the grid');
  // The nearest SECTION HEADER preceding a given line is that line's own
  // section - the label BL-455's old per-line PK/AA glyphs used to carry.
  const sectionFor = (lineIndex) => {
    for (let i = lineIndex - 1; i >= 0; i -= 1) {
      if (lines[i].trim().endsWith(':')) {
        return lines[i].trim();
      }
    }
    return undefined;
  };
  const bl2Index = lines.findIndex((l) => l.includes('BL-2'));
  const bl3Index = lines.findIndex((l) => l.includes('BL-3'));
  assert.ok(!lines[bl2Index].trim().startsWith('AA') && !lines[bl2Index].trim().startsWith('PK'), `expected no per-line AA/PK label, got: ${lines[bl2Index]}`);
  assert.equal(sectionFor(bl2Index), 'AWAITING APPROVAL:', 'expected BL-2 under its own AWAITING APPROVAL: section');
  assert.equal(sectionFor(bl3Index), 'PARKED:', 'expected BL-3 under the PARKED: section');
});

test('BL-452: omitting readRoleHeldTickets/boardAdapters entirely leaves the tick unaffected - existing adapters fixtures built before this field existed keep working unchanged', async () => {
  const { adapters, state } = fakeAdapters();
  delete adapters.readRoleHeldTickets;
  delete adapters.boardAdapters;

  await runConciergeTick(adapters);

  assert.equal(state.pipelineBoard, undefined);
});

// ── BL-465: root-intake / recently-closed / GitHub link list wiring ──────

test('BL-465: omitting readRootIntakeFiles/readRepoBaseUrl entirely leaves the board tick unaffected - existing fixtures built before these fields existed keep working unchanged', async () => {
  const { adapters, setFolders } = fakeAdapters();
  const posted = [];
  adapters.boardAdapters.postMessage = async (topicId, text) => {
    posted.push(text);
    return 1;
  };
  adapters.boardAdapters.ensureBoardTopic = async () => 900;
  adapters.readRoleHeldTickets = () => ({ coder: ['BL-1'] });
  setFolders(folders({ active: [{ id: 'BL-1', title: 'fix the widget' }] }));

  await runConciergeTick(adapters);

  assert.equal(posted.length, 1);
  assert.ok(!posted[0].includes('ROOT INTAKE'));
});

test('BL-465: readRootIntakeFiles feeds the board\'s own ROOT INTAKE: section', async () => {
  const { adapters, setFolders } = fakeAdapters();
  const posted = [];
  adapters.boardAdapters.postMessage = async (topicId, text) => {
    posted.push(text);
    return 1;
  };
  adapters.boardAdapters.ensureBoardTopic = async () => 900;
  adapters.readRoleHeldTickets = () => ({});
  adapters.readRootIntakeFiles = () => [{ id: 'INTAKE-1', title: 'a raw ask', filename: 'INTAKE-1.md' }];
  setFolders(folders());

  await runConciergeTick(adapters);

  assert.ok(posted[0].includes('ROOT INTAKE:'), `expected a ROOT INTAKE: section, got:\n${posted[0]}`);
  assert.ok(posted[0].includes('INTAKE-1'));
});

test('BL-465: folders.done feeds the board\'s own RECENTLY CLOSED: section directly - no extra adapter needed', async () => {
  const { adapters, setFolders } = fakeAdapters();
  const posted = [];
  adapters.boardAdapters.postMessage = async (topicId, text) => {
    posted.push(text);
    return 1;
  };
  adapters.boardAdapters.ensureBoardTopic = async () => 900;
  adapters.readRoleHeldTickets = () => ({});
  setFolders(folders({ done: [{ id: 'BL-9', title: 'shipped thing', filename: 'BL-9-shipped-thing.yaml' }] }));

  await runConciergeTick(adapters);

  assert.ok(posted[0].includes('RECENTLY CLOSED:'), `expected a RECENTLY CLOSED: section, got:\n${posted[0]}`);
  assert.ok(posted[0].includes('BL-9'));
});

// BL-465 bounce (architect review): folders.done carries NO ordering
// guarantee (it is a plain directory listing) and is emphatically NOT
// closure recency - RECENTLY CLOSED must sort by when each ticket ACTUALLY
// transitioned into folders.done (this tick's own nowMs, stamped once per
// ticket the first time it is observed there), never by whatever order
// folders.done happens to hand back. Constructed so folder-array order and
// true closure order DISAGREE: BL-9 sits FIRST in folders.done (closed on
// the earlier tick) while BL-1 sits SECOND (closed on the later tick) - a
// buggy "just filter, never sort" implementation would render BL-9 before
// BL-1, the wrong order.
test('BL-465 bounce: RECENTLY CLOSED sorts by actual closure recency, never by folders.done listing order', async () => {
  const { adapters, setFolders } = fakeAdapters();
  const posted = [];
  adapters.boardAdapters.postMessage = async (topicId, text) => {
    posted.push(text);
    return 1;
  };
  adapters.boardAdapters.ensureBoardTopic = async () => 900;
  adapters.readRoleHeldTickets = () => ({});

  // Tick 1 (t=1000): only BL-9 is done.
  setFolders(folders({ done: [{ id: 'BL-9', title: 'shipped thing', filename: 'BL-9-shipped-thing.yaml' }] }));
  await runConciergeTick(adapters, 1000);

  // Tick 2 (t=2000): BL-1 newly closes. It is placed FIRST in folders.done
  // (array order), but it closed SECOND (later, more recently) than BL-9.
  setFolders(
    folders({
      done: [
        { id: 'BL-1', title: 'closed later, listed first', filename: 'BL-1-later.yaml' },
        { id: 'BL-9', title: 'shipped thing', filename: 'BL-9-shipped-thing.yaml' },
      ],
    })
  );
  await runConciergeTick(adapters, 2000);

  const last = posted[posted.length - 1];
  const idxBL1 = last.indexOf('BL-1');
  const idxBL9 = last.indexOf('BL-9');
  assert.ok(idxBL1 !== -1 && idxBL9 !== -1, `expected both tickets in the recently-closed section, got:\n${last}`);
  assert.ok(idxBL1 < idxBL9, `expected the MORE RECENTLY closed BL-1 (t=2000) listed before BL-9 (t=1000); got:\n${last}`);
});

// A ticket already sitting in folders.done on the VERY FIRST tick this
// feature ever runs (no prior snapshot) has no way to know its true
// historical close time - it gets stamped with that first tick's own nowMs,
// same as every OTHER pre-existing done ticket observed that same tick
// (the same one-time eventual-consistency gap BL-418's own
// standingIconSeenIds backfill precedent accepts). Proven here via a
// SECOND, later-closing ticket that must still sort strictly after it.
test('BL-465 bounce: a ticket newly closing on a LATER tick still outranks one already done on the FIRST tick', async () => {
  const { adapters, setFolders } = fakeAdapters();
  const posted = [];
  adapters.boardAdapters.postMessage = async (topicId, text) => {
    posted.push(text);
    return 1;
  };
  adapters.boardAdapters.ensureBoardTopic = async () => 900;
  adapters.readRoleHeldTickets = () => ({});

  // Tick 1 (t=500): BL-2 is ALREADY done (no prior snapshot - first-ever
  // tick), so it gets stamped with t=500 despite its real historical close
  // time being unknown.
  setFolders(folders({ done: [{ id: 'BL-2', title: 'pre-existing done ticket', filename: 'BL-2-pre.yaml' }] }));
  await runConciergeTick(adapters, 500);

  // Tick 2 (t=9000): BL-3 closes much later.
  setFolders(
    folders({
      done: [
        { id: 'BL-2', title: 'pre-existing done ticket', filename: 'BL-2-pre.yaml' },
        { id: 'BL-3', title: 'closes much later', filename: 'BL-3-later.yaml' },
      ],
    })
  );
  await runConciergeTick(adapters, 9000);

  const last = posted[posted.length - 1];
  const idxBL2 = last.indexOf('BL-2');
  const idxBL3 = last.indexOf('BL-3');
  assert.ok(idxBL2 !== -1 && idxBL3 !== -1, `expected both tickets in the recently-closed section, got:\n${last}`);
  assert.ok(idxBL3 < idxBL2, `expected the later-closing BL-3 (t=9000) listed before the first-tick BL-2 (t=500); got:\n${last}`);
});

test('BL-465: readRepoBaseUrl feeds the below-grid GitHub link list, appended after the closing </pre>', async () => {
  const { adapters, setFolders } = fakeAdapters();
  const posted = [];
  adapters.boardAdapters.postMessage = async (topicId, text, linksHtml) => {
    posted.push(wrapPipelineBoardHtml(text, linksHtml));
    return 1;
  };
  adapters.boardAdapters.ensureBoardTopic = async () => 900;
  adapters.readRoleHeldTickets = () => ({ coder: ['BL-1'] });
  adapters.readRepoBaseUrl = () => 'https://github.com/ldecorps/swarmforgevc';
  setFolders(folders({ active: [{ id: 'BL-1', title: 'fix the widget', filename: 'BL-1-fix-the-widget.yaml' }] }));

  await runConciergeTick(adapters);

  assert.ok(posted[0].includes('</pre>'));
  const [, afterPre] = posted[0].split('</pre>');
  assert.ok(afterPre.includes('<a href="https://github.com/ldecorps/swarmforgevc/blob/main/backlog/active/BL-1-fix-the-widget.yaml">'));
});

test('BL-465: no readRepoBaseUrl means no link list at all, even with active rows', async () => {
  const { adapters, setFolders } = fakeAdapters();
  const posted = [];
  adapters.boardAdapters.postMessage = async (topicId, text, linksHtml) => {
    posted.push(wrapPipelineBoardHtml(text, linksHtml));
    return 1;
  };
  adapters.boardAdapters.ensureBoardTopic = async () => 900;
  adapters.readRoleHeldTickets = () => ({ coder: ['BL-1'] });
  setFolders(folders({ active: [{ id: 'BL-1', title: 'fix the widget', filename: 'BL-1-fix-the-widget.yaml' }] }));

  await runConciergeTick(adapters);

  assert.ok(!posted[0].includes('<a href'));
});

// ── BL-434: Approvals topic roster wiring ─────────────────────────────────

test('BL-434 approvals-standing-topic-04: the Approvals roster is posted once, then edited in place as the pending set grows', async () => {
  const { adapters, state, setFolders } = fakeAdapters();
  const ensured = [];
  const posted = [];
  const edited = [];
  adapters.rosterAdapters = {
    ensureApprovalsTopic: async () => {
      ensured.push(true);
      return 750;
    },
    postMessage: async (topicId, text) => {
      posted.push({ topicId, text });
      return 42;
    },
    editMessage: async (topicId, messageId, text) => {
      edited.push({ topicId, messageId, text });
      return true;
    },
  };
  setFolders(folders({ paused: [{ id: 'BL-433', title: 'first', humanApproval: 'pending' }] }));

  await runConciergeTick(adapters);

  assert.equal(ensured.length, 1);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].topicId, 750);
  assert.ok(posted[0].text.includes('BL-433'));
  assert.equal(state.approvalsRoster.topicId, 750);
  assert.equal(state.approvalsRoster.messageId, 42);

  // A second ticket enters the pending set - same topic/message, edited in place.
  setFolders(
    folders({
      paused: [
        { id: 'BL-433', title: 'first', humanApproval: 'pending' },
        { id: 'BL-440', title: 'second', humanApproval: 'pending' },
      ],
    })
  );
  await runConciergeTick(adapters);

  assert.equal(ensured.length, 1, 'expected the topic to be created only once');
  assert.equal(posted.length, 1, 'expected no second message ever posted');
  assert.equal(edited.length, 1);
  assert.equal(edited[0].topicId, 750);
  assert.equal(edited[0].messageId, 42);
  assert.ok(edited[0].text.includes('BL-433'));
  assert.ok(edited[0].text.includes('BL-440'), 'BL-434 approvals-standing-topic-04: the roster lists BOTH pending tickets');

  // No pending-set change this tick - the message is not re-edited.
  await runConciergeTick(adapters);
  assert.equal(edited.length, 1, 'expected no re-edit when the pending set did not change');
});

test('BL-434 approvals-standing-topic-05: once acted on, a ticket is removed from the Approvals topic roster', async () => {
  const { adapters, setFolders } = fakeAdapters();
  const edited = [];
  adapters.rosterAdapters = {
    ensureApprovalsTopic: async () => 750,
    postMessage: async () => 42,
    editMessage: async (topicId, messageId, text) => {
      edited.push({ topicId, messageId, text });
      return true;
    },
  };
  setFolders(folders({ paused: [{ id: 'BL-433', title: 'first', humanApproval: 'pending' }] }));
  await runConciergeTick(adapters);

  // The ticket is acted on (approved) - its humanApproval leaves 'pending',
  // the same live-state transition recordApprovalReply itself performs.
  setFolders(folders({ active: [{ id: 'BL-433', title: 'first', humanApproval: 'approved' }] }));
  await runConciergeTick(adapters);

  assert.equal(edited.length, 1);
  assert.ok(!edited[0].text.includes('BL-433'), 'expected BL-433 removed from the roster once no longer pending');
});

test('BL-434: omitting rosterAdapters entirely leaves the tick unaffected - existing adapters fixtures built before this field existed keep working unchanged', async () => {
  const { adapters, state, setFolders } = fakeAdapters();
  delete adapters.rosterAdapters;
  setFolders(folders({ paused: [{ id: 'BL-433', title: 'first', humanApproval: 'pending' }] }));

  await runConciergeTick(adapters);

  assert.equal(state.approvalsRoster, undefined);
});

// ── BL-450: Recert topic posting wiring ───────────────────────────────────

function scenario(overrides = {}) {
  return { id: 'BL-207-thing-01', ticketId: 'BL-207', ticketTitle: 'a fine ticket', name: 'thing', text: 'Given a', ...overrides };
}

test('recert-telegram-01: the oldest un-reviewed scenario is posted into the Recert topic, one at a time', async () => {
  const { adapters, state } = fakeAdapters();
  const created = [];
  const posted = [];
  let current = scenario();
  adapters.readRecertScenario = () => current;
  adapters.recertPostingAdapters = {
    ensureRecertTopic: async () => {
      created.push(true);
      return 900;
    },
    postMessage: async (topicId, text) => {
      posted.push({ topicId, text });
      return 42;
    },
    editMessage: async () => true,
  };

  await runConciergeTick(adapters);

  assert.equal(created.length, 1);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].topicId, 900);
  assert.ok(posted[0].text.includes('BL-207-thing-01'));
  assert.equal(state.recertPosted.topicId, 900);
  assert.equal(state.recertPosted.messageId, 42);
});

test('recert-telegram-02: an already-posted scenario is not re-posted on the next tick', async () => {
  const { adapters } = fakeAdapters();
  const posted = [];
  const edited = [];
  adapters.readRecertScenario = () => scenario();
  adapters.recertPostingAdapters = {
    ensureRecertTopic: async () => 900,
    postMessage: async (topicId, text) => {
      posted.push({ topicId, text });
      return 42;
    },
    editMessage: async (topicId, messageId, text) => {
      edited.push({ topicId, messageId, text });
      return true;
    },
  };

  await runConciergeTick(adapters);
  assert.equal(posted.length, 1);

  await runConciergeTick(adapters);
  assert.equal(posted.length, 1, 'expected no second post for the same still-oldest scenario');
  assert.equal(edited.length, 0, 'expected no edit either - the rendered text is unchanged');
});

test('once the posted scenario changes (e.g. it was validated away), the SAME message is edited in place', async () => {
  const { adapters } = fakeAdapters();
  const posted = [];
  const edited = [];
  let current = scenario();
  adapters.readRecertScenario = () => current;
  adapters.recertPostingAdapters = {
    ensureRecertTopic: async () => 900,
    postMessage: async (topicId, text) => {
      posted.push({ topicId, text });
      return 42;
    },
    editMessage: async (topicId, messageId, text) => {
      edited.push({ topicId, messageId, text });
      return true;
    },
  };

  await runConciergeTick(adapters);
  current = scenario({ id: 'BL-300-other-01', ticketTitle: 'a different ticket', text: 'Given x' });
  await runConciergeTick(adapters);

  assert.equal(posted.length, 1, 'expected no second NEW message ever posted');
  assert.equal(edited.length, 1);
  assert.equal(edited[0].topicId, 900);
  assert.equal(edited[0].messageId, 42);
  assert.ok(edited[0].text.includes('BL-300-other-01'));
});

test('recert-telegram-08: nothing is posted when no scenario needs recertification', async () => {
  const { adapters, state } = fakeAdapters();
  const created = [];
  const posted = [];
  adapters.readRecertScenario = () => undefined;
  adapters.recertPostingAdapters = {
    ensureRecertTopic: async () => {
      created.push(true);
      return 900;
    },
    postMessage: async (topicId, text) => {
      posted.push({ topicId, text });
      return 42;
    },
    editMessage: async () => true,
  };

  await runConciergeTick(adapters);

  assert.deepEqual(created, []);
  assert.deepEqual(posted, []);
  // syncRecertPosting's own no-scenario short-circuit returns `prevState ??
  // {}` (the same "empty but touched" idiom syncEditInPlaceMessage's other
  // no-op branches already use) - distinct from recertPostingAdapters being
  // OMITTED ENTIRELY (the next test below), where the prior state is left
  // completely untouched (stays undefined).
  assert.deepEqual(state.recertPosted, {});
});

test('BL-450: omitting recertPostingAdapters entirely leaves the tick unaffected - existing adapters fixtures built before this field existed keep working unchanged', async () => {
  const { adapters, state } = fakeAdapters();
  delete adapters.recertPostingAdapters;
  adapters.readRecertScenario = () => scenario();

  await runConciergeTick(adapters);

  assert.equal(state.recertPosted, undefined);
});
