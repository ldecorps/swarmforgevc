'use strict';

// BL-358: step handlers for "A blocked role reaches the human even when its
// question belongs to no ticket". Drives the REAL compiled runConciergeTick
// against fake in-memory adapters for the OUTBOUND half (mirrors
// conciergeNeedsApprovalSteps.js's own buildAdapters shape), and the REAL
// handleApprovalDecisionForTicket/selectGateDecisionForTicket for the
// INBOUND answer half - proving BL-325's existing answer loop (already
// falls back to the count-based selector for any targetBacklogId that
// matches no role's held ticket, including the Operator topic's own
// reserved subject id) needs no change at all, per the ticket's own "ship
// and prove the LOOP, not the legs" instruction.
const path = require('node:path');

const { runConciergeTick } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'conciergeTick'));
const { handleApprovalDecisionForTicket } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'bridge', 'operatorDecideStatus'));

const BACKLOG_ID = 'BL-777';
const TITLE = 'a fine feature';
const ROLE = 'specifier';
const OPERATOR_TOPIC_ID = 700;
const QUESTION = 'Which design should I pick? (1/2/3)';

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
        ctx.sent.push({ topicId, text });
        return true;
      },
      closeTopic: async () => true,
      recordMessage: () => {},
      ensureOperatorTopic: async () => OPERATOR_TOPIC_ID,
      // BL-493: the standing Backlog topic + edit-in-place post/edit pair -
      // this feature's own scenarios don't assert on ticket-status
      // routing, but runConciergeTick's own TaskStarted derivation (the
      // ticket-holding scenario) unconditionally reaches these now.
      ensureBacklogTopic: async () => 760,
      postMessage: async () => 9000,
      editMessage: async () => true,
      getTicketMessageState: () => undefined,
      setTicketMessageState: () => {},
    },
    iconAdapters: {
      // BL-342: a safe default for fixtures that predate topic icons and
      // do not exercise them - an empty sticker list means syncTopicIcon
      // always no-ops (skipped-unresolved-icon), so runConciergeTick's own
      // icon-sync pass never calls setTopicIcon unexpectedly here.
      getIconStickers: async () => [],
      setTopicIcon: async () => true,
      readSwarmIconId: () => undefined,
      recordSwarmIconId: () => {},
    },
  };
}

function resetFixture(ctx) {
  ctx.topicMap = {};
  ctx.created = [];
  ctx.sent = [];
  ctx.state = { snapshot: null, emittedKeys: [] };
  ctx.folders = { active: [], paused: [], done: [] };
  ctx.gates = [];
  ctx.roleTicket = {};
  ctx.adapters = buildAdapters(ctx);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a role is blocked waiting on the human$/, (ctx) => {
    resetFixture(ctx);
    ctx.gates = [{ role: ROLE, gated: true, snippet: QUESTION }];
  });

  // ── untagged-gate-reaches-the-human-01/02 ────────────────────────────
  registry.define(/^the blocked role holds no ticket$/, (ctx) => {
    ctx.roleTicket = {};
  });

  registry.define(/^the blocked role holds a ticket$/, (ctx) => {
    ctx.folders.active = [{ id: BACKLOG_ID, title: TITLE }];
    ctx.roleTicket = { [ROLE]: BACKLOG_ID };
  });

  registry.define(/^the swarm notices the role is blocked$/, async (ctx) => {
    ctx.result = await runConciergeTick(ctx.adapters);
  });

  registry.define(/^the human is asked the role's question in the standing Operator topic$/, (ctx) => {
    if (!ctx.sent.some((m) => m.topicId === OPERATOR_TOPIC_ID && m.text === `NeedsApproval: ${ROLE} - ${QUESTION}`)) {
      throw new Error(`expected the role's question posted into the Operator topic (${OPERATOR_TOPIC_ID}), got ${JSON.stringify(ctx.sent)}`);
    }
    if (ctx.created.length !== 0) {
      throw new Error(`expected no per-ticket topic created for an untagged gate, got ${JSON.stringify(ctx.created)}`);
    }
  });

  // BL-358/BL-493 (human decision, 2026-07-17): a tagged NeedsApproval no
  // longer has a per-ticket topic to post into (none is ever created) - it
  // now asks in the SAME standing Operator topic an untagged gate always
  // used, with the ticket id folded into the question text itself
  // (messageTextForEvent's own backlogId-first identity) rather than a
  // separate topic. This step's own Gherkin wording ("in that ticket's
  // topic") is now stale prose the specifier should retire/reword - the
  // invariant it protects (the role's own question reaches the human,
  // legibly tied to its ticket) still holds and is what this asserts.
  registry.define(/^the human is asked the role's question in that ticket's topic$/, (ctx) => {
    if (!ctx.sent.some((m) => m.topicId === OPERATOR_TOPIC_ID && m.text === `NeedsApproval: ${BACKLOG_ID} - ${QUESTION}`)) {
      throw new Error(`expected the role's question (naming ${BACKLOG_ID}) posted into the standing Operator topic (${OPERATOR_TOPIC_ID}), got ${JSON.stringify(ctx.sent)}`);
    }
    if (ctx.created.length !== 0) {
      throw new Error(`expected no per-ticket topic created for a tagged gate either, got ${JSON.stringify(ctx.created)}`);
    }
  });

  // ── untagged-gate-reaches-the-human-03 (the answer loop) ─────────────
  registry.define(/^its question has been posted in the standing Operator topic$/, async (ctx) => {
    await runConciergeTick(ctx.adapters);
    if (!ctx.sent.some((m) => m.topicId === OPERATOR_TOPIC_ID)) {
      throw new Error('setup: expected the question to already be posted in the Operator topic');
    }
  });

  registry.define(/^the human answers there$/, (ctx) => {
    // BL-325 scope 6's own resolver: a targetBacklogId that matches no
    // role's held ticket (the Operator topic's reserved subject id is
    // never a BL-### value) falls back to the count-based selector -
    // proven already by operatorDecideStatus.test.js's own "held by no
    // role at all" case; this exercises the SAME real function end to end.
    const pendingGates = ctx.gates.filter((g) => g.gated);
    ctx.answerGateCalls = [];
    ctx.decision = handleApprovalDecisionForTicket(pendingGates, ctx.roleTicket, 'OPERATOR', 'Go with option 2', {
      answerGate: (role, answer) => {
        ctx.answerGateCalls.push({ role, answer });
        // Answering unblocks the role - mirrors answerCapturedGateLive's
        // own real effect (the pane resumes, so the next gate read is false).
        ctx.gates = ctx.gates.map((g) => (g.role === role ? { ...g, gated: false } : g));
        return { success: true };
      },
      reply: (text) => {
        ctx.reply = text;
      },
    });
  });

  registry.define(/^the answer reaches the blocked role$/, (ctx) => {
    if (ctx.answerGateCalls.length !== 1 || ctx.answerGateCalls[0].role !== ROLE) {
      throw new Error(`expected exactly one answerGate call for ${ROLE}, got ${JSON.stringify(ctx.answerGateCalls)}`);
    }
  });

  registry.define(/^the role resumes work$/, (ctx) => {
    const gate = ctx.gates.find((g) => g.role === ROLE);
    if (!gate || gate.gated !== false) {
      throw new Error(`expected ${ROLE}'s gate to be cleared after the answer, got ${JSON.stringify(gate)}`);
    }
  });

  // ── untagged-gate-reaches-the-human-04 (ask once) ────────────────────
  registry.define(/^the swarm reviews the gates again while the role is still blocked$/, async (ctx) => {
    ctx.sentBeforeSecondTick = ctx.sent.length;
    ctx.result = await runConciergeTick(ctx.adapters); // same gates, unchanged - still blocked
  });

  registry.define(/^no second question is posted in the standing Operator topic$/, (ctx) => {
    if (ctx.sent.length !== ctx.sentBeforeSecondTick) {
      throw new Error(`expected no additional message on the second tick, got ${JSON.stringify(ctx.sent)}`);
    }
  });
}

module.exports = { registerSteps };
