const assert = require('node:assert/strict');
const {
  selectGateDecision,
  handleApprovalDecision,
  composeStatusAnswer,
  handleStatusQuery,
} = require('../out/bridge/operatorDecideStatus');

// BL-285: the Operator Decide+Status slice's pure decision/composition
// logic + adapter-injected orchestration, tested with fakes - no real
// tmux/pane, no real gate-answer write, no real reply outbox, matching the
// ticket's own "fake answerCapturedGate/sendAnswer + fake reply outbox"
// testable-boundary constraint.

function fakeApprovalDeps(overrides = {}) {
  const answerCalls = [];
  const replies = [];
  return {
    answerCalls,
    replies,
    deps: {
      answerGate: (role, answer) => {
        answerCalls.push({ role, answer });
        return overrides.answerResult ?? { success: true };
      },
      reply: (text) => replies.push(text),
    },
  };
}

// ── selectGateDecision (pure) ────────────────────────────────────────────

test('selectGateDecision answers the one pending gate when exactly one is pending', () => {
  const decision = selectGateDecision([{ role: 'coder', gated: true, snippet: 'Proceed? (y/n)' }]);
  assert.deepEqual(decision, { action: 'answer', role: 'coder' });
});

test('selectGateDecision reports nothing to approve when no gate is pending', () => {
  assert.deepEqual(selectGateDecision([]), { action: 'nothing' });
});

test('selectGateDecision asks which gate when more than one is pending', () => {
  const decision = selectGateDecision([
    { role: 'coder', gated: true },
    { role: 'cleaner', gated: true },
  ]);
  assert.deepEqual(decision, { action: 'ask-which', roles: ['coder', 'cleaner'] });
});

// ── handleApprovalDecision (adapter-injected) — decide-status-03/04/05 ────

// BL-285 decide-status-03
test('decide-status-03: exactly one pending gate answers that gate through the gate-answer write path and confirms in the topic', () => {
  const { deps, answerCalls, replies } = fakeApprovalDeps();
  const decision = handleApprovalDecision([{ role: 'coder', gated: true }], 'y', deps);
  assert.deepEqual(decision, { action: 'answer', role: 'coder' });
  assert.deepEqual(answerCalls, [{ role: 'coder', answer: 'y' }]);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /coder/);
});

// BL-285 decide-status-04
test('decide-status-04: no pending gate writes no gate answer and replies there is nothing to approve', () => {
  const { deps, answerCalls, replies } = fakeApprovalDeps();
  const decision = handleApprovalDecision([], 'y', deps);
  assert.deepEqual(decision, { action: 'nothing' });
  assert.deepEqual(answerCalls, []);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /nothing to approve/i);
});

// BL-285 decide-status-05
test('decide-status-05: several pending gates write no gate answer and ask in the topic which to answer', () => {
  const { deps, answerCalls, replies } = fakeApprovalDeps();
  const decision = handleApprovalDecision(
    [
      { role: 'coder', gated: true },
      { role: 'cleaner', gated: true },
    ],
    'y',
    deps
  );
  assert.deepEqual(decision, { action: 'ask-which', roles: ['coder', 'cleaner'] });
  assert.deepEqual(answerCalls, []);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /coder/);
  assert.match(replies[0], /cleaner/);
});

test('a failed gate-answer write still confirms honestly, never claiming success', () => {
  const { deps, replies } = fakeApprovalDeps({ answerResult: { success: false, reason: 'gone' } });
  handleApprovalDecision([{ role: 'coder', gated: true }], 'y', deps);
  assert.equal(replies.length, 1);
  assert.doesNotMatch(replies[0], /Answered/);
});

// ── composeStatusAnswer / handleStatusQuery (pure + adapter-injected) ────
// decide-status-01/02

function fakeBacklog(tickets) {
  return { board: { active: tickets.filter((t) => t.status === 'active'), paused: tickets.filter((t) => t.status === 'paused'), doneByMilestone: {} } };
}

// BL-285 decide-status-02
test('decide-status-02: a ticket query states that ticket\'s actual projected state', () => {
  const projections = { backlog: fakeBacklog([{ id: 'BL-100', title: 'cost telemetry', status: 'active', swarm: 'primary' }]) };
  const answer = composeStatusAnswer({ kind: 'ticket', ticketId: 'BL-100' }, projections);
  assert.match(answer, /BL-100/);
  assert.match(answer, /active/);
});

test('a ticket query about an unknown ticket never fabricates a state', () => {
  const projections = { backlog: fakeBacklog([{ id: 'BL-100', title: 'cost telemetry', status: 'active', swarm: 'primary' }]) };
  const answer = composeStatusAnswer({ kind: 'ticket', ticketId: 'BL-999' }, projections);
  assert.match(answer, /don't know|not.*projection/i);
  assert.doesNotMatch(answer, /active|paused|done/);
});

test('a ticket query finds a done ticket nested under doneByMilestone', () => {
  const projections = {
    backlog: { board: { active: [], paused: [], doneByMilestone: { M4: [{ id: 'BL-42', title: 'shipped thing', status: 'done', swarm: 'primary' }] } } },
  };
  const answer = composeStatusAnswer({ kind: 'ticket', ticketId: 'BL-42' }, projections);
  assert.match(answer, /BL-42/);
  assert.match(answer, /done/);
});

// BL-285 decide-status-01
test('decide-status-01: a swarm-liveness query is answered from the live operator status projection', () => {
  const projections = { operatorStatus: { state: 'dispatching', agents_running: 3, pending_events: 1 } };
  const answer = composeStatusAnswer({ kind: 'swarm-liveness' }, projections);
  assert.match(answer, /dispatching/);
  assert.match(answer, /3/);
});

test('a swarm-liveness query never fabricates when no operator status is available', () => {
  const answer = composeStatusAnswer({ kind: 'swarm-liveness' }, {});
  assert.match(answer, /don't know/i);
});

test('a pending-gates query is answered from the live gate view', () => {
  const answer = composeStatusAnswer({ kind: 'pending-gates' }, { pendingGates: [{ role: 'coder', gated: true }, { role: 'cleaner', gated: true }] });
  assert.match(answer, /coder/);
  assert.match(answer, /cleaner/);
});

test('a pending-gates query with none pending never fabricates a gate', () => {
  const answer = composeStatusAnswer({ kind: 'pending-gates' }, { pendingGates: [] });
  assert.match(answer, /no gates? pending/i);
});

test('handleStatusQuery replies into the topic with the composed answer', () => {
  const replies = [];
  const answer = handleStatusQuery({ kind: 'ticket', ticketId: 'BL-100' }, { backlog: fakeBacklog([{ id: 'BL-100', title: 't', status: 'paused', swarm: 'primary' }]) }, {
    reply: (text) => replies.push(text),
  });
  assert.deepEqual(replies, [answer]);
});
