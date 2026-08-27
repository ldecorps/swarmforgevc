'use strict';

// BL-480: step handlers for "The Approvals-topic ask carries enough ticket
// meat to decide". Drives the REAL compiled runConciergeTick end to end for
// the enrichment scenarios (mirrors topicOpeningSummarySteps.js's own
// buildAdapters shape - BL-322's sibling feature for TaskStarted - plus
// ensureApprovalsTopic since this feature's event routes there instead of
// creating a fresh per-ticket topic), and the REAL compiled
// messageTextForEvent directly for the regression scenario
// (topicOpeningSummarySteps.js's own topic-opening-summary-04 pattern).
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { runConciergeTick } = require(path.join(EXT_OUT, 'concierge', 'conciergeTick'));
const { messageTextForEvent } = require(path.join(EXT_OUT, 'concierge', 'topicRouter'));

const BACKLOG_ID = 'BL-500';
const APPROVALS_TOPIC_ID = 750;
const TITLE = 'a fine feature';
const NOTES = 'This ticket fixes the widget so it stops leaking memory.\n\nA second paragraph that must never appear in the rendered ask.';
const FIRST_ACCEPTANCE_STEP = 'The ask states the acceptance signal';
const APPROVAL_CONTEXT = 'Human sign-off needed on the exact render shape.';
const TELEGRAM_MESSAGE_LIMIT = 4096;
const FROZEN_LINE = `${BACKLOG_ID} needs your approval before it can proceed. Reply here with "approve ${BACKLOG_ID}" (or "reject ${BACKLOG_ID} <reason>") to act.`;

// Every non-ApprovalRequested type approval-ask-content-06's Examples table
// carries - an explicit lookup (not a bare passthrough) so a mutated example
// value fails here rather than silently taking some other branch
// (engineering.prompt's Scenario Outline KNOWN_VALUES rule).
const NON_APPROVAL_EVENT_TYPES = new Set(['TaskStarted', 'TaskCompleted', 'NeedsApproval']);

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
      sendMessage: async (topicId, text, buttons) => {
        ctx.sent.push({ topicId, text, buttons });
        return true;
      },
      closeTopic: async () => true,
      recordMessage: () => {},
      ensureOperatorTopic: async () => 700,
      ensureApprovalsTopic: async () => APPROVALS_TOPIC_ID,
    },
    iconAdapters: {
      getIconStickers: async () => [],
      setTopicIcon: async () => true,
      readSwarmIconId: () => undefined,
      recordSwarmIconId: () => {},
    },
  };
}

function ticket(overrides = {}) {
  return { id: BACKLOG_ID, humanApproval: 'pending', ...overrides };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(
    /^a ticket whose human_approval has just flipped to pending, posting its ApprovalRequested ask in the Approvals topic$/,
    (ctx) => {
      ctx.topicMap = {};
      ctx.created = [];
      ctx.sent = [];
      ctx.state = { snapshot: null, emittedKeys: [] };
      ctx.folders = { active: [], paused: [], done: [] };
      ctx.adapters = buildAdapters(ctx);
    }
  );

  // ── approval-ask-content-01/02 (shared Given) ────────────────────────
  registry.define(/^that ticket has a title, a notes block, and a first acceptance step$/, (ctx) => {
    ctx.folders.paused = [ticket({ title: TITLE, notes: NOTES, firstAcceptanceStep: FIRST_ACCEPTANCE_STEP })];
  });

  registry.define(/^its ApprovalRequested ask is rendered$/, async (ctx) => {
    await runConciergeTick(ctx.adapters);
    ctx.ask = ctx.sent.find((m) => m.topicId === APPROVALS_TOPIC_ID);
    if (!ctx.ask) {
      throw new Error(`expected an ask posted into the Approvals topic, got: ${JSON.stringify(ctx.sent)}`);
    }
  });

  // ── approval-ask-content-01 ───────────────────────────────────────────
  registry.define(/^the ask names the ticket id and its title$/, (ctx) => {
    if (!ctx.ask.text.includes(`${BACKLOG_ID} — ${TITLE}`)) {
      throw new Error(`expected "${BACKLOG_ID} — ${TITLE}", got: ${ctx.ask.text}`);
    }
  });

  registry.define(/^the ask states what the ticket solves, drawn from its notes$/, (ctx) => {
    if (!ctx.ask.text.includes('What it solves:')) {
      throw new Error(`expected a "What it solves:" line, got: ${ctx.ask.text}`);
    }
    if (ctx.ask.text.includes('must never appear in the rendered ask')) {
      throw new Error('expected only the first paragraph of notes, got the second paragraph too');
    }
  });

  registry.define(/^the ask states the ticket's first acceptance signal$/, (ctx) => {
    if (!ctx.ask.text.includes(`First acceptance signal: ${FIRST_ACCEPTANCE_STEP}`)) {
      throw new Error(`expected "First acceptance signal: ${FIRST_ACCEPTANCE_STEP}", got: ${ctx.ask.text}`);
    }
  });

  registry.define(/^the ask is more than the bare pre-change "id plus reply grammar" line$/, (ctx) => {
    if (ctx.ask.text === FROZEN_LINE) {
      throw new Error(`expected more than the bare pre-change line, got exactly: ${ctx.ask.text}`);
    }
  });

  // ── approval-ask-content-02/05 (shared Then) ─────────────────────────
  registry.define(/^the ask still contains the frozen reply-grammar line for approving or rejecting by id$/, (ctx) => {
    if (!ctx.ask.text.includes(FROZEN_LINE)) {
      throw new Error(`expected the frozen reply-grammar line, got: ${ctx.ask.text}`);
    }
  });

  registry.define(/^the ask carries the Approve, Amend, and Reject buttons exactly as before$/, (ctx) => {
    const expected = [
      [
        { text: 'Approve', callbackData: `approve:${BACKLOG_ID}` },
        { text: 'Amend', callbackData: `amend:${BACKLOG_ID}` },
        { text: 'Reject', callbackData: `reject:${BACKLOG_ID}` },
      ],
    ];
    if (JSON.stringify(ctx.ask.buttons) !== JSON.stringify(expected)) {
      throw new Error(`expected the frozen buttons, got: ${JSON.stringify(ctx.ask.buttons)}`);
    }
  });

  // ── approval-ask-content-03 ───────────────────────────────────────────
  registry.define(/^that ticket also carries an approval_context field$/, (ctx) => {
    ctx.folders.paused = [ticket({ title: TITLE, approvalContext: APPROVAL_CONTEXT })];
  });

  registry.define(/^the ask includes the ticket's approval context$/, (ctx) => {
    if (!ctx.ask.text.includes(`Approval context: ${APPROVAL_CONTEXT}`)) {
      throw new Error(`expected "Approval context: ${APPROVAL_CONTEXT}", got: ${ctx.ask.text}`);
    }
  });

  // ── approval-ask-content-04 ───────────────────────────────────────────
  registry.define(/^that ticket's notes block is far longer than a Telegram message allows$/, (ctx) => {
    const hugeNotes = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}: `.padEnd(80, 'x')).join(' ');
    ctx.folders.paused = [ticket({ title: TITLE, notes: hugeNotes })];
  });

  registry.define(/^the ask is truncated$/, (ctx) => {
    if (!ctx.ask.text.includes('…')) {
      throw new Error(`expected a truncation ellipsis, got: ${ctx.ask.text.slice(0, 100)}...`);
    }
  });

  registry.define(/^the ask is within the Telegram message length limit$/, (ctx) => {
    if (ctx.ask.text.length >= TELEGRAM_MESSAGE_LIMIT) {
      throw new Error(`expected the ask under Telegram's ${TELEGRAM_MESSAGE_LIMIT}-char limit, got ${ctx.ask.text.length} chars`);
    }
  });

  // ── approval-ask-content-05 ───────────────────────────────────────────
  registry.define(/^that ticket has no title, notes, acceptance step, or approval context$/, (ctx) => {
    ctx.folders.paused = [ticket()];
  });

  registry.define(/^the ask is non-empty and names the ticket id$/, (ctx) => {
    if (!ctx.ask.text || !ctx.ask.text.includes(BACKLOG_ID)) {
      throw new Error(`expected a non-empty ask naming ${BACKLOG_ID}, got: ${JSON.stringify(ctx.ask.text)}`);
    }
  });

  // ── approval-ask-content-06 ───────────────────────────────────────────
  registry.define(/^a (\S+) event for the same ticket$/, (ctx, eventType) => {
    if (!NON_APPROVAL_EVENT_TYPES.has(eventType)) {
      throw new Error(`unrecognized event type "${eventType}" in scenario outline`);
    }
    ctx.regressionEvent = { type: eventType, backlogId: BACKLOG_ID, payload: {} };
  });

  registry.define(/^that non-approval event message is composed$/, (ctx) => {
    ctx.regressionText = messageTextForEvent(ctx.regressionEvent);
  });

  registry.define(/^the (\S+) render is byte-identical to its pre-change output$/, (ctx, eventType) => {
    if (!NON_APPROVAL_EVENT_TYPES.has(eventType)) {
      throw new Error(`unrecognized event type "${eventType}" in scenario outline`);
    }
    const expected = `${ctx.regressionEvent.type}: ${BACKLOG_ID}`;
    if (ctx.regressionText !== expected) {
      throw new Error(`expected the unchanged pre-BL-480 text "${expected}", got: ${JSON.stringify(ctx.regressionText)}`);
    }
  });
}

module.exports = { registerSteps };
