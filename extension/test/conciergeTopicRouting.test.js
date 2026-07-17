const assert = require('node:assert/strict');
const {
  decideTopicAction,
  routeEvent,
  topicNameForItem,
  messageTextForEvent,
  backlogForTopic,
  completionSummaryText,
  decideEpicTopicAction,
  epicTopicName,
} = require('../out/concierge/topicRouter');
const { parseBacklogYaml } = require('../out/panel/backlogReader');
const { resolveTicketStatusTarget, buildTicketStatusText } = require('../out/concierge/ticketStatusMessage');

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

// ── BL-357/BL-434: ApprovalRequested ────────────────────────────────────────

test('BL-357: messageTextForEvent renders ApprovalRequested as a plain-language ask, not a bare label', () => {
  const text = messageTextForEvent(event({ type: 'ApprovalRequested' }));
  assert.match(text, /needs your approval/i);
  assert.match(text, /"approve BL-123"/);
});

test('BL-357: the ApprovalRequested ask text matches the exact keyword isApprovalReplyText recognizes', () => {
  const { isApprovalReplyText } = require('../out/concierge/pendingApprovalReply');
  const text = messageTextForEvent(event({ type: 'ApprovalRequested' }));
  assert.equal(isApprovalReplyText(text), true, 'the instruction itself must satisfy its own recognizer');
});

// BL-434: the standing Approvals topic carries many tickets at once, so the
// ask must NAME the ticket it targets - not just satisfy the bare "approve"
// substring match above, but also classify correctly through the id-aware
// Approvals-topic reply grammar.
test('BL-434: the ApprovalRequested ask names the ticket id so a reply can target it', () => {
  const { classifyApprovalsTopicReply } = require('../out/concierge/pendingApprovalReply');
  const text = messageTextForEvent(event({ type: 'ApprovalRequested', backlogId: 'BL-123' }));
  assert.match(text, /BL-123/);
  assert.deepEqual(classifyApprovalsTopicReply('approve BL-123'), { kind: 'approve', backlogId: 'BL-123' });
});

// ── BL-480: the ask carries enough ticket meat to decide ─────────────────
// approval-ask-content-01/02/03/04/05/06 - mirrors taskStartedText's own
// title/notes/firstAcceptanceStep enrichment (BL-322) above, plus
// approvalContext (BL-479's field). The frozen "<id> needs your approval...
// Reply here with..." line is ALWAYS the exact pre-change sentence, appended
// after any enrichment - this both satisfies approval-ask-content-02's
// byte-identical requirement and preserves the "needs your approval"
// substring the five sibling step files (bl408/409/410/434,
// pendingApprovalAsksInTopicSteps.js) locate the ask by.
const FROZEN_ASK_LINE = 'BL-123 needs your approval before it can proceed. Reply here with "approve BL-123" (or "reject BL-123 <reason>") to act.';

test('approval-ask-content-01: the ask names the ticket id and title, states what it solves, and states the acceptance signal', () => {
  const text = messageTextForEvent(
    event({
      type: 'ApprovalRequested',
      payload: { title: 'a fine feature', notes: 'This fixes the widget.\n\nSecond paragraph.', firstAcceptanceStep: 'The first step' },
    })
  );
  assert.match(text, /BL-123 — a fine feature/);
  assert.match(text, /What it solves: This fixes the widget\./);
  assert.match(text, /First acceptance signal: The first step/);
  assert.ok(!text.includes('Second paragraph'), 'expected only the first paragraph of notes, same as taskStartedText');
  assert.ok(text.length > FROZEN_ASK_LINE.length, 'expected more than the bare pre-change id-plus-reply-grammar line');
  assert.match(
    text,
    /^BL-123 — a fine feature\nWhat it solves: This fixes the widget\.\nFirst acceptance signal: The first step\n/,
    'expected each rendered field on its own line, same buildSummaryBody line-join as taskStartedText'
  );
});

test('approval-ask-content-02: the frozen reply-grammar line and buttons stay byte-identical', () => {
  const { decideTopicAction } = require('../out/concierge/topicRouter');
  const withSummary = event({
    type: 'ApprovalRequested',
    payload: { title: 'a fine feature', notes: 'This fixes the widget.', firstAcceptanceStep: 'The first step' },
  });
  const text = messageTextForEvent(withSummary);
  assert.ok(text.includes(FROZEN_ASK_LINE), `expected the frozen reply-grammar line verbatim, got: ${text}`);

  const action = decideTopicAction(withSummary, {}, 'a fine feature');
  assert.deepEqual(action.buttons, [
    [
      { text: 'Approve', callbackData: 'approve:BL-123' },
      { text: 'Amend', callbackData: 'amend:BL-123' },
      { text: 'Reject', callbackData: 'reject:BL-123' },
      { text: 'Expedite', callbackData: 'expedite:BL-123' },
    ],
  ]);
});

test('approval-ask-content-03: an approval_context, when present, is included in the ask', () => {
  const text = messageTextForEvent(
    event({
      type: 'ApprovalRequested',
      payload: { title: 'a fine feature', approvalContext: 'Human sign-off needed on the render shape.' },
    })
  );
  assert.match(text, /Approval context: Human sign-off needed on the render shape\./);
});

test('approval-ask-content-03: no approval_context means no Approval context line', () => {
  const text = messageTextForEvent(event({ type: 'ApprovalRequested', payload: { title: 'a fine feature' } }));
  assert.ok(!text.includes('Approval context:'));
});

// Cleaner (BL-480 pass): buildSummaryBody's shared field loop only applies
// firstParagraph() to the 'notes' field - every other field (approvalContext,
// firstAcceptanceStep) renders its raw value verbatim. A multi-paragraph
// approvalContext pins that: firstParagraph would silently drop everything
// after the first blank line, which notes intentionally does but
// approvalContext must not.
test('approval-ask-content-03: a multi-paragraph approval_context is NOT collapsed to its first paragraph (unlike notes)', () => {
  const text = messageTextForEvent(
    event({
      type: 'ApprovalRequested',
      payload: { title: 'a fine feature', approvalContext: 'First paragraph.\n\nSecond paragraph.' },
    })
  );
  assert.match(text, /Approval context: First paragraph\.\n\nSecond paragraph\./);
});

test('approval-ask-content-04: an oversized notes block is truncated within the Telegram message length limit', () => {
  const hugeNotes = 'x'.repeat(5000);
  const text = messageTextForEvent(event({ type: 'ApprovalRequested', payload: { title: 'a fine feature', notes: hugeNotes } }));
  assert.ok(text.length < 4096, `expected the rendered ask under Telegram's 4096-char limit, got ${text.length}`);
  assert.ok(text.includes('…'), 'expected the oversized notes to be truncated with an ellipsis');
  assert.ok(text.includes(FROZEN_ASK_LINE), 'expected the frozen reply-grammar line to survive truncation of the enrichment body');
});

test('approval-ask-content-05: a ticket with no summary source still renders a well-formed ask', () => {
  const text = messageTextForEvent(event({ type: 'ApprovalRequested' }));
  assert.equal(text, FROZEN_ASK_LINE, 'expected the exact pre-change bare line when no summary is available');
  assert.match(text, /BL-123/);
  assert.ok(text.includes(FROZEN_ASK_LINE));
});

test('approval-ask-content-06: TaskStarted/TaskCompleted/NeedsApproval renders are unchanged by this feature', () => {
  assert.equal(messageTextForEvent(event({ type: 'TaskStarted' })), 'TaskStarted: BL-123');
  assert.equal(messageTextForEvent(event({ type: 'TaskCompleted' })), 'TaskCompleted: BL-123');
  assert.equal(messageTextForEvent(event({ type: 'NeedsApproval' })), 'NeedsApproval: BL-123');
});

// ── BL-410: ApprovalRequested carries Approve/Amend/Reject buttons ───────

test('BL-410: decideTopicAction attaches Approve/Amend/Reject inline-keyboard buttons for ApprovalRequested', () => {
  const action = decideTopicAction(event({ type: 'ApprovalRequested' }), {}, 'a fine feature');
  assert.deepEqual(action.buttons, [
    [
      { text: 'Approve', callbackData: 'approve:BL-123' },
      { text: 'Amend', callbackData: 'amend:BL-123' },
      { text: 'Reject', callbackData: 'reject:BL-123' },
      { text: 'Expedite', callbackData: 'expedite:BL-123' },
    ],
  ]);
});

test('BL-410: decideTopicAction attaches buttons on the reuse path too, not only create', () => {
  const action = decideTopicAction(event({ type: 'ApprovalRequested' }), { 'BL-123': 42 }, 'a fine feature');
  assert.deepEqual(action, {
    kind: 'reuse',
    topicId: 42,
    text: messageTextForEvent(event({ type: 'ApprovalRequested' })),
    buttons: [
      [
        { text: 'Approve', callbackData: 'approve:BL-123' },
        { text: 'Amend', callbackData: 'amend:BL-123' },
        { text: 'Reject', callbackData: 'reject:BL-123' },
        { text: 'Expedite', callbackData: 'expedite:BL-123' },
      ],
    ],
  });
});

// ── BL-490: Expedite is a fourth button alongside Approve/Amend/Reject ────

test('BL-490: the Expedite button carries the expedite verb tagged with the ticket id', () => {
  const action = decideTopicAction(event({ type: 'ApprovalRequested' }), {}, 'a fine feature');
  const expedite = action.buttons.flat().find((b) => b.text === 'Expedite');
  assert.deepEqual(expedite, { text: 'Expedite', callbackData: 'expedite:BL-123' });
});

test('BL-490: Approve, Amend, and Reject are still present alongside Expedite', () => {
  const action = decideTopicAction(event({ type: 'ApprovalRequested' }), {}, 'a fine feature');
  const labels = action.buttons.flat().map((b) => b.text);
  assert.deepEqual(labels, ['Approve', 'Amend', 'Reject', 'Expedite']);
});

test('BL-410: decideTopicAction attaches no buttons key at all for other event types (existing shapes unaffected)', () => {
  const action = decideTopicAction(event({ type: 'TaskStarted' }), {}, 'a fine feature');
  assert.equal(Object.prototype.hasOwnProperty.call(action, 'buttons'), false);
});

// ── BL-341: decideEpicTopicAction reuses the SAME topic mapping ───────────

test('BL-341: decideEpicTopicAction creates a topic named "EPIC — <title>" when the epic has no mapping yet', () => {
  const action = decideEpicTopicAction('dynamic-routing', 'Dynamic Routing', {}, 'opening text');
  assert.deepEqual(action, { kind: 'create', topicName: 'EPIC — Dynamic Routing', text: 'opening text' });
});

test('BL-341: decideEpicTopicAction reuses the mapped topic id when one already exists - created once, not once per slice', () => {
  const action = decideEpicTopicAction('dynamic-routing', 'Dynamic Routing', { 'dynamic-routing': 42 }, 'progress text');
  assert.deepEqual(action, { kind: 'reuse', topicId: 42, text: 'progress text' });
});

test('BL-341: decideEpicTopicAction is looked up through the SAME BacklogTopicMap a ticket topic uses - no second map', () => {
  // The exact map shape decideTopicAction already reads BL-### ids from -
  // an epic id and a BL-### id share the one map, never colliding in
  // practice (same posture as SUP-### vs BL-### in BL-325).
  const sharedMap = { 'BL-123': 99, 'dynamic-routing': 42 };
  const ticketAction = decideTopicAction({ type: 'TaskStarted', backlogId: 'BL-123', payload: {} }, sharedMap, 'a fine feature');
  const epicAction = decideEpicTopicAction('dynamic-routing', 'Dynamic Routing', sharedMap, 'progress text');
  assert.equal(ticketAction.kind, 'reuse');
  assert.equal(ticketAction.topicId, 99);
  assert.equal(epicAction.kind, 'reuse');
  assert.equal(epicAction.topicId, 42);
});

// ── BL-493: the target resolver and status-text builder (pure seams) ────

test('BL-493: epicTopicName is the single definition decideEpicTopicAction itself uses', () => {
  assert.equal(epicTopicName('Dynamic Routing'), 'EPIC — Dynamic Routing');
});

test('BL-493: resolveTicketStatusTarget targets the epic when the ticket declares one', () => {
  assert.deepEqual(resolveTicketStatusTarget('dynamic-routing'), { kind: 'epic', epicId: 'dynamic-routing' });
});

test('BL-493: resolveTicketStatusTarget targets the standing Backlog topic when the ticket declares no epic', () => {
  assert.deepEqual(resolveTicketStatusTarget(undefined), { kind: 'backlog' });
});

test('BL-493: buildTicketStatusText prefixes the ticket id, a lifecycle glyph, a plain-text state, and the title', () => {
  assert.equal(buildTicketStatusText('BL-123', 'a fine feature', 'feature'), 'BL-123 🎵 in progress — a fine feature');
  assert.equal(buildTicketStatusText('BL-123', 'a fine feature', 'done'), 'BL-123 ✅ done — a fine feature');
  assert.equal(buildTicketStatusText('BL-123', 'a fine feature', 'defect'), 'BL-123 🦠 in progress — a fine feature');
});

// BL-493 (cleaner): 'paused'/'awaiting-approval' never actually reach this
// builder in production (see ticketStatusMessage.ts's own comment), but
// STATUS_LABEL/ICON_EMOJI are keyed by the full TopicIconState for
// TypeScript exhaustiveness - drive both here so a mutated label/glyph on
// either entry doesn't survive uncaught just because no live caller passes
// them yet.
test('BL-493: buildTicketStatusText also renders the exhaustiveness-only paused/awaiting-approval states', () => {
  assert.equal(buildTicketStatusText('BL-123', 'a fine feature', 'paused'), 'BL-123 🔍 paused — a fine feature');
  assert.equal(buildTicketStatusText('BL-123', 'a fine feature', 'awaiting-approval'), 'BL-123 👀 awaiting approval — a fine feature');
});

test('BL-493: a later transition edits the SAME status text - the glyph/state changes, the id/title/separator do not', () => {
  const opened = buildTicketStatusText('BL-123', 'a fine feature', 'feature');
  const closed = buildTicketStatusText('BL-123', 'a fine feature', 'done');
  assert.notEqual(opened, closed);
  assert.ok(opened.startsWith('BL-123 '));
  assert.ok(closed.startsWith('BL-123 '));
  assert.ok(opened.endsWith('— a fine feature'));
  assert.ok(closed.endsWith('— a fine feature'));
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
  const posted = [];
  const edited = [];
  const messageStates = {};
  let operatorTopicId = 700;
  let approvalsTopicId = 800;
  let backlogTopicId = 900;
  const ensureOperatorTopicCalls = [];
  const ensureApprovalsTopicCalls = [];
  const ensureBacklogTopicCalls = [];
  return {
    map,
    created,
    sent,
    closed,
    recorded,
    posted,
    edited,
    messageStates,
    ensureOperatorTopicCalls,
    ensureApprovalsTopicCalls,
    ensureBacklogTopicCalls,
    setOperatorTopicId: (id) => {
      operatorTopicId = id;
    },
    setApprovalsTopicId: (id) => {
      approvalsTopicId = id;
    },
    setBacklogTopicId: (id) => {
      backlogTopicId = id;
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
      // BL-410: buttons only appears on the pushed record when actually
      // given, so every pre-existing exact-shape `assert.deepEqual(sent,
      // [{topicId, text}])` below stays unaffected (an explicit `buttons:
      // undefined` key would make those fail - see topicRouter.ts's own
      // conditional-spread TopicAction for the identical reason).
      sendMessage: async (topicId, text, buttons) => {
        sent.push(buttons !== undefined ? { topicId, text, buttons } : { topicId, text });
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
      ensureApprovalsTopic: async () => {
        ensureApprovalsTopicCalls.push(true);
        return approvalsTopicId;
      },
      // BL-493: the standing Backlog topic (epic-less ticket-status target).
      ensureBacklogTopic: async () => {
        ensureBacklogTopicCalls.push(true);
        return backlogTopicId;
      },
      postMessage: async (topicId, text) => {
        const messageId = 9000 + posted.length;
        posted.push({ topicId, text, messageId });
        return messageId;
      },
      editMessage: async (topicId, messageId, text) => {
        edited.push({ topicId, messageId, text });
        return true;
      },
      getTicketMessageState: (backlogId) => messageStates[backlogId],
      setTicketMessageState: (backlogId, state) => {
        messageStates[backlogId] = state;
      },
    },
  };
}

function untaggedEvent(overrides = {}) {
  return { type: 'NeedsApproval', backlogId: null, role: 'coder', payload: {}, ...overrides };
}

// BL-493: builds the per-ticket routing context conciergeTick.ts resolves
// from its folder snapshot and threads into routeEvent - epic-less/'feature'
// state by default (an ordinary active, non-bug ticket), overridable per test.
function ticketContext(overrides = {}) {
  return { iconState: 'feature', ...overrides };
}

// ── BL-493: ticket-status routing (epic-bound -> epic topic, epic-less ->
// Backlog topic), edit-in-place, no per-ticket topic ever created ─────────

test('BL-493 fold-ticket-events-02: an epic-less ticket event posts into the standing Backlog topic, prefixed with the ticket id', async () => {
  const { adapters, created, posted, ensureBacklogTopicCalls, messageStates } = fakeAdapters();
  const result = await routeEvent(event(), 'a fine feature', adapters, ticketContext());
  assert.deepEqual(created, [], 'no epic topic and no per-ticket topic - this ticket declares no epic');
  assert.equal(ensureBacklogTopicCalls.length, 1);
  assert.deepEqual(posted, [{ topicId: 900, text: 'BL-123 🎵 in progress — a fine feature', messageId: 9000 }]);
  assert.deepEqual(messageStates['BL-123'], { topicId: 900, messageId: 9000, renderedText: 'BL-123 🎵 in progress — a fine feature' });
  assert.deepEqual(result, { posted: true, skipped: false });
});

test('BL-493 fold-ticket-events-01: an epic-bound ticket event posts into its epic topic (created once), prefixed with the ticket id', async () => {
  const { adapters, created, posted, map } = fakeAdapters();
  const result = await routeEvent(event(), 'a fine feature', adapters, ticketContext({ epic: 'dynamic-routing', epicTitle: 'Dynamic Routing' }));
  assert.deepEqual(created, ['EPIC — Dynamic Routing']);
  assert.equal(map['dynamic-routing'], 501, 'the epic topic id is recorded into the SAME BacklogTopicMap decideEpicTopicAction reads');
  assert.deepEqual(posted, [{ topicId: 501, text: 'BL-123 🎵 in progress — a fine feature', messageId: 9000 }]);
  assert.deepEqual(result, { posted: true, skipped: false });
});

test('BL-493: an epic-bound ticket event reuses an already-mapped epic topic - no second create', async () => {
  const { adapters, created, posted } = fakeAdapters({ 'dynamic-routing': 42 });
  await routeEvent(event(), 'a fine feature', adapters, ticketContext({ epic: 'dynamic-routing', epicTitle: 'Dynamic Routing' }));
  assert.deepEqual(created, []);
  assert.deepEqual(posted, [{ topicId: 42, text: 'BL-123 🎵 in progress — a fine feature', messageId: 9000 }]);
});

test('BL-493 fold-ticket-events-04: no per-ticket topic is ever created for a ticket event, epic-bound or epic-less', async () => {
  const epicLess = fakeAdapters();
  await routeEvent(event(), 'a fine feature', epicLess.adapters, ticketContext());
  assert.deepEqual(epicLess.created, []);
  assert.deepEqual(epicLess.map, {}, 'the per-ticket BacklogTopicMap must never gain a BL-### entry');

  const epicBound = fakeAdapters();
  await routeEvent(event(), 'a fine feature', epicBound.adapters, ticketContext({ epic: 'dynamic-routing', epicTitle: 'Dynamic Routing' }));
  assert.deepEqual(epicBound.created, ['EPIC — Dynamic Routing']);
  assert.equal(epicBound.map['BL-123'], undefined, 'the epic topic is created, but never one keyed by the ticket\'s own id');
});

test('BL-493 fold-ticket-events-03: a later lifecycle transition edits the SAME status message in place - no additional message posted', async () => {
  const { adapters, posted, edited, messageStates } = fakeAdapters();
  await routeEvent(event(), 'a fine feature', adapters, ticketContext({ iconState: 'feature' }));
  const result = await routeEvent(event({ type: 'TaskCompleted' }), 'a fine feature', adapters, ticketContext({ iconState: 'done' }));
  assert.equal(posted.length, 1, 'expected exactly one post across both transitions');
  assert.deepEqual(edited, [{ topicId: 900, messageId: 9000, text: 'BL-123 ✅ done — a fine feature' }]);
  assert.deepEqual(messageStates['BL-123'], { topicId: 900, messageId: 9000, renderedText: 'BL-123 ✅ done — a fine feature' });
  assert.deepEqual(result, { posted: true, skipped: false });
});

test('BL-493: a transition whose rendered text is unchanged is a no-op - never a redundant edit', async () => {
  const { adapters, posted, edited } = fakeAdapters();
  await routeEvent(event(), 'a fine feature', adapters, ticketContext({ iconState: 'feature' }));
  // A second ticket-status routing pass while the ticket's own lifecycle
  // state has not moved (still active/'feature') renders the IDENTICAL
  // status text - exactly the case a re-derived-but-unchanged transition
  // produces.
  const result = await routeEvent(event(), 'a fine feature', adapters, ticketContext({ iconState: 'feature' }));
  assert.equal(posted.length, 1);
  assert.deepEqual(edited, [], 'expected no editMessage call when the text has not changed');
  assert.deepEqual(result, { posted: true, skipped: false }, 'skipped-unchanged is a SUCCESS, never treated as a failed route');
});

test('BL-493: an epic-topic creation failure is a skip, never a fallback post anywhere else', async () => {
  const { adapters, posted } = fakeAdapters();
  adapters.createTopic = async () => ({ success: false });
  const result = await routeEvent(event(), 'a fine feature', adapters, ticketContext({ epic: 'dynamic-routing', epicTitle: 'Dynamic Routing' }));
  assert.deepEqual(result, { posted: false, skipped: true });
  assert.deepEqual(posted, []);
});

test('BL-493: a failed postMessage reports posted:false but is not itself a skip (the topic exists, delivery just failed)', async () => {
  const { adapters, messageStates } = fakeAdapters();
  adapters.postMessage = async () => undefined;
  const result = await routeEvent(event(), 'a fine feature', adapters, ticketContext());
  assert.deepEqual(result, { posted: false, skipped: false });
  assert.deepEqual(messageStates['BL-123'], { topicId: 900 }, 'no message id remembered when the post itself failed');
});

test('BL-493: a failed editMessage reports posted:false but the PRIOR message state is preserved for the next retry', async () => {
  const { adapters, messageStates } = fakeAdapters();
  await routeEvent(event(), 'a fine feature', adapters, ticketContext({ iconState: 'feature' }));
  adapters.editMessage = async () => false;
  const result = await routeEvent(event({ type: 'TaskCompleted' }), 'a fine feature', adapters, ticketContext({ iconState: 'done' }));
  assert.deepEqual(result, { posted: false, skipped: false });
  assert.deepEqual(messageStates['BL-123'], { topicId: 900, messageId: 9000, renderedText: 'BL-123 🎵 in progress — a fine feature' });
});

test('BL-493: a tagged event with no ticketContext supplied is skipped, never guesses a route (defensive)', async () => {
  const { adapters, posted, created } = fakeAdapters();
  const result = await routeEvent(event(), 'a fine feature', adapters);
  assert.deepEqual(result, { posted: false, skipped: true });
  assert.deepEqual(posted, []);
  assert.deepEqual(created, []);
});

// ── recordMessage (BL-329: outbound serialisation) - ticket-status path ───
// Only ever called after a GENUINELY successful post/edit - mirrors
// emittedKeys' own "only record what actually posted" convention (BL-322).

test('BL-329: a successful post is recorded with the exact backlogId and rendered text', async () => {
  const { adapters, recorded } = fakeAdapters();
  await routeEvent(event(), 'a fine feature', adapters, ticketContext());
  assert.deepEqual(recorded, [{ backlogId: 'BL-123', text: 'BL-123 🎵 in progress — a fine feature' }]);
});

test('BL-329: a successful edit is ALSO recorded, not just the initial post', async () => {
  const { adapters, recorded } = fakeAdapters();
  await routeEvent(event(), 'a fine feature', adapters, ticketContext({ iconState: 'feature' }));
  await routeEvent(event({ type: 'TaskCompleted' }), 'a fine feature', adapters, ticketContext({ iconState: 'done' }));
  assert.deepEqual(recorded, [
    { backlogId: 'BL-123', text: 'BL-123 🎵 in progress — a fine feature' },
    { backlogId: 'BL-123', text: 'BL-123 ✅ done — a fine feature' },
  ]);
});

test('BL-329: a skipped-unchanged transition is never recorded a second time', async () => {
  const { adapters, recorded } = fakeAdapters();
  await routeEvent(event(), 'a fine feature', adapters, ticketContext({ iconState: 'feature' }));
  await routeEvent(event(), 'a fine feature', adapters, ticketContext({ iconState: 'feature' }));
  assert.deepEqual(recorded, [{ backlogId: 'BL-123', text: 'BL-123 🎵 in progress — a fine feature' }]);
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

// BL-493: a TAGGED NeedsApproval (a role blocked mid-task, holding a
// ticket) still goes to the standing Operator topic like an untagged one -
// never collapsed into the ticket's terse edit-in-place status line, which
// has no room for the role's free-text question (routeGateEvent's own
// comment in topicRouter.ts). Unlike the untagged case, its message IS
// recorded into the ticket's own durable record, since backlogId !== null
// here.
test('BL-493: a TAGGED NeedsApproval routes to the standing Operator topic, never the ticket-status path, and IS recorded (unlike an untagged one)', async () => {
  const { adapters, sent, recorded, posted, ensureOperatorTopicCalls } = fakeAdapters();
  const result = await routeEvent(event({ type: 'NeedsApproval' }), 'a fine feature', adapters, ticketContext());
  assert.deepEqual(sent, [{ topicId: 700, text: 'NeedsApproval: BL-123' }]);
  assert.equal(ensureOperatorTopicCalls.length, 1);
  assert.deepEqual(posted, [], 'never the edit-in-place ticket-status path');
  assert.deepEqual(recorded, [{ backlogId: 'BL-123', text: 'NeedsApproval: BL-123' }]);
  assert.deepEqual(result, { posted: true, skipped: false });
});

test('BL-493: a TAGGED NeedsApproval is not recorded when the send itself fails', async () => {
  const { adapters, recorded } = fakeAdapters();
  adapters.sendMessage = async () => false;
  await routeEvent(event({ type: 'NeedsApproval' }), 'a fine feature', adapters, ticketContext());
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

test('BL-358: a tagged event still routes through the ticket-status path, unaffected (regression)', async () => {
  const { adapters, posted, ensureOperatorTopicCalls } = fakeAdapters();
  await routeEvent(event(), 'a fine feature', adapters, ticketContext());
  assert.equal(posted.length, 1);
  assert.equal(ensureOperatorTopicCalls.length, 0, 'a tagged event must never touch the Operator topic');
});

// ── routeEvent ApprovalRequested path (BL-434) ────────────────────────────

test('BL-434: an ApprovalRequested ask posts ONLY into the standing Approvals topic - never a message into the per-ticket topic', async () => {
  const { adapters, sent, ensureApprovalsTopicCalls } = fakeAdapters();
  const result = await routeEvent(event({ type: 'ApprovalRequested' }), 'a fine feature', adapters);
  assert.equal(sent.length, 1, 'expected exactly one message posted, into the Approvals topic only');
  assert.equal(sent[0].topicId, 800);
  assert.equal(ensureApprovalsTopicCalls.length, 1);
  assert.deepEqual(result, { posted: true, skipped: false });
});

// BL-493 (human decision D3): the icon-only per-ticket-topic ensure this
// pair used to guard (ensurePerTicketTopicForIcon) is DELETED - awaiting-
// approval now surfaces via the standing Approvals topic ONLY, no
// throwaway per-ticket topic minted just to hang an icon on, whether or not
// the ticket has ever had one before.
test('BL-493 fold-ticket-events-05: an ApprovalRequested ask for a ticket with no prior topic mints NO per-ticket topic at all', async () => {
  const { adapters, created, sent, map } = fakeAdapters();
  await routeEvent(event({ type: 'ApprovalRequested' }), 'a fine feature', adapters);
  assert.deepEqual(created, [], 'expected NO topic created for the ask - not the Approvals topic (already ensured) and not a per-ticket one');
  assert.deepEqual(map, {}, 'expected the BacklogTopicMap to gain no BL-### entry');
  assert.deepEqual(
    sent.map((m) => m.topicId),
    [800]
  );
});

test('BL-493: an ApprovalRequested ask for a ticket that already has a (legacy) per-ticket topic leaves that mapping untouched and still posts only to Approvals', async () => {
  const { adapters, created, map, sent } = fakeAdapters({ 'BL-123': 42 });
  await routeEvent(event({ type: 'ApprovalRequested' }), 'a fine feature', adapters);
  assert.deepEqual(created, []);
  assert.equal(map['BL-123'], 42, 'expected the existing legacy mapping left untouched, never re-derived');
  assert.deepEqual(
    sent.map((m) => m.topicId),
    [800]
  );
});

test('BL-434: an ApprovalRequested ask IS recorded into the ticket\'s own durable record (unlike an untagged NeedsApproval - this event is always tagged)', async () => {
  const { adapters, recorded } = fakeAdapters();
  await routeEvent(event({ type: 'ApprovalRequested' }), 'a fine feature', adapters);
  assert.deepEqual(recorded, [{ backlogId: 'BL-123', text: messageTextForEvent(event({ type: 'ApprovalRequested' })) }]);
});

test('BL-434: a failed Approvals-topic creation skips the event, never falls back anywhere else', async () => {
  const { adapters, sent } = fakeAdapters();
  adapters.ensureApprovalsTopic = async () => undefined;
  const result = await routeEvent(event({ type: 'ApprovalRequested' }), 'a fine feature', adapters);
  assert.deepEqual(result, { posted: false, skipped: true });
  assert.deepEqual(sent, []);
});

test('BL-434: a failed send to the Approvals topic reports posted:false but is not a skip', async () => {
  const { adapters } = fakeAdapters();
  adapters.sendMessage = async () => false;
  const result = await routeEvent(event({ type: 'ApprovalRequested' }), 'a fine feature', adapters);
  assert.deepEqual(result, { posted: false, skipped: false });
});

test('BL-434: a non-ApprovalRequested tagged event still routes through the ticket-status path, never touching the Approvals topic', async () => {
  const { adapters, posted, ensureApprovalsTopicCalls } = fakeAdapters();
  await routeEvent(event(), 'a fine feature', adapters, ticketContext());
  assert.equal(posted.length, 1);
  assert.equal(ensureApprovalsTopicCalls.length, 0, 'a non-ApprovalRequested event must never touch the Approvals topic');
});

// Defensive-only branch: swarmEventStream.ts never emits ApprovalRequested
// untagged in practice (unlike NeedsApproval, which genuinely can be), but
// routeApprovalRequestedEvent still guards against it rather than assuming
// the invariant - this pins that guard actually skips cleanly instead of
// crashing on a null backlogId, so the untested branch doesn't silently rot
// if the invariant is ever loosened upstream.
test('BL-434: an untagged ApprovalRequested (backlogId null) is skipped, never crashes and never touches the Approvals topic', async () => {
  const { adapters, sent, ensureApprovalsTopicCalls } = fakeAdapters();
  const result = await routeEvent(event({ type: 'ApprovalRequested', backlogId: null }), 'a fine feature', adapters);
  assert.deepEqual(result, { posted: false, skipped: true });
  assert.deepEqual(sent, []);
  assert.equal(ensureApprovalsTopicCalls.length, 0);
});

// ── routeEvent ApprovalRequested: sendApprovalAsk message-id capture (BL-484) ──
// Optional adapter - absent (every test above never sets it) keeps posting
// via the ordinary sendMessage/recordMessage path unchanged. Present, it
// captures the ask's Telegram message_id so a later decision (a separate
// poll-loop subsystem) can edit that exact message in place.

test('BL-484: when sendApprovalAsk is wired, it is used instead of sendMessage, and its message_id is recorded', async () => {
  const { adapters, sent, recorded } = fakeAdapters();
  const askCalls = [];
  const recordCalls = [];
  adapters.sendApprovalAsk = async (topicId, text, buttons) => {
    askCalls.push({ topicId, text, buttons });
    return { success: true, messageId: 999 };
  };
  adapters.recordApprovalAskMessageId = (backlogId, topicId, messageId, text) => {
    recordCalls.push({ backlogId, topicId, messageId, text });
  };

  const result = await routeEvent(event({ type: 'ApprovalRequested' }), 'a fine feature', adapters);

  assert.deepEqual(result, { posted: true, skipped: false });
  assert.equal(sent.length, 0, 'expected the ordinary sendMessage never called when sendApprovalAsk is wired');
  assert.equal(askCalls.length, 1);
  assert.equal(askCalls[0].topicId, 800);
  assert.deepEqual(recordCalls, [
    { backlogId: 'BL-123', topicId: 800, messageId: 999, text: messageTextForEvent(event({ type: 'ApprovalRequested' })) },
  ]);
  assert.deepEqual(recorded, [{ backlogId: 'BL-123', text: messageTextForEvent(event({ type: 'ApprovalRequested' })) }]);
});

test('BL-484: sendApprovalAsk reporting no messageId still posts/records the text, just never calls recordApprovalAskMessageId', async () => {
  const { adapters, recorded } = fakeAdapters();
  const recordCalls = [];
  adapters.sendApprovalAsk = async () => ({ success: true });
  adapters.recordApprovalAskMessageId = (backlogId, topicId, messageId, text) => {
    recordCalls.push({ backlogId, topicId, messageId, text });
  };

  const result = await routeEvent(event({ type: 'ApprovalRequested' }), 'a fine feature', adapters);

  assert.deepEqual(result, { posted: true, skipped: false });
  assert.deepEqual(recordCalls, []);
  assert.equal(recorded.length, 1);
});

test('BL-484: a failed sendApprovalAsk reports posted:false and records nothing (mirrors a failed sendMessage)', async () => {
  const { adapters, recorded } = fakeAdapters();
  const recordCalls = [];
  adapters.sendApprovalAsk = async () => ({ success: false });
  adapters.recordApprovalAskMessageId = (backlogId, topicId, messageId, text) => {
    recordCalls.push({ backlogId, topicId, messageId, text });
  };

  const result = await routeEvent(event({ type: 'ApprovalRequested' }), 'a fine feature', adapters);

  assert.deepEqual(result, { posted: false, skipped: false });
  assert.deepEqual(recorded, []);
  assert.deepEqual(recordCalls, []);
});

test('BL-484: sendApprovalAsk absent keeps the ordinary sendMessage path fully unaffected (regression)', async () => {
  const { adapters, sent, recorded } = fakeAdapters();
  const result = await routeEvent(event({ type: 'ApprovalRequested' }), 'a fine feature', adapters);
  assert.deepEqual(result, { posted: true, skipped: false });
  assert.equal(sent.length, 1);
  assert.equal(recorded.length, 1);
});

// ── completionSummaryText (pure, orphaned by BL-493) — BL-299 ─────────────
// The old per-ticket-topic summary-then-close mechanism (routeCompletionEvent)
// is gone from routeEvent's production dispatch - TaskCompleted now routes
// through the SAME ticket-status edit-in-place path as every other ticket
// event (see the BL-493 section above). completionSummaryText itself is left
// defined and tested (orphaned, not deleted - cleanup is the cleaner's call,
// same posture the ticket's own spec already applies to topicNameForItem).

test('completionSummaryText names the item and states it is complete', () => {
  assert.equal(completionSummaryText(event({ type: 'TaskCompleted' }), 'a fine feature'), 'BL-123 - a fine feature is complete.');
});

// ── routeEvent TaskCompleted path (adapter-injected) — BL-493 ────────────
// TaskCompleted no longer gets a bespoke summary-then-close: it is an
// ordinary ticket-status transition, editing the SAME status message
// (glyph flips to done ✅) with no topic ever closed - the epic/Backlog
// topic is shared by many tickets and is never this one ticket's to close.

test('BL-493: TaskCompleted edits the existing status message to the done glyph - no topic is ever closed', async () => {
  const { adapters, posted, edited, closed } = fakeAdapters();
  await routeEvent(event(), 'a fine feature', adapters, ticketContext({ iconState: 'feature' }));
  const result = await routeEvent(event({ type: 'TaskCompleted' }), 'a fine feature', adapters, ticketContext({ iconState: 'done' }));
  assert.equal(posted.length, 1);
  assert.deepEqual(edited, [{ topicId: 900, messageId: 9000, text: 'BL-123 ✅ done — a fine feature' }]);
  assert.deepEqual(closed, [], 'no per-ticket topic exists for this ticket to close');
  assert.deepEqual(result, { posted: true, skipped: false });
});

test('BL-493: a TaskCompleted for a ticket with no PRIOR status message still posts one (first-ever event happens to be completion)', async () => {
  const { adapters, posted, closed } = fakeAdapters();
  const result = await routeEvent(event({ type: 'TaskCompleted' }), 'a fine feature', adapters, ticketContext({ iconState: 'done' }));
  assert.deepEqual(posted, [{ topicId: 900, text: 'BL-123 ✅ done — a fine feature', messageId: 9000 }]);
  assert.deepEqual(closed, []);
  assert.deepEqual(result, { posted: true, skipped: false });
});
