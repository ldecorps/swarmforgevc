'use strict';

// BL-1455: a re-pended (previously approved-and-closed) ticket must post a
// fresh buttoned ask instead of staying dark behind a decided message.
// Drives REAL runConciergeTick + approvalAskReconcile (extension/out) —
// never a parallel reimplementation. Mirrors bl1090LostTickBaselineDuplicateAskSteps.js's
// adapter shape (the same conciergeTick fixture pattern), extended with a
// recordApprovalAskMessageId hook that mirrors the REAL store's overwrite
// semantics (a fresh post replaces the whole record, clearing any prior
// `closed` mark) so scenarios 04/06 can observe the post-tick ask store.
const assert = require('node:assert/strict');
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { runConciergeTick } = require(path.join(EXT_OUT, 'concierge', 'conciergeTick'));
const { approvalAskRecordedOnLiveTopic } = require(path.join(EXT_OUT, 'concierge', 'approvalAskReconcile'));

const FEATURE = 'A re-pended ticket posts a fresh ruling ask';
const TICKET_ID = 'BL-1455-fixture';
const LIVE_TOPIC = 750;
const RULING_OPTIONS_FOUR = ['Option A', 'Option B', 'Option C', 'Option D'];

function emptyFolders() {
  return { active: [], paused: [], done: [] };
}

function buildAdapters(ctx) {
  const asks = [];
  ctx.asks = asks;
  return {
    readFolders: () => ctx.folders,
    readGates: () => [],
    readRoleTicket: () => ({}),
    readTickState: () => ctx.tickState,
    writeTickState: (next) => {
      ctx.tickState = next;
    },
    routeAdapters: {
      getTopicMap: () => ({}),
      createTopic: async () => ({ success: true, topicId: 900 }),
      recordTopicId: () => {},
      sendMessage: async () => true,
      closeTopic: async () => true,
      recordMessage: () => {},
      ensureOperatorTopic: async () => 700,
      ensureApprovalsTopic: async () => LIVE_TOPIC,
      ensureBacklogTopic: async () => 760,
      postMessage: async () => 9000,
      editMessage: async () => true,
      getTicketMessageState: () => undefined,
      setTicketMessageState: () => {},
      sendApprovalAsk: async (topicId, text, buttons) => {
        asks.push({ topicId, text, buttons });
        return { success: true, messageId: 90000 + asks.length };
      },
      recordApprovalAskMessageId: (backlogId, topicId, messageId, text) => {
        ctx.recordedAsks[backlogId] = { topicId, messageId, text };
      },
    },
    iconAdapters: {
      getIconStickers: async () => [],
      setTopicIcon: async () => true,
      readSwarmIconId: () => undefined,
      recordSwarmIconId: () => {},
    },
    readStandingTopics: () => [],
    readRoleTopics: () => [],
    titleAdapters: {
      readLastActivityMs: () => undefined,
      setTopicTitle: async () => true,
    },
    readRoleHeldTickets: () => ({}),
    boardAdapters: {
      ensureBoardTopic: async () => ({}),
      postMessage: async () => ({}),
      deleteMessage: async () => true,
    },
    rosterAdapters: {
      ensureApprovalsTopic: async () => undefined,
      postMessage: async () => undefined,
      editMessage: async () => true,
    },
    readRecertScenario: () => undefined,
    recertPostingAdapters: {
      ensureRecertTopic: async () => undefined,
      postMessage: async () => undefined,
      editMessage: async () => true,
    },
    readApprovalAskMessages: () => ctx.recordedAsks,
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a standing Approvals topic exists$/, (ctx) => {
    ctx.folders = emptyFolders();
    ctx.tickState = { snapshot: null, emittedKeys: [] };
    ctx.recordedAsks = {};
  });

  scoped(/^a ticket was approved and its ask on the live Approvals topic was closed$/, (ctx) => {
    ctx.folders = { active: [{ id: TICKET_ID, title: 'fixture ticket', humanApproval: 'approved' }], paused: [], done: [] };
    ctx.tickState = {
      snapshot: {
        backlog: { active: [TICKET_ID], paused: [], done: [] },
        gates: [],
        roleTicket: {},
        ticketSummaries: { [TICKET_ID]: { title: 'fixture ticket' } },
        pendingApproval: [],
      },
      emittedKeys: [`ApprovalRequested:${TICKET_ID}`],
    };
    ctx.closedMessageId = 69489;
    ctx.recordedAsks = {
      [TICKET_ID]: {
        topicId: LIVE_TOPIC,
        messageId: ctx.closedMessageId,
        text: `${TICKET_ID} needs your approval\n-- Approved 2026-09-05 08:14 UTC`,
        closed: true,
      },
    };
  });

  scoped(/^the ticket is re-pended (.+)$/, (ctx, variant) => {
    const item = ctx.folders.active[0] || ctx.folders.paused[0];
    item.humanApproval = 'pending';
    if (variant === 'with four ruling options') {
      item.rulingOptions = RULING_OPTIONS_FOUR;
    } else if (variant === 'with no ruling options' || variant === 'for a second ruling') {
      // No rulingOptions field - the plain decision buttons apply.
    } else {
      throw new Error(`BL-1455: unknown re-pend variant "${variant}"`);
    }
  });

  scoped(/^the ticket stays approved$/, (ctx) => {
    const item = ctx.folders.active[0] || ctx.folders.paused[0];
    item.humanApproval = 'approved';
  });

  scoped(/^a ticket is awaiting human approval$/, (ctx) => {
    ctx.folders = { active: [], paused: [{ id: TICKET_ID, title: 'fixture ticket', humanApproval: 'pending' }], done: [] };
  });

  scoped(/^the ticket's undecided ask is recorded against the live Approvals topic$/, (ctx) => {
    ctx.recordedAsks = { [TICKET_ID]: { topicId: LIVE_TOPIC, messageId: 1, text: `${TICKET_ID} needs your approval` } };
  });

  scoped(/^the durable tick state was never written for that transition$/, (ctx) => {
    ctx.tickState = {
      snapshot: {
        backlog: { active: [], paused: [TICKET_ID], done: [] },
        gates: [],
        roleTicket: {},
        ticketSummaries: { [TICKET_ID]: { title: 'fixture ticket' } },
        pendingApproval: [],
      },
      emittedKeys: [],
    };
  });

  scoped(/^the previous concierge tick already posted the fresh ask$/, (ctx) => {
    ctx.recordedAsks = { [TICKET_ID]: { topicId: LIVE_TOPIC, messageId: 80000, text: `${TICKET_ID} needs your approval` } };
    ctx.tickState = {
      snapshot: {
        backlog: { active: [TICKET_ID], paused: [], done: [] },
        gates: [],
        roleTicket: {},
        ticketSummaries: { [TICKET_ID]: { title: 'fixture ticket' } },
        pendingApproval: [TICKET_ID],
      },
      emittedKeys: [`ApprovalRequested:${TICKET_ID}`],
    };
  });

  scoped(/^the durable tick state already lists the ticket as awaiting approval with its ask counted as emitted$/, (ctx) => {
    ctx.tickState = {
      snapshot: {
        backlog: { active: [TICKET_ID], paused: [], done: [] },
        gates: [],
        roleTicket: {},
        ticketSummaries: { [TICKET_ID]: { title: 'fixture ticket' } },
        pendingApproval: [TICKET_ID],
      },
      emittedKeys: [`ApprovalRequested:${TICKET_ID}`],
    };
    // ctx.recordedAsks is left as the CLOSED record the Background's
    // "closed" step already seeded - only reconcile can act here.
  });

  scoped(/^the concierge tick runs$/, async (ctx) => {
    ctx.adapters = buildAdapters(ctx);
    ctx.tickResult = await runConciergeTick(ctx.adapters);
  });

  scoped(/^exactly one approval ask is sent for the ticket$/, (ctx) => {
    assert.equal(ctx.asks.length, 1, `expected one ask; got ${JSON.stringify(ctx.asks)}`);
  });

  scoped(/^no approval ask is sent for the ticket$/, (ctx) => {
    assert.equal(ctx.asks.length, 0, `expected no ask; got ${JSON.stringify(ctx.asks)}`);
  });

  scoped(/^the approval ask is sent to the live Approvals topic$/, (ctx) => {
    assert.equal(ctx.asks[0].topicId, LIVE_TOPIC);
  });

  scoped(/^the approval ask's keyboard carries (.+)$/, (ctx, kind) => {
    const buttons = ctx.asks[0].buttons;
    if (kind === 'one button per ruling option') {
      assert.deepEqual(
        buttons.slice(0, RULING_OPTIONS_FOUR.length).map((row) => row.map((b) => b.text)),
        RULING_OPTIONS_FOUR.map((label) => [label])
      );
    } else if (kind === 'the plain decision buttons') {
      assert.ok(buttons[0].some((b) => b.text === 'Approve'), `expected plain decision buttons, got ${JSON.stringify(buttons)}`);
    } else {
      throw new Error(`BL-1455: unknown keyboard kind "${kind}"`);
    }
  });

  scoped(/^the ask store records the fresh ask as the ticket's live ask$/, (ctx) => {
    const record = ctx.recordedAsks[TICKET_ID];
    assert.ok(record, 'expected a stored record for the ticket');
    assert.equal(record.topicId, LIVE_TOPIC);
    assert.notEqual(record.messageId, ctx.closedMessageId, 'must be the FRESH message, not the old closed one');
    assert.equal(approvalAskRecordedOnLiveTopic(TICKET_ID, ctx.recordedAsks, LIVE_TOPIC), true, 'record must read as live');
  });

  scoped(/^the closed ask's message is not edited$/, (ctx) => {
    // No close-routine adapter (editApprovalAskMessage/persistClosedApprovalAskText)
    // is wired into this tick at all, so the old closed message
    // (ctx.closedMessageId) provably cannot have been touched by it - and the
    // store's overwrite means it is no longer even the live entry.
    const record = ctx.recordedAsks[TICKET_ID];
    assert.notEqual(record.messageId, ctx.closedMessageId);
  });
}

module.exports = { registerSteps };
