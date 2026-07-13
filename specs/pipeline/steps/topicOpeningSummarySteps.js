'use strict';

// BL-322: step handlers for "A new BL topic opens with a short summary
// instead of a bare TaskStarted". Drives the REAL compiled
// runConciergeTick end to end for the enriched-opener scenarios (mirrors
// conciergeNeedsApprovalSteps.js's own buildAdapters shape), and the REAL
// compiled messageTextForEvent directly for the regression scenario
// (TaskCompleted/NeedsApproval unchanged - the same pattern
// conciergeTopicRoutingSteps.js/conciergeTopicCompletionSteps.js already
// use for those event types).
const path = require('node:path');

const { runConciergeTick } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'conciergeTick'));
const { messageTextForEvent } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'topicRouter'));

const BACKLOG_ID = 'BL-500';
const TITLE = 'a fine feature';
const NOTES = 'This ticket exists because the topic opener was a bare TaskStarted line with no context.\n\nA second paragraph that must never appear in the rendered summary.';
const FIRST_ACCEPTANCE_STEP = 'A newly-active ticket opens its topic with a what/solves/how summary';
const TELEGRAM_MESSAGE_LIMIT = 4096;

function buildAdapters(ctx) {
  return {
    readFolders: () => ctx.folders,
    readGates: () => [],
    readRoleTicket: () => ({}),
    readTickState: () => ctx.state,
    writeTickState: (next) => {
      ctx.state = next;
    },
    routeAdapters: {
      getTopicMap: () => ctx.topicMap,
      createTopic: async (name) => {
        ctx.created.push(name);
        return { success: true, topicId: 900 + ctx.created.length };
      },
      recordTopicId: (backlogId, topicId) => {
        ctx.topicMap[backlogId] = topicId;
      },
      sendMessage: async (topicId, text) => {
        ctx.sent.push({ topicId, text });
        return true;
      },
      closeTopic: async () => true,
      // BL-329: routeEvent (called by runConciergeTick) calls this
      // unconditionally after a successful send.
      recordMessage: () => {},
    },
  };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the front desk opens a Telegram topic for each newly-active backlog ticket$/, (ctx) => {
    ctx.topicMap = {};
    ctx.created = [];
    ctx.sent = [];
    ctx.state = { snapshot: null, emittedKeys: [] };
    ctx.folders = { active: [], paused: [], done: [] };
    ctx.adapters = buildAdapters(ctx);
  });

  // ── topic-opening-summary-01 ─────────────────────────────────────────
  registry.define(/^an active ticket with a title, a notes block, and acceptance steps$/, (ctx) => {
    ctx.folders.active = [{ id: BACKLOG_ID, title: TITLE, notes: NOTES, firstAcceptanceStep: FIRST_ACCEPTANCE_STEP }];
  });

  registry.define(/^its topic is opened$/, async (ctx) => {
    await runConciergeTick(ctx.adapters);
    ctx.openedMessage = ctx.sent.find((m) => m.text)?.text;
  });

  registry.define(/^the opening message states what it is, what it solves, and how it works$/, (ctx) => {
    if (!ctx.openedMessage.includes(`What it is: ${TITLE}`)) {
      throw new Error(`expected "What it is: ${TITLE}", got: ${JSON.stringify(ctx.openedMessage)}`);
    }
    if (!ctx.openedMessage.includes('What it solves:')) {
      throw new Error(`expected a "What it solves:" line, got: ${JSON.stringify(ctx.openedMessage)}`);
    }
    if (!ctx.openedMessage.includes(`How it works: ${FIRST_ACCEPTANCE_STEP}`)) {
      throw new Error(`expected "How it works: ${FIRST_ACCEPTANCE_STEP}", got: ${JSON.stringify(ctx.openedMessage)}`);
    }
    // The rendered "what it solves" line is only the FIRST paragraph of
    // notes - the second paragraph must never leak into the message.
    if (ctx.openedMessage.includes('must never appear in the rendered summary')) {
      throw new Error('expected only the first paragraph of notes, got the second paragraph too');
    }
  });

  registry.define(/^the opening message is not a bare "TaskStarted" line$/, (ctx) => {
    if (ctx.openedMessage === `TaskStarted: ${BACKLOG_ID}`) {
      throw new Error(`expected an enriched opener, got the bare fallback: ${JSON.stringify(ctx.openedMessage)}`);
    }
  });

  // ── topic-opening-summary-02 ─────────────────────────────────────────
  registry.define(/^an active ticket whose (notes|acceptance steps) is absent$/, (ctx, missingField) => {
    const item = { id: BACKLOG_ID, title: TITLE, notes: NOTES, firstAcceptanceStep: FIRST_ACCEPTANCE_STEP };
    if (missingField === 'notes') {
      delete item.notes;
    } else {
      delete item.firstAcceptanceStep;
    }
    ctx.folders.active = [item];
  });

  registry.define(/^the opening message is non-empty and well-formed$/, (ctx) => {
    if (!ctx.openedMessage || ctx.openedMessage.trim().length === 0) {
      throw new Error(`expected a non-empty opening message, got: ${JSON.stringify(ctx.openedMessage)}`);
    }
  });

  registry.define(/^it falls back to the ticket title$/, (ctx) => {
    if (!ctx.openedMessage.includes(`What it is: ${TITLE}`)) {
      throw new Error(`expected the title still present as the fallback baseline, got: ${JSON.stringify(ctx.openedMessage)}`);
    }
  });

  // ── topic-opening-summary-03 ─────────────────────────────────────────
  registry.define(/^an active ticket whose notes block is far longer than a Telegram message allows$/, (ctx) => {
    // A REAL oversized fixture, not a synthetic short one - matches the
    // ticket's own E2E procedure (b): many long paragraphs, well past
    // Telegram's 4096-char limit on their own.
    const hugeNotes = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}: `.padEnd(80, 'x')).join(' ');
    ctx.folders.active = [{ id: BACKLOG_ID, title: TITLE, notes: hugeNotes, firstAcceptanceStep: FIRST_ACCEPTANCE_STEP }];
  });

  registry.define(/^the opening message is truncated$/, (ctx) => {
    if (!ctx.openedMessage.includes('…')) {
      throw new Error(`expected a truncation ellipsis, got: ${JSON.stringify(ctx.openedMessage.slice(0, 100))}...`);
    }
  });

  registry.define(/^the opening message is within the Telegram message length limit$/, (ctx) => {
    if (ctx.openedMessage.length >= TELEGRAM_MESSAGE_LIMIT) {
      throw new Error(`expected the message under Telegram's ${TELEGRAM_MESSAGE_LIMIT}-char limit, got ${ctx.openedMessage.length} chars`);
    }
  });

  // ── topic-opening-summary-04 (regression) ────────────────────────────
  registry.define(/^a ticket that emits a (TaskCompleted|NeedsApproval) event$/, (ctx, eventType) => {
    ctx.regressionEvent = { type: eventType, backlogId: BACKLOG_ID, payload: {} };
  });

  registry.define(/^that event is rendered$/, (ctx) => {
    ctx.regressionText = messageTextForEvent(ctx.regressionEvent);
  });

  registry.define(/^its message is unchanged from before this feature$/, (ctx) => {
    const expected = `${ctx.regressionEvent.type}: ${BACKLOG_ID}`;
    if (ctx.regressionText !== expected) {
      throw new Error(`expected the unchanged pre-BL-322 text "${expected}", got: ${JSON.stringify(ctx.regressionText)}`);
    }
  });
}

module.exports = { registerSteps };
