'use strict';

// BL-301: step handlers for "The Concierge tick routes a NeedsApproval
// event into the gated item's BL-### topic". Drives the REAL compiled
// runConciergeTick directly against fake in-memory adapters (no fs, no
// network, no tmux) - mirrors conciergeRuntimeWiringSteps.js's own
// buildAdapters shape (a distinct Background/fixture, since BL-301's own
// feature has a different Given/Background wording than BL-300's).
const path = require('node:path');

const { runConciergeTick } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'conciergeTick'));

const BACKLOG_ID = 'BL-123';
const TITLE = 'a fine feature';
const ROLE = 'coder';
const OPERATOR_TOPIC_ID = 700;

function buildAdapters(ctx) {
  return {
    readFolders: () => ctx.folders,
    readGates: () => ctx.gates,
    readRoleTicket: () => ctx.roleTicket,
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
        if (ctx.sendShouldFail) {
          return false;
        }
        ctx.sent.push({ topicId, text });
        return true;
      },
      closeTopic: async (topicId) => {
        ctx.closed.push(topicId);
        return true;
      },
      // BL-329: routeEvent (called by runConciergeTick) calls this
      // unconditionally after a successful send.
      recordMessage: () => {},
      // BL-358: the standing Operator topic's id - a fixed fake, distinct
      // from any per-ticket topicId this fixture creates, so an assertion
      // can tell the two destinations apart.
      ensureOperatorTopic: async () => OPERATOR_TOPIC_ID,
    },
  };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the Concierge tick reads the swarm's live gate state alongside its backlog$/, (ctx) => {
    ctx.topicMap = {};
    ctx.created = [];
    ctx.sent = [];
    ctx.closed = [];
    ctx.state = { snapshot: null, emittedKeys: [] };
    ctx.folders = { active: [], paused: [], done: [] };
    ctx.gates = [];
    ctx.roleTicket = {};
    ctx.sendShouldFail = false;
    ctx.adapters = buildAdapters(ctx);
  });

  // ── needs-approval-01 ─────────────────────────────────────────────────
  registry.define(/^a role newly awaiting a human decision while holding (a backlog item|no backlog item)$/, (ctx, holding) => {
    ctx.gates = [{ role: ROLE, gated: true }];
    if (holding === 'a backlog item') {
      ctx.folders.active = [{ id: BACKLOG_ID, title: TITLE }];
      ctx.roleTicket = { [ROLE]: BACKLOG_ID };
    } else {
      ctx.roleTicket = {};
    }
  });

  registry.define(/^the tick derives and routes events$/, async (ctx) => {
    ctx.result = await runConciergeTick(ctx.adapters);
  });

  registry.define(/^a NeedsApproval message is posted into that backlog item's topic$/, (ctx) => {
    if (!ctx.sent.some((m) => m.text === `NeedsApproval: ${BACKLOG_ID}`)) {
      throw new Error(`expected a NeedsApproval message naming ${BACKLOG_ID}, got ${JSON.stringify(ctx.sent)}`);
    }
  });

  // BL-358: an untagged gate now posts into the standing Operator topic
  // (fixed at OPERATOR_TOPIC_ID in this fixture) rather than being dropped -
  // asserts both that the message posted AND that it went to the Operator
  // topic specifically, never a per-ticket one (no ticket exists to own).
  registry.define(/^a NeedsApproval message is posted into the standing Operator topic$/, (ctx) => {
    if (!ctx.sent.some((m) => m.text === `NeedsApproval: ${ROLE}` && m.topicId === OPERATOR_TOPIC_ID)) {
      throw new Error(`expected a NeedsApproval message naming ${ROLE} in the Operator topic (${OPERATOR_TOPIC_ID}), got ${JSON.stringify(ctx.sent)}`);
    }
    if (ctx.created.length !== 0) {
      throw new Error(`expected no per-ticket topic to be created for an untagged gate, got ${JSON.stringify(ctx.created)}`);
    }
  });

  // ── needs-approval-02 ─────────────────────────────────────────────────
  registry.define(/^a NeedsApproval whose post failed while the role stays gated$/, async (ctx) => {
    ctx.folders.active = [{ id: BACKLOG_ID, title: TITLE }];
    ctx.roleTicket = { [ROLE]: BACKLOG_ID };
    ctx.gates = [{ role: ROLE, gated: true }];
    // The topic already exists (an earlier TaskStarted opened it, already
    // emitted) so this tick's own NeedsApproval is the ONLY pending
    // transition - isolates the retry to it alone.
    ctx.topicMap[BACKLOG_ID] = 42;
    ctx.state = { snapshot: { backlog: { active: [BACKLOG_ID], paused: [], done: [] }, gates: [], roleTicket: {} }, emittedKeys: ['TaskStarted:' + BACKLOG_ID] };
    ctx.sendShouldFail = true;
    ctx.firstResult = await runConciergeTick(ctx.adapters);
  });

  registry.define(/^the tick runs again$/, async (ctx) => {
    ctx.sendShouldFail = false;
    ctx.result = await runConciergeTick(ctx.adapters);
  });

  registry.define(/^the NeedsApproval is routed again rather than dropped for good$/, (ctx) => {
    if (ctx.firstResult.routed !== 0) {
      throw new Error(`expected the failed first tick to route nothing, got ${ctx.firstResult.routed}`);
    }
    if (ctx.result.routed !== 1) {
      throw new Error(`expected the retry tick to route exactly one event, got ${ctx.result.routed}`);
    }
    if (!ctx.sent.some((m) => m.text === `NeedsApproval: ${BACKLOG_ID}` && m.topicId === 42)) {
      throw new Error(`expected the retried NeedsApproval to post into topic 42, got ${JSON.stringify(ctx.sent)}`);
    }
  });
}

module.exports = { registerSteps };
