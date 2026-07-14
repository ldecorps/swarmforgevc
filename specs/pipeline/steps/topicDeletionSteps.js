'use strict';

// BL-331: step handlers for "A done ticket's topic is archived into the
// repo and only then deleted". Drives the REAL compiled sweepTopicDeletions
// (extension/out/concierge/topicDeletion), with a fake deleteTopic (the
// real Telegram HTTP leg, the same boundary this session's other
// acceptance suites draw) but REAL decision logic (decideTopicDeletion,
// hasCompletionRecord, completionSummaryText) underneath - the actual
// production verify-then-delete gate, not a hand-rolled substitute.
const path = require('node:path');

const { sweepTopicDeletions } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'topicDeletion'));
const { completionSummaryText, backlogForTopic } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'topicRouter'));

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 7 * ONE_DAY_MS;

function completionTextFor(ctx) {
  return completionSummaryText({ type: 'TaskCompleted', backlogId: ctx.ticketId, payload: {} }, ctx.ticketTitle);
}

function mkAdapters(ctx) {
  ctx.deletedTopics = ctx.deletedTopics || [];
  ctx.droppedMappings = ctx.droppedMappings || [];
  ctx.reportedUnverified = ctx.reportedUnverified || [];
  return {
    getTopicMap: () => ctx.topicMap,
    readRecord: () => ctx.record,
    // The feature's own scenarios are about CONTENT verification; git
    // durability is a separate, unit-tested concern (topicDeletion.test.js/
    // blTopicStore.test.js, against real git repos) - always committed here
    // so this suite keeps testing exactly what it always tested.
    isRecordCommitted: () => true,
    deleteTopic: async (topicId) => {
      ctx.deletedTopics.push(topicId);
      return true;
    },
    dropTopicMapping: (backlogId) => {
      ctx.droppedMappings.push(backlogId);
      delete ctx.topicMap[backlogId];
    },
    reportUnverifiedDeletion: (ticketId) => {
      ctx.reportedUnverified.push(ticketId);
    },
  };
}

async function runSweep(ctx) {
  return sweepTopicDeletions([{ id: ctx.ticketId, title: ctx.ticketTitle }], mkAdapters(ctx), ctx.nowMs, RETENTION_MS);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a completed ticket whose topic content has been serialised into the repository$/, (ctx) => {
    ctx.ticketId = 'BL-950';
    ctx.ticketTitle = 'a fine feature';
    ctx.topicId = 42;
    ctx.topicMap = { [ctx.ticketId]: ctx.topicId };
    // Outside the retention window unless a scenario's own Given overrides
    // it - the background alone represents a ticket that is both verified
    // AND old enough to sweep, so scenario 01/03 need no extra Given.
    ctx.nowMs = RETENTION_MS + ONE_DAY_MS;
    ctx.record = {
      id: ctx.ticketId,
      messages: [{ seq: 0, ts: 0, author: 'swarm', type: 'outbound', text: completionTextFor(ctx) }],
    };
  });

  // ── archive-then-delete-01 ───────────────────────────────────────────
  registry.define(/^the topic sweep considers that ticket$/, async (ctx) => {
    ctx.result = await runSweep(ctx);
  });

  registry.define(/^its serialised record is verified complete in the repository$/, (ctx) => {
    if (!ctx.record.messages.some((m) => m.type === 'outbound' && m.text === completionTextFor(ctx))) {
      throw new Error('expected the record to contain the verified completion message');
    }
  });

  registry.define(/^the record is verified before any deletion is attempted$/, (ctx) => {
    // The background's record is verified AND past retention - the sweep
    // having actually deleted the topic is the proof the verify-then-
    // delete gate ran to completion (decideTopicDeletion's own structural
    // order), not merely that the fixture claims verification.
    if (!ctx.deletedTopics.includes(ctx.topicId)) {
      throw new Error(`expected the topic actually deleted once verified, got deletedTopics=${JSON.stringify(ctx.deletedTopics)}`);
    }
  });

  // ── archive-then-delete-02 ───────────────────────────────────────────
  registry.define(/^the serialised record is missing or incomplete$/, (ctx) => {
    ctx.record = { id: ctx.ticketId, messages: [] };
  });

  registry.define(/^the topic would be deleted$/, async (ctx) => {
    ctx.result = await runSweep(ctx);
  });

  registry.define(/^the deletion does not happen$/, (ctx) => {
    if (ctx.result.deleted.length !== 0) {
      throw new Error(`expected nothing deleted, got ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^the failure is surfaced loudly$/, (ctx) => {
    if (!ctx.reportedUnverified.includes(ctx.ticketId)) {
      throw new Error(`expected ${ctx.ticketId} reported as an unverified deletion, got ${JSON.stringify(ctx.reportedUnverified)}`);
    }
  });

  registry.define(/^the topic and its record are left intact$/, (ctx) => {
    if (ctx.topicMap[ctx.ticketId] !== ctx.topicId) {
      throw new Error('expected the topic mapping to remain untouched');
    }
    if (ctx.droppedMappings.length !== 0) {
      throw new Error('expected no mapping ever dropped');
    }
  });

  // ── archive-then-delete-03 ───────────────────────────────────────────
  registry.define(/^a ticket has been deleted after its record was verified$/, async (ctx) => {
    ctx.result = await runSweep(ctx); // background's record is verified + past retention
    if (!ctx.result.deleted.includes(ctx.ticketId)) {
      throw new Error("expected the background ticket to have actually been deleted as this scenario's precondition");
    }
  });

  registry.define(/^the swarm next has something to say about that ticket$/, (ctx) => {
    ctx.reverseLookupAfterDelete = backlogForTopic(ctx.topicMap, ctx.topicId);
  });

  registry.define(/^it does not post to the deleted thread$/, (ctx) => {
    if (ctx.reverseLookupAfterDelete !== undefined) {
      throw new Error(`expected no ticket to resolve from the deleted topic id, got ${ctx.reverseLookupAfterDelete}`);
    }
  });

  registry.define(/^that ticket no longer maps to a topic$/, (ctx) => {
    if (ctx.topicMap[ctx.ticketId] !== undefined) {
      throw new Error('expected the mapping dropped');
    }
  });

  // ── archive-then-delete-04 / 05 (share "the topic sweep runs" and "that
  //    ticket's topic is not deleted" - identical step text, one handler
  //    each, same convention as the reconciliation steps' shared text) ──
  registry.define(/^a ticket completed within the retention window$/, (ctx) => {
    ctx.record.messages[0].ts = ctx.nowMs - 1; // 1ms ago - deep inside any positive window
  });

  registry.define(/^the topic sweep runs$/, async (ctx) => {
    ctx.result = await runSweep(ctx);
  });

  registry.define(/^that ticket's topic is not deleted$/, (ctx) => {
    if (ctx.result.deleted.length !== 0) {
      throw new Error(`expected nothing deleted, got ${JSON.stringify(ctx.result)}`);
    }
    if (ctx.topicMap[ctx.ticketId] === undefined) {
      throw new Error('expected the mapping to remain');
    }
  });

  registry.define(/^a completed ticket whose topic has no verified record$/, (ctx) => {
    ctx.record = { id: ctx.ticketId, messages: [] };
  });
}

module.exports = { registerSteps };
