'use strict';

// BL-1090: lost tick baseline must not re-post an ask already on the live
// Approvals topic. Drives REAL runConciergeTick + approvalAskReconcile
// (extension/out) — never a parallel reimplementation.
const assert = require('node:assert/strict');
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { runConciergeTick } = require(path.join(EXT_OUT, 'concierge', 'conciergeTick'));
const {
  approvalAskRecordedOnLiveTopic,
  approvalAsksNeedingRepost,
} = require(path.join(EXT_OUT, 'concierge', 'approvalAskReconcile'));

const FEATURE =
  'A lost tick baseline never re-posts an approval ask that is already live';
const TICKET_ID = 'BL-1090';
const LIVE_TOPIC = 750;
const STALE_TOPIC = 100;

/** Outline / Given location phrases → recorded ask map (or empty). */
const ASK_BY_LOCATION = {
  'against the live Approvals topic': { [TICKET_ID]: { topicId: LIVE_TOPIC } },
  'against a topic id that is not the live Approvals topic': {
    [TICKET_ID]: { topicId: STALE_TOPIC },
  },
  nowhere: {},
};

function emptyFolders() {
  return { active: [], paused: [], done: [] };
}

function foldersWithPending() {
  return {
    active: [],
    paused: [{ id: TICKET_ID, title: 'lost-baseline fixture', humanApproval: 'pending' }],
    done: [],
  };
}

function lostBaselineTickState() {
  return {
    snapshot: {
      backlog: { active: [], paused: [TICKET_ID], done: [] },
      gates: [],
      roleTicket: {},
      ticketSummaries: { [TICKET_ID]: { title: 'lost-baseline fixture' } },
      pendingApproval: [],
    },
    emittedKeys: [],
  };
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
        return { success: true, messageId: asks.length };
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
    ctx.liveApprovalsTopicId = LIVE_TOPIC;
    ctx.folders = emptyFolders();
    ctx.tickState = { snapshot: null, emittedKeys: [] };
    ctx.recordedAsks = {};
  });

  scoped(/^a ticket is awaiting human approval$/, (ctx) => {
    ctx.folders = foldersWithPending();
  });

  scoped(/^the ticket's ask is recorded (.+)$/, (ctx, location) => {
    if (!(location in ASK_BY_LOCATION)) {
      throw new Error(`BL-1090: unknown ask location "${location}"`);
    }
    ctx.recordedAsks = { ...ASK_BY_LOCATION[location] };
  });

  scoped(/^the durable tick state was never written for that transition$/, (ctx) => {
    ctx.tickState = lostBaselineTickState();
  });

  scoped(/^the concierge tick runs$/, async (ctx) => {
    ctx.adapters = buildAdapters(ctx);
    ctx.tickResult = await runConciergeTick(ctx.adapters);
  });

  scoped(/^no approval ask is sent for the ticket$/, (ctx) => {
    assert.equal(ctx.asks.length, 0, `expected no ask; got ${JSON.stringify(ctx.asks)}`);
  });

  scoped(/^exactly one approval ask is sent for the ticket$/, (ctx) => {
    assert.equal(ctx.asks.length, 1, `expected one ask; got ${JSON.stringify(ctx.asks)}`);
  });

  scoped(/^the approval ask is sent to the live Approvals topic$/, (ctx) => {
    assert.equal(ctx.asks[0].topicId, LIVE_TOPIC);
  });

  scoped(/^the durable tick state records the approval transition as already emitted$/, (ctx) => {
    assert.ok(
      ctx.tickState.emittedKeys.includes(`ApprovalRequested:${TICKET_ID}`),
      `emittedKeys=${JSON.stringify(ctx.tickState.emittedKeys)}`
    );
  });

  scoped(/^the durable tick state still lists the ticket as awaiting approval$/, (ctx) => {
    assert.deepEqual(ctx.tickState.snapshot.pendingApproval, [TICKET_ID]);
  });

  scoped(/^each path is asked whether that ask is already live$/, (ctx) => {
    const edge = approvalAskRecordedOnLiveTopic(TICKET_ID, ctx.recordedAsks, LIVE_TOPIC);
    const needing = approvalAsksNeedingRepost(
      [TICKET_ID],
      ctx.recordedAsks,
      LIVE_TOPIC,
      new Set()
    );
    ctx.pathAnswers = { edge, reconcile: !needing.includes(TICKET_ID) };
  });

  scoped(/^both paths answer (yes|no)$/, (ctx, expected) => {
    const want = expected === 'yes';
    assert.equal(ctx.pathAnswers.edge, want, 'edge path disagreed');
    assert.equal(ctx.pathAnswers.reconcile, want, 'reconcile path disagreed');
  });
}

module.exports = { registerSteps };
