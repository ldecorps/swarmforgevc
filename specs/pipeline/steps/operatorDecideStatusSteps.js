'use strict';

// BL-285: step handlers for "Operator answers status queries and relays
// gate decisions from a topic (Decide + Status)". Drives the REAL compiled
// operatorDecideStatus.js in-process (out/bridge/operatorDecideStatus.js)
// with fixture projections/gate views and fake answerGate/reply adapters -
// no live tmux/swarm, no real gate-answer write, matching the ticket's own
// testable-boundary constraint.
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { handleStatusQuery, handleApprovalDecision } = require(path.join(EXT_DIR, 'out', 'bridge', 'operatorDecideStatus'));

function fakeBacklog(tickets) {
  return {
    board: {
      active: tickets.filter((t) => t.status === 'active'),
      paused: tickets.filter((t) => t.status === 'paused'),
      doneByMilestone: {},
    },
  };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the Operator handles a topic message and replies into that same topic$/, () => {
    // Framing only - each scenario's own Given builds its own fixture.
  });

  // ── decide-status-01 ─────────────────────────────────────────────────
  registry.define(/^a status query arrives in a topic$/, (ctx) => {
    ctx.query = { kind: 'ticket', ticketId: 'BL-100' };
    ctx.projections = { backlog: fakeBacklog([{ id: 'BL-100', title: 'cost telemetry', status: 'active', swarm: 'primary' }]) };
  });

  registry.define(/^the Operator handles the query$/, (ctx) => {
    ctx.replies = [];
    ctx.answer = handleStatusQuery(ctx.query, ctx.projections, { reply: (text) => ctx.replies.push(text) });
  });

  registry.define(/^it replies into that topic with an answer read from the live projection$/, (ctx) => {
    if (ctx.replies.length !== 1) {
      throw new Error(`expected exactly one reply into the topic, got: ${JSON.stringify(ctx.replies)}`);
    }
    if (ctx.replies[0] !== ctx.answer) {
      throw new Error('expected the topic reply to carry the composed answer');
    }
  });

  // ── decide-status-02 ─────────────────────────────────────────────────
  registry.define(/^a status query about a ticket whose state is known in the projection$/, (ctx) => {
    ctx.query = { kind: 'ticket', ticketId: 'BL-100' };
    ctx.knownStatus = 'paused';
    ctx.projections = { backlog: fakeBacklog([{ id: 'BL-100', title: 'cost telemetry', status: ctx.knownStatus, swarm: 'primary' }]) };
  });

  registry.define(/^the reply states that ticket's actual projected state$/, (ctx) => {
    if (!ctx.replies[0].includes('BL-100') || !ctx.replies[0].includes(ctx.knownStatus)) {
      throw new Error(`expected the reply to state BL-100's actual "${ctx.knownStatus}" state, got: ${ctx.replies[0]}`);
    }
  });

  // ── decide-status-03/04/05 (shared Given/When) ───────────────────────
  registry.define(/^the human approves in a topic$/, (ctx) => {
    ctx.answerText = 'y';
  });

  registry.define(/^exactly one gate is pending$/, (ctx) => {
    ctx.pendingGates = [{ role: 'coder', gated: true, snippet: 'Proceed with the migration? (y/n)' }];
  });

  registry.define(/^no gate is pending$/, (ctx) => {
    ctx.pendingGates = [];
  });

  registry.define(/^several gates are pending$/, (ctx) => {
    ctx.pendingGates = [
      { role: 'coder', gated: true },
      { role: 'cleaner', gated: true },
    ];
  });

  registry.define(/^the Operator acts on the decision$/, (ctx) => {
    ctx.answerCalls = [];
    ctx.replies = [];
    ctx.gateDecision = handleApprovalDecision(ctx.pendingGates, ctx.answerText, {
      answerGate: (role, answer) => {
        ctx.answerCalls.push({ role, answer });
        return { success: true };
      },
      reply: (text) => ctx.replies.push(text),
    });
  });

  // ── decide-status-03 ─────────────────────────────────────────────────
  registry.define(/^it answers that pending gate through the gate-answer write path$/, (ctx) => {
    if (ctx.answerCalls.length !== 1 || ctx.answerCalls[0].role !== ctx.pendingGates[0].role) {
      throw new Error(`expected the pending gate to be answered through the write path, got: ${JSON.stringify(ctx.answerCalls)}`);
    }
  });

  registry.define(/^it confirms the outcome in the topic$/, (ctx) => {
    if (ctx.replies.length !== 1 || !ctx.replies[0].includes(ctx.pendingGates[0].role)) {
      throw new Error(`expected an in-topic confirmation naming the answered role, got: ${JSON.stringify(ctx.replies)}`);
    }
  });

  // ── decide-status-04/05 (shared Then) ────────────────────────────────
  registry.define(/^no gate answer is written$/, (ctx) => {
    if (ctx.answerCalls.length !== 0) {
      throw new Error(`expected no gate answer written, got: ${JSON.stringify(ctx.answerCalls)}`);
    }
  });

  // ── decide-status-04 ─────────────────────────────────────────────────
  registry.define(/^it replies that there is nothing to approve$/, (ctx) => {
    if (ctx.replies.length !== 1 || !/nothing to approve/i.test(ctx.replies[0])) {
      throw new Error(`expected a "nothing to approve" reply, got: ${JSON.stringify(ctx.replies)}`);
    }
  });

  // ── decide-status-05 ─────────────────────────────────────────────────
  registry.define(/^it asks in the topic which gate to answer$/, (ctx) => {
    if (ctx.replies.length !== 1 || !ctx.pendingGates.every((g) => ctx.replies[0].includes(g.role))) {
      throw new Error(`expected an in-topic reply naming every pending role, got: ${JSON.stringify(ctx.replies)}`);
    }
  });
}

module.exports = { registerSteps };
