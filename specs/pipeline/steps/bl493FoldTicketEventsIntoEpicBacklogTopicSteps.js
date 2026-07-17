'use strict';

// BL-493: step handlers for "Fold a ticket's swarm events into its epic or
// the Backlog topic as an edit-in-place status message". Drives the REAL
// compiled routeEvent (extension/out/concierge/topicRouter.js) directly
// against fake createTopic/sendMessage/postMessage/editMessage adapters and
// an in-memory topic map + message-identity store - no live Telegram, no
// network. Mirrors conciergeTopicRoutingSteps.js's own "require the
// compiled module, fixture adapters" pattern, extended with the new
// edit-in-place adapter surface (ensureBacklogTopic/postMessage/
// editMessage/getTicketMessageState/setTicketMessageState) RouteAdapters
// grew for this ticket.
const path = require('node:path');

const { routeEvent } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'topicRouter'));

// "a ticket's epic membership is read from its epic field" and "no
// per-ticket topic is created" also appear verbatim in
// BL-495-topic-recreation-epic-aware.feature (a not-yet-implemented
// feature, out of this ticket's own scope) - scoped via defineScoped so a
// future BL-495 step file can register its OWN handlers for that exact
// text without either silently winning over the other (stepRegistry.js's
// BL-425 convention).
const FEATURE_NAME = "Fold a ticket's swarm events into its epic or the Backlog topic as an edit-in-place status message";

const TICKET_ID = 'BL-123';
const TITLE = 'a fine feature';
const BACKLOG_TOPIC_ID = 900;
const APPROVALS_TOPIC_ID = 950;

function mkEvent(overrides = {}) {
  return { type: 'TaskStarted', backlogId: TICKET_ID, payload: {}, ...overrides };
}

function buildAdapters(ctx) {
  return {
    getTopicMap: () => ctx.topicMap,
    createTopic: async (name) => {
      ctx.created.push(name);
      return { success: true, topicId: 700 + ctx.created.length };
    },
    recordTopicId: (backlogId, topicId) => {
      ctx.topicMap[backlogId] = topicId;
    },
    sendMessage: async (topicId, text) => {
      ctx.sent.push({ topicId, text });
      return true;
    },
    closeTopic: async (topicId) => {
      ctx.closed.push(topicId);
      return true;
    },
    recordMessage: () => {},
    ensureOperatorTopic: async () => undefined,
    ensureApprovalsTopic: async () => APPROVALS_TOPIC_ID,
    ensureBacklogTopic: async () => BACKLOG_TOPIC_ID,
    postMessage: async (topicId, text) => {
      const messageId = 9000 + ctx.posted.length;
      ctx.posted.push({ topicId, text, messageId });
      return messageId;
    },
    editMessage: async (topicId, messageId, text) => {
      ctx.edited.push({ topicId, messageId, text });
      return true;
    },
    getTicketMessageState: (backlogId) => ctx.messageStates[backlogId],
    setTicketMessageState: (backlogId, state) => {
      ctx.messageStates[backlogId] = state;
    },
  };
}

function freshFixture(ctx) {
  ctx.topicMap = {};
  ctx.created = [];
  ctx.sent = [];
  ctx.closed = [];
  ctx.posted = [];
  ctx.edited = [];
  ctx.messageStates = {};
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the standing Backlog topic exists$/, (ctx) => {
    freshFixture(ctx);
  });

  registry.defineScoped(
    /^a ticket's epic membership is read from its epic field$/,
    () => {
      // Documents the invariant (BacklogItem.epic, never inferred from
      // prose) - no fixture arrangement of its own; the scenario's own
      // Given below sets the concrete epic value this invariant governs.
    },
    FEATURE_NAME
  );

  // ── fold-ticket-events-01/02: target resolution ───────────────────────
  registry.define(/^a ticket whose epic field names an epic$/, (ctx) => {
    ctx.event = mkEvent();
    ctx.ticketContext = { epic: 'dynamic-routing', epicTitle: 'Dynamic Routing', iconState: 'feature' };
  });

  registry.define(/^a ticket whose epic field is empty$/, (ctx) => {
    ctx.event = mkEvent();
    ctx.ticketContext = { iconState: 'feature' };
  });

  registry.define(/^no status message has been recorded for that ticket yet$/, (ctx) => {
    if (ctx.messageStates[TICKET_ID] !== undefined) {
      throw new Error('fixture bug: expected no prior message state');
    }
  });

  registry.define(/^a swarm event for the ticket is routed$/, async (ctx) => {
    ctx.result = await routeEvent(ctx.event, TITLE, buildAdapters(ctx), ctx.ticketContext);
  });

  registry.define(/^a status message is posted into that epic's topic$/, (ctx) => {
    if (ctx.created.length !== 1 || ctx.created[0] !== 'EPIC — Dynamic Routing') {
      throw new Error(`expected the epic topic created once, got created=${JSON.stringify(ctx.created)}`);
    }
    const epicTopicId = ctx.topicMap['dynamic-routing'];
    if (ctx.posted.length !== 1 || ctx.posted[0].topicId !== epicTopicId) {
      throw new Error(`expected exactly one status message posted into the epic topic ${epicTopicId}, got ${JSON.stringify(ctx.posted)}`);
    }
  });

  registry.define(/^a status message is posted into the standing Backlog topic$/, (ctx) => {
    if (ctx.posted.length !== 1 || ctx.posted[0].topicId !== BACKLOG_TOPIC_ID) {
      throw new Error(`expected exactly one status message posted into the standing Backlog topic ${BACKLOG_TOPIC_ID}, got ${JSON.stringify(ctx.posted)}`);
    }
  });

  registry.define(/^the status message is prefixed with the ticket id and its current lifecycle state$/, (ctx) => {
    const text = ctx.posted[ctx.posted.length - 1].text;
    if (!text.startsWith(`${TICKET_ID} `) || !/in progress/.test(text)) {
      throw new Error(`expected a status prefix naming the ticket id and its lifecycle state, got: ${text}`);
    }
  });

  registry.define(/^the recorded status message identity for the ticket is remembered$/, (ctx) => {
    const state = ctx.messageStates[TICKET_ID];
    if (!state || typeof state.topicId !== 'number' || typeof state.messageId !== 'number') {
      throw new Error(`expected a remembered {topicId, messageId}, got: ${JSON.stringify(state)}`);
    }
  });

  // ── fold-ticket-events-03: edit in place ──────────────────────────────
  registry.define(/^a status message has already been recorded for a ticket$/, (ctx) => {
    freshFixture(ctx);
    ctx.messageStates[TICKET_ID] = {
      topicId: BACKLOG_TOPIC_ID,
      messageId: 9000,
      renderedText: `${TICKET_ID} 🎵 in progress — ${TITLE}`,
    };
    ctx.event = mkEvent({ type: 'TaskCompleted' });
    ctx.ticketContext = { iconState: 'done' };
  });

  registry.define(/^a later lifecycle transition for the ticket is routed$/, async (ctx) => {
    ctx.result = await routeEvent(ctx.event, TITLE, buildAdapters(ctx), ctx.ticketContext);
  });

  registry.define(/^the previously recorded status message is edited in place$/, (ctx) => {
    if (ctx.edited.length !== 1 || ctx.edited[0].messageId !== 9000 || ctx.edited[0].topicId !== BACKLOG_TOPIC_ID) {
      throw new Error(`expected the SAME message (id 9000) edited in place, got: ${JSON.stringify(ctx.edited)}`);
    }
  });

  registry.define(/^its status prefix reflects the ticket's new lifecycle state$/, (ctx) => {
    if (!/✅ done/.test(ctx.edited[0].text)) {
      throw new Error(`expected the edited text to show the done glyph/state, got: ${ctx.edited[0].text}`);
    }
  });

  registry.define(/^no additional status message is posted for the ticket$/, (ctx) => {
    if (ctx.posted.length !== 0) {
      throw new Error(`expected no postMessage call, only the edit above, got: ${JSON.stringify(ctx.posted)}`);
    }
  });

  // ── fold-ticket-events-04: no per-ticket topic ────────────────────────
  registry.define(/^a ticket whose event would formerly have created a per-ticket topic$/, (ctx) => {
    ctx.event = mkEvent();
    ctx.ticketContext = { iconState: 'feature' };
  });

  registry.defineScoped(
    /^no per-ticket topic is created$/,
    (ctx) => {
      if (ctx.topicMap[TICKET_ID] !== undefined) {
        throw new Error(`expected no BacklogTopicMap entry keyed by the ticket's own id, got: ${JSON.stringify(ctx.topicMap)}`);
      }
      if (ctx.created.some((name) => name.startsWith(TICKET_ID))) {
        throw new Error(`expected no createTopic call named after the ticket, got: ${JSON.stringify(ctx.created)}`);
      }
    },
    FEATURE_NAME
  );

  // ── fold-ticket-events-05: ApprovalRequested stays Approvals-topic-only ──
  registry.define(/^a ticket transitions to awaiting approval$/, (ctx) => {
    ctx.event = mkEvent({ type: 'ApprovalRequested' });
  });

  registry.define(/^the ApprovalRequested event is routed$/, async (ctx) => {
    ctx.result = await routeEvent(ctx.event, TITLE, buildAdapters(ctx));
  });

  registry.define(/^the awaiting-approval ask renders in the standing Approvals topic$/, (ctx) => {
    if (!ctx.sent.some((m) => m.topicId === APPROVALS_TOPIC_ID)) {
      throw new Error(`expected the ask posted into the Approvals topic ${APPROVALS_TOPIC_ID}, got: ${JSON.stringify(ctx.sent)}`);
    }
  });

  registry.define(/^no throwaway per-ticket topic is minted to carry an awaiting-approval icon$/, (ctx) => {
    if (ctx.created.length !== 0) {
      throw new Error(`expected no createTopic call at all (the icon-only ensure is deleted, D3), got: ${JSON.stringify(ctx.created)}`);
    }
  });
}

module.exports = { registerSteps };
