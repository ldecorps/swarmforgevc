const assert = require('node:assert/strict');
const { decideTopicAction, routeEvent, topicNameForItem, messageTextForEvent, backlogForTopic, completionSummaryText } = require('../out/concierge/topicRouter');
const { parseBacklogYaml } = require('../out/panel/backlogReader');

function event(overrides = {}) {
  return { type: 'TaskStarted', backlogId: 'BL-123', payload: {}, ...overrides };
}

// ── decideTopicAction (pure) ──────────────────────────────────────────────

test('decideTopicAction creates a topic named "BL-### - <title>" when the item has no mapping yet', () => {
  const action = decideTopicAction(event(), {}, 'a fine feature');
  assert.deepEqual(action, { kind: 'create', topicName: 'BL-123 - a fine feature', text: 'TaskStarted: BL-123' });
});

test('decideTopicAction reuses the mapped topic id when one already exists', () => {
  const action = decideTopicAction(event(), { 'BL-123': 42 }, 'a fine feature');
  assert.deepEqual(action, { kind: 'reuse', topicId: 42, text: 'TaskStarted: BL-123' });
});

test('decideTopicAction only ever looks at ITS OWN backlogId entry, never another item\'s', () => {
  const action = decideTopicAction(event({ backlogId: 'BL-999' }), { 'BL-123': 42 }, 'unrelated title');
  assert.equal(action.kind, 'create');
});

test('topicNameForItem / messageTextForEvent are pure helpers', () => {
  assert.equal(topicNameForItem('BL-1', 'fix the thing'), 'BL-1 - fix the thing');
  assert.equal(messageTextForEvent(event({ type: 'NeedsApproval' })), 'NeedsApproval: BL-123');
});

test('BL-325: messageTextForEvent appends a NeedsApproval snippet so the message states the question, not just the id', () => {
  const text = messageTextForEvent(event({ type: 'NeedsApproval', payload: { snippet: 'Proceed with the migration? (y/n)' } }));
  assert.equal(text, 'NeedsApproval: BL-123 - Proceed with the migration? (y/n)');
  assert.notEqual(text, 'NeedsApproval: BL-123');
});

test('BL-325: a non-string payload.snippet is ignored, never crashes or leaks [object Object]', () => {
  assert.equal(messageTextForEvent(event({ type: 'NeedsApproval', payload: { snippet: 42 } })), 'NeedsApproval: BL-123');
});

// ── BL-358: untagged NeedsApproval (backlogId null, role set) ────────────

test('BL-358: messageTextForEvent names the role instead of a ticket id when untagged', () => {
  assert.equal(messageTextForEvent(untaggedEvent()), 'NeedsApproval: coder');
});

test('BL-358: an untagged NeedsApproval still carries its snippet, same as a tagged one', () => {
  const text = messageTextForEvent(untaggedEvent({ payload: { snippet: 'Which design should I pick? (1/2/3)' } }));
  assert.equal(text, 'NeedsApproval: coder - Which design should I pick? (1/2/3)');
});

test('BL-358: decideTopicAction refuses an untagged event - routeEvent must route it elsewhere, never through here', () => {
  assert.throws(() => decideTopicAction(untaggedEvent(), {}, 'irrelevant'), /requires a tagged event/);
});

// BL-322 hardening: the ticket's own E2E procedure insists on a REAL
// oversized ticket, "not a synthetic short fixture, the bug is precisely
// about real notes being huge" - but neither the delivered unit tests nor
// the acceptance suite ever fed a REAL parsed backlog file through
// messageTextForEvent's own render/truncate path (the acceptance suite's
// fixtures are hand-built {title, notes, firstAcceptanceStep} objects that
// bypass backlogReader.ts entirely). This is a verbatim excerpt of a real,
// large, shipped ticket's own notes: block (BL-324, ~11KB on disk) - real
// backticks, em-dashes, and nested formatting a synthetic fixture would
// never produce - parsed by the REAL backlogReader.ts and rendered by the
// REAL topicRouter.ts end to end, proving the two modules compose
// correctly against real ticket prose, not just against each other's own
// synthetic unit fixtures.
const REAL_OVERSIZED_TICKET_YAML = [
  'id: BL-324',
  'title: "Per-role lifecycle: actually park the roles a ticket does not need, and bring them back when it does"',
  'status: active',
  'notes: |',
  '  WHY IT IS ITS OWN TICKET. The dynamic-per-ticket-agent-routing epic has four slices:',
  '  (1) auto-hibernate on drain — BL-307 shipped, but BL-318 says it can never fire;',
  '  (2) routing manifest `roles:` field — BL-317, active; (3) per-role lifecycle — THIS,',
  '  previously not ticketed at all, existing only as a sentence inside BL-317\'s notes;',
  '  (4) warm-core/break-even tuning — still not ticketed.',
  '',
  '  BL-317 records which roles a ticket needs and DELIBERATELY brings nothing up or down.',
  '  So when BL-317 lands, nothing changes operationally — no agent parked, no token saved.',
  '  The manifest is INERT without this slice. That is precisely this project\'s own',
  '  "a foundation slice needs its wiring slice TRACKED, not assumed" rule.',
  '',
  '  WHAT IT MUST DO. On promote, read the ticket\'s `roles:` manifest (BL-317) and bring the',
  '  swarm to exactly that shape: start the roles the ticket needs, park the ones it does',
  '  not. Park = remove the role from `.swarmforge/roles.tsv` and kill its pane. This is the',
  '  Operator\'s proven mechanism, not a new one: an absent roster entry means',
  '  `dead-agent-events` does not fire AGENT_EXITED, so there is no respawn fight.',
  '',
  '  REUSE, DO NOT REINVENT: `operator_lib.bb`\'s `role-idle?` (empty inbox/new, nothing',
  '  in_process); BL-307\'s `hibernate-swarm!` — this is its PER-ROLE SIBLING, not a second',
  '  mechanism; `.swarmforge/roles.tsv` as the single source of truth for who is expected',
  '  to be alive.',
  '',
  '  HARD DEPENDENCY — DO NOT BUILD BEFORE BL-323 LANDS. This slice systematically creates',
  '  the exact stall BL-323 fixes. Parking roles on a schedule means killing',
  '  claimed-but-unfinished parcels AS A MATTER OF ROUTINE; without resume-on-start, that',
  '  converts a rare accident into a DESIGNED-IN failure mode.',
  'acceptance:',
  '  feature: specs/features/BL-324-per-role-lifecycle-park-unneeded-roles.feature',
  '  steps:',
  '    - "A ticket\'s manifest shapes the swarm to exactly the roles it needs"',
  '    - "A parked role comes back when a later ticket needs it"',
].join('\n');

test('BL-322 real-fixture: a REAL oversized ticket file, parsed by the real backlogReader and rendered by the real topicRouter, truncates correctly end to end', () => {
  const item = parseBacklogYaml(REAL_OVERSIZED_TICKET_YAML);
  assert.ok(item.notes.length > 1000, 'expected the real notes: excerpt to genuinely exceed the message cap on its own');

  const text = messageTextForEvent(
    event({ payload: { title: item.title, notes: item.notes, firstAcceptanceStep: item.firstAcceptanceStep } })
  );

  assert.ok(text.startsWith(`What it is: ${item.title}`), `expected the real title to lead the message, got: ${text.slice(0, 120)}`);
  assert.ok(text.includes('…'), 'expected the real oversized notes to be truncated with an ellipsis');
  assert.ok(text.length < 4096, `expected the rendered message under Telegram's 4096-char limit, got ${text.length}`);
  assert.ok(
    !text.includes('DESIGNED-IN failure mode'),
    'expected only the FIRST paragraph of the real notes, not the whole multi-paragraph block'
  );
});

// ── backlogForTopic (pure) — BL-298: the inverse of the forward map ───────

test('BL-298: backlogForTopic resolves a mapped topic id back to ITS OWN backlog item', () => {
  assert.equal(backlogForTopic({ 'BL-123': 42, 'BL-456': 43 }, 42), 'BL-123');
  assert.equal(backlogForTopic({ 'BL-123': 42, 'BL-456': 43 }, 43), 'BL-456');
});

test('BL-298: backlogForTopic returns undefined for an unmapped topic id (never a crash)', () => {
  assert.equal(backlogForTopic({ 'BL-123': 42 }, 999), undefined);
});

test('BL-298: backlogForTopic returns undefined for topicId undefined (a DM has no topic at all)', () => {
  assert.equal(backlogForTopic({ 'BL-123': 42 }, undefined), undefined);
});

// ── routeEvent (adapter-injected) — BL-297 topic-routing-01/02/03 ────────

function fakeAdapters(initialMap = {}) {
  const map = { ...initialMap };
  const created = [];
  const sent = [];
  const closed = [];
  const recorded = [];
  let operatorTopicId = 700;
  const ensureOperatorTopicCalls = [];
  return {
    map,
    created,
    sent,
    closed,
    recorded,
    ensureOperatorTopicCalls,
    setOperatorTopicId: (id) => {
      operatorTopicId = id;
    },
    adapters: {
      getTopicMap: () => map,
      createTopic: async (name) => {
        created.push(name);
        return { success: true, topicId: 500 + created.length };
      },
      recordTopicId: (backlogId, topicId) => {
        map[backlogId] = topicId;
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
      ensureOperatorTopic: async () => {
        ensureOperatorTopicCalls.push(true);
        return operatorTopicId;
      },
    },
  };
}

function untaggedEvent(overrides = {}) {
  return { type: 'NeedsApproval', backlogId: null, role: 'coder', payload: {}, ...overrides };
}

test('topic-routing-01: the first event for an unmapped item creates a topic once and records the mapping', async () => {
  const { adapters, created, sent, map } = fakeAdapters();
  const result = await routeEvent(event(), 'a fine feature', adapters);
  assert.deepEqual(created, ['BL-123 - a fine feature']);
  assert.equal(map['BL-123'], 501);
  assert.deepEqual(sent, [{ topicId: 501, text: 'TaskStarted: BL-123' }]);
  assert.deepEqual(result, { posted: true, skipped: false });
});

test('topic-routing-01: a later (non-completion) event for the SAME item reuses the topic - no second create', async () => {
  const { adapters, created, sent } = fakeAdapters();
  await routeEvent(event(), 'a fine feature', adapters);
  await routeEvent(event({ type: 'NeedsApproval' }), 'a fine feature', adapters);
  assert.equal(created.length, 1, 'expected exactly one createTopic call across both events');
  assert.deepEqual(sent, [
    { topicId: 501, text: 'TaskStarted: BL-123' },
    { topicId: 501, text: 'NeedsApproval: BL-123' },
  ]);
});

test('topic-routing-02: every sendMessage call carries a concrete topicId - the adapter signature has no main-chat path at all', async () => {
  const { adapters, sent } = fakeAdapters();
  await routeEvent(event(), 'a fine feature', adapters);
  assert.equal(sent.length, 1);
  assert.equal(typeof sent[0].topicId, 'number');
});

test('topic-routing-03: the posted message states the event\'s type', async () => {
  const { adapters, sent } = fakeAdapters();
  await routeEvent(event({ type: 'NeedsApproval' }), 'a fine feature', adapters);
  assert.match(sent[0].text, /NeedsApproval/);
});

test('a topic-create failure skips the event - never a fallback post', async () => {
  const map = {};
  const sent = [];
  const adapters = {
    getTopicMap: () => map,
    createTopic: async () => ({ success: false }),
    recordTopicId: () => {
      throw new Error('recordTopicId should never be called when create fails');
    },
    sendMessage: async (topicId, text) => {
      sent.push({ topicId, text });
      return true;
    },
    recordMessage: () => {
      throw new Error('recordMessage should never be called when create fails');
    },
  };
  const result = await routeEvent(event(), 'a fine feature', adapters);
  assert.deepEqual(result, { posted: false, skipped: true });
  assert.deepEqual(sent, []);
  assert.deepEqual(map, {});
});

test('a topic-create success with no topicId also skips (never posts with an undefined thread)', async () => {
  const sent = [];
  const adapters = {
    getTopicMap: () => ({}),
    createTopic: async () => ({ success: true }),
    recordTopicId: () => {
      throw new Error('recordTopicId should never be called with no topicId');
    },
    sendMessage: async (topicId, text) => {
      sent.push({ topicId, text });
      return true;
    },
    recordMessage: () => {
      throw new Error('recordMessage should never be called with no topicId');
    },
  };
  const result = await routeEvent(event(), 'a fine feature', adapters);
  assert.deepEqual(result, { posted: false, skipped: true });
  assert.deepEqual(sent, []);
});

test('a failed sendMessage reports posted:false but is not itself a skip (the topic exists, delivery just failed)', async () => {
  const { adapters, map, recorded } = fakeAdapters({ 'BL-123': 42 });
  adapters.sendMessage = async () => false;
  const result = await routeEvent(event(), 'a fine feature', adapters);
  assert.deepEqual(result, { posted: false, skipped: false });
  assert.equal(map['BL-123'], 42);
  assert.deepEqual(recorded, [], 'a failed send must never be recorded into the ticket\'s own durable record');
});

// ── routeEvent untagged-gate path (BL-358) ────────────────────────────────

test('BL-358: an untagged NeedsApproval routes to the standing Operator topic, never creates or reuses a per-ticket topic', async () => {
  const { adapters, created, sent, map, ensureOperatorTopicCalls } = fakeAdapters();
  const result = await routeEvent(untaggedEvent(), 'irrelevant', adapters);
  assert.deepEqual(created, [], 'no per-ticket topic should ever be created for an untagged event');
  assert.deepEqual(map, {}, 'the per-ticket BacklogTopicMap must never gain an entry for an untagged event');
  assert.deepEqual(sent, [{ topicId: 700, text: 'NeedsApproval: coder' }]);
  assert.equal(ensureOperatorTopicCalls.length, 1);
  assert.deepEqual(result, { posted: true, skipped: false });
});

test('BL-358: an untagged NeedsApproval is never recorded into the per-ticket blTopicStore (it belongs to no ticket)', async () => {
  const { adapters, recorded } = fakeAdapters();
  await routeEvent(untaggedEvent(), 'irrelevant', adapters);
  assert.deepEqual(recorded, []);
});

test('BL-358: a failed Operator-topic creation skips the event, never falls back anywhere else', async () => {
  const { adapters, sent } = fakeAdapters();
  adapters.ensureOperatorTopic = async () => undefined;
  const result = await routeEvent(untaggedEvent(), 'irrelevant', adapters);
  assert.deepEqual(result, { posted: false, skipped: true });
  assert.deepEqual(sent, []);
});

test('BL-358: a failed send to an existing Operator topic reports posted:false but is not a skip', async () => {
  const { adapters } = fakeAdapters();
  adapters.sendMessage = async () => false;
  const result = await routeEvent(untaggedEvent(), 'irrelevant', adapters);
  assert.deepEqual(result, { posted: false, skipped: false });
});

test('BL-358: a tagged event still routes through the ordinary per-ticket path, unaffected (regression)', async () => {
  const { adapters, created, ensureOperatorTopicCalls } = fakeAdapters();
  await routeEvent(event(), 'a fine feature', adapters);
  assert.deepEqual(created, ['BL-123 - a fine feature']);
  assert.equal(ensureOperatorTopicCalls.length, 0, 'a tagged event must never touch the Operator topic');
});

// ── recordMessage (BL-329: outbound serialisation) ─────────────────────────
// Only ever called after a GENUINELY successful sendMessage - mirrors
// emittedKeys' own "only record what actually posted" convention (BL-322).

test('BL-329: a successful send on the reuse path is recorded with the exact backlogId and text', async () => {
  const { adapters, recorded } = fakeAdapters({ 'BL-123': 42 });
  await routeEvent(event(), 'a fine feature', adapters);
  assert.deepEqual(recorded, [{ backlogId: 'BL-123', text: 'TaskStarted: BL-123' }]);
});

test('BL-329: a successful send on the create-topic path is ALSO recorded, not just the reuse path', async () => {
  const { adapters, recorded } = fakeAdapters();
  await routeEvent(event(), 'a fine feature', adapters);
  assert.deepEqual(recorded, [{ backlogId: 'BL-123', text: 'TaskStarted: BL-123' }]);
});

test('BL-329: multiple events for the same ticket are recorded in the order they were routed', async () => {
  const { adapters, recorded } = fakeAdapters();
  await routeEvent(event(), 'a fine feature', adapters);
  await routeEvent(event({ type: 'NeedsApproval' }), 'a fine feature', adapters);
  assert.deepEqual(recorded, [
    { backlogId: 'BL-123', text: 'TaskStarted: BL-123' },
    { backlogId: 'BL-123', text: 'NeedsApproval: BL-123' },
  ]);
});

// ── completionSummaryText (pure) — BL-299 ──────────────────────────────────

test('completionSummaryText names the item and states it is complete', () => {
  assert.equal(completionSummaryText(event({ type: 'TaskCompleted' }), 'a fine feature'), 'BL-123 - a fine feature is complete.');
});

// ── routeEvent completion path (adapter-injected) — BL-299 topic-complete-01 ──

test('topic-complete-01 [completion, has a topic]: posts a completion summary naming the item, then closes the topic', async () => {
  const { adapters, sent, closed, recorded } = fakeAdapters({ 'BL-123': 42 });
  const result = await routeEvent(event({ type: 'TaskCompleted' }), 'a fine feature', adapters);
  assert.deepEqual(sent, [{ topicId: 42, text: 'BL-123 - a fine feature is complete.' }]);
  assert.deepEqual(closed, [42]);
  assert.deepEqual(result, { posted: true, skipped: false });
  assert.deepEqual(recorded, [{ backlogId: 'BL-123', text: 'BL-123 - a fine feature is complete.' }], 'BL-329: the completion summary must be serialised too, not just posted');
});

test('topic-complete-01: the summary is posted BEFORE the topic closes (order matters - a closed topic cannot be posted into)', async () => {
  const order = [];
  const { adapters } = fakeAdapters({ 'BL-123': 42 });
  adapters.sendMessage = async (topicId, text) => {
    order.push('sendMessage');
    return true;
  };
  adapters.closeTopic = async (topicId) => {
    order.push('closeTopic');
    return true;
  };
  await routeEvent(event({ type: 'TaskCompleted' }), 'a fine feature', adapters);
  assert.deepEqual(order, ['sendMessage', 'closeTopic']);
});

test('topic-complete-01 [progress, has a topic]: a non-completion event posts its line and leaves the topic open (no close call)', async () => {
  const { adapters, sent, closed } = fakeAdapters({ 'BL-123': 42 });
  const result = await routeEvent(event({ type: 'TaskStarted' }), 'a fine feature', adapters);
  assert.deepEqual(sent, [{ topicId: 42, text: 'TaskStarted: BL-123' }]);
  assert.deepEqual(closed, []);
  assert.deepEqual(result, { posted: true, skipped: false });
});

test('topic-complete-01 [completion, has no topic]: posts nothing and closes no topic (a no-op, never creates a topic just to close it)', async () => {
  const { adapters, sent, closed, created } = fakeAdapters();
  const result = await routeEvent(event({ type: 'TaskCompleted' }), 'a fine feature', adapters);
  assert.deepEqual(sent, []);
  assert.deepEqual(closed, []);
  assert.deepEqual(created, []);
  assert.deepEqual(result, { posted: false, skipped: true });
});

test('a completed item whose summary post fails is never closed', async () => {
  const { adapters, closed, recorded } = fakeAdapters({ 'BL-123': 42 });
  adapters.sendMessage = async () => false;
  const result = await routeEvent(event({ type: 'TaskCompleted' }), 'a fine feature', adapters);
  assert.deepEqual(closed, []);
  assert.deepEqual(result, { posted: false, skipped: false });
  assert.deepEqual(recorded, [], 'a failed completion send must never be recorded either');
});
