'use strict';

// BL-330: step handlers for "A ticket's topic lifecycle is reconciled from
// state, not only from a transition". Drives the REAL compiled
// reconcileTopicLifecycle (extension/out/concierge/topicReconciliation),
// with a fake postMessage/editMessage (the real Telegram HTTP leg, the
// SAME boundary this session's other acceptance suites draw) but the REAL
// production reconciliation logic underneath - not a hand-rolled
// substitute. BL-493: reconciliation now brings a ticket's edit-in-place
// status message to 'done', targeting its epic topic (epic-bound) or the
// standing Backlog topic (epic-less) - never a per-ticket topic to close.
const path = require('node:path');

const { reconcileTopicLifecycle } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'topicReconciliation'));
const { buildTicketStatusText } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'ticketStatusMessage'));

const BACKLOG_TOPIC_ID = 760;

function mkAdapters(ctx) {
  ctx.posted = ctx.posted || [];
  ctx.edited = ctx.edited || [];
  ctx.alreadyReconciledIds = ctx.alreadyReconciledIds || [];
  ctx.messageStates = ctx.messageStates || {};
  return {
    getTopicMap: () => ctx.topicMap,
    isAlreadyReconciled: (backlogId) => ctx.alreadyReconciledIds.includes(backlogId),
    routeAdapters: {
      getTopicMap: () => ctx.topicMap,
      createTopic: async (name) => {
        throw new Error(`reconciliation must never create a per-ticket topic, got a createTopic call for "${name}"`);
      },
      recordTopicId: () => {
        throw new Error('reconciliation must never create a per-ticket topic');
      },
      sendMessage: async () => true,
      closeTopic: async () => {
        throw new Error('reconciliation must never close a topic - it is SHARED (epic/Backlog), never this one ticket\'s to close');
      },
      recordMessage: (backlogId, text) => {
        // Simulates BL-329's own durable record advancing - a REAL
        // isAlreadyReconciled (backed by readRecord) would now see this
        // exact text and correctly no-op on a second sweep, which is
        // exactly what the "already reconciled" scenario below asserts
        // by driving the SAME check this real callback feeds.
        if (!ctx.alreadyReconciledIds.includes(backlogId)) {
          ctx.alreadyReconciledIds.push(backlogId);
        }
      },
      ensureOperatorTopic: async () => undefined,
      ensureApprovalsTopic: async () => undefined,
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
    },
  };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the swarm posts to a Telegram topic for each backlog ticket$/, (ctx) => {
    ctx.ticketId = 'BL-900';
    ctx.ticketTitle = 'a fine feature';
    // BL-493: epic-less - no per-ticket topic map entry (none exists) -
    // the ticket's status message targets the standing Backlog topic.
    ctx.topicMap = {};
  });

  // ── topic-reconciliation-01 ──────────────────────────────────────────
  registry.define(/^a ticket became done while the bot was not running$/, (ctx) => {
    // "The bot was not running" is exactly why the diff path never fired -
    // this scenario's own Given is a STATE fact (the ticket is done, its
    // status message never reached 'done'), not a simulated event the
    // bot missed - reconciliation works from state alone, by design.
    ctx.doneTickets = [{ id: ctx.ticketId, title: ctx.ticketTitle }];
  });

  registry.define(/^the bot reconciles the topic lifecycle$/, async (ctx) => {
    ctx.result = await reconcileTopicLifecycle(ctx.doneTickets, mkAdapters(ctx));
  });

  registry.define(/^that ticket's topic is brought to its completed state$/, (ctx) => {
    const expectedText = buildTicketStatusText(ctx.ticketId, ctx.ticketTitle, 'done');
    if (!ctx.posted.some((s) => s.topicId === BACKLOG_TOPIC_ID && s.text === expectedText)) {
      throw new Error(`expected a 'done' status message posted, got posted=${JSON.stringify(ctx.posted)}`);
    }
  });

  registry.define(/^the completion is not lost$/, (ctx) => {
    if (ctx.result.reconciled.indexOf(ctx.ticketId) === -1) {
      throw new Error(`expected ${ctx.ticketId} in the reconciled list, got ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── topic-reconciliation-02 ──────────────────────────────────────────
  registry.define(/^a ticket is done and its topic is not yet in its completed state$/, (ctx) => {
    ctx.doneTickets = [{ id: ctx.ticketId, title: ctx.ticketTitle }];
  });

  // ── topic-reconciliation-03 ──────────────────────────────────────────
  registry.define(/^a done ticket whose topic is already in its completed state$/, async (ctx) => {
    ctx.doneTickets = [{ id: ctx.ticketId, title: ctx.ticketTitle }];
    // Reconcile once for real, so "already in its completed state" is a
    // genuine post-reconciliation fact, not an invented precondition.
    await reconcileTopicLifecycle(ctx.doneTickets, mkAdapters(ctx));
    ctx.postedBeforeSecondSweep = ctx.posted.length;
    ctx.editedBeforeSecondSweep = ctx.edited.length;
  });

  registry.define(/^the topic is left as it is$/, (ctx) => {
    if (ctx.result.reconciled.length !== 0) {
      throw new Error(`expected nothing reconciled on an already-completed topic, got ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^it is not posted to or closed a second time$/, (ctx) => {
    if (ctx.posted.length !== ctx.postedBeforeSecondSweep || ctx.edited.length !== ctx.editedBeforeSecondSweep) {
      throw new Error(
        `expected no further post/edit on the second sweep, had posted=${ctx.postedBeforeSecondSweep} edited=${ctx.editedBeforeSecondSweep}, now posted=${ctx.posted.length} edited=${ctx.edited.length}`
      );
    }
  });

  // ── topic-reconciliation-04 ──────────────────────────────────────────
  registry.define(/^a ticket that is still in flight$/, (ctx) => {
    // The structural guarantee reconcileTopicLifecycle itself provides:
    // an in-flight ticket is simply never in the done list passed in.
    ctx.doneTickets = [];
  });

  registry.define(/^that ticket's topic is left open$/, (ctx) => {
    if (ctx.posted.length !== 0 || ctx.edited.length !== 0) {
      throw new Error(`expected no post/edit for an in-flight ticket, got posted=${JSON.stringify(ctx.posted)} edited=${JSON.stringify(ctx.edited)}`);
    }
    if (ctx.result.reconciled.length !== 0) {
      throw new Error(`expected nothing reconciled for an in-flight ticket, got ${JSON.stringify(ctx.result)}`);
    }
  });
}

module.exports = { registerSteps };
