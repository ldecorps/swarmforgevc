const assert = require('node:assert/strict');
const {
  emptyRecertStore,
  recertifiableScenariosFrom,
  selectForRecertification,
  confirmScenario,
  buildRecertEmailSubject,
  buildRecertEmailBody,
  parseRecertEmail,
  handleInboundRecertEmail,
  applyAcceptedProposal,
  requestDelete,
  confirmDelete,
  canSendDeleteEmail,
} = require('../out/docs/recertification');

// BL-150: pure recertification logic, tested independent of any live
// filesystem/webhook/tmux transport (recertificationStore.test.js covers
// the impure read/write layer).

test('recert-01: recertifiableScenariosFrom keeps only tagged (stable-id) scenarios, pairing each with its ticket id', () => {
  const tickets = [
    { id: 'BL-096', title: 'Metrics dashboard', scenarios: [{ id: 'BL-096/metrics-01', name: 'a', text: 'a-text' }, { name: 'untagged', text: 'x' }] },
    { id: 'BL-097', title: 'Board', scenarios: [{ id: 'BL-097/dashboard-01', name: 'b', text: 'b-text' }] },
  ];
  const result = recertifiableScenariosFrom(tickets);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { id: 'BL-096/metrics-01', ticketId: 'BL-096', ticketTitle: 'Metrics dashboard', name: 'a', text: 'a-text' });
  assert.deepEqual(result[1], { id: 'BL-097/dashboard-01', ticketId: 'BL-097', ticketTitle: 'Board', name: 'b', text: 'b-text' });
});

// BL-280: the ONE projection add - a ticket's French title rides through
// as ticketTitleFr (optional, absent when the ticket has none), mirroring
// docsTree's own TicketNode.titleFr? convention.
test('BL-280 recert-context-01: recertifiableScenariosFrom also carries the ticket title (+ French title) for each scenario', () => {
  const tickets = [
    { id: 'BL-096', title: 'Metrics dashboard', titleFr: 'Tableau de bord', scenarios: [{ id: 'BL-096/metrics-01', name: 'a', text: 'a-text' }] },
  ];
  const [result] = recertifiableScenariosFrom(tickets);
  assert.equal(result.ticketTitle, 'Metrics dashboard');
  assert.equal(result.ticketTitleFr, 'Tableau de bord');
});

test('BL-280: a ticket with no French title omits ticketTitleFr rather than a blank/undefined value', () => {
  const tickets = [{ id: 'BL-096', title: 'Metrics dashboard', scenarios: [{ id: 'BL-096/metrics-01', name: 'a', text: 'a-text' }] }];
  const [result] = recertifiableScenariosFrom(tickets);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'ticketTitleFr'), false);
});

test('recert-01: the human is shown the least-recently-reviewed scenario first', () => {
  const scenarios = [
    { id: 'a', ticketId: 'T', name: 'A', text: '' },
    { id: 'b', ticketId: 'T', name: 'B', text: '' },
    { id: 'c', ticketId: 'T', name: 'C', text: '' },
  ];
  const state = {
    schemaVersion: 1,
    scenarios: {
      a: { lastReviewedIso: '2026-07-05T00:00:00Z' },
      b: { lastReviewedIso: '2026-07-01T00:00:00Z' }, // oldest
      c: { lastReviewedIso: '2026-07-08T00:00:00Z' },
    },
  };
  const [first] = selectForRecertification(scenarios, state, 1);
  assert.equal(first.id, 'b');
});

test('recert-01: a never-reviewed scenario (no state entry) is treated as infinitely old and surfaces first', () => {
  const scenarios = [
    { id: 'reviewed', ticketId: 'T', name: 'A', text: '' },
    { id: 'never', ticketId: 'T', name: 'B', text: '' },
  ];
  const state = { schemaVersion: 1, scenarios: { reviewed: { lastReviewedIso: '2020-01-01T00:00:00Z' } } };
  const [first] = selectForRecertification(scenarios, state, 1);
  assert.equal(first.id, 'never');
});

test('recert-01: batchSize drip-feeds a small batch, not a wall of scenarios', () => {
  const scenarios = ['a', 'b', 'c', 'd'].map((id) => ({ id, ticketId: 'T', name: id, text: '' }));
  const batch = selectForRecertification(scenarios, emptyRecertStore(), 2);
  assert.equal(batch.length, 2);
});

test('recert-02: confirming a scenario updates its timestamp and requeues it at the back', () => {
  const scenarios = [
    { id: 'a', ticketId: 'T', name: 'A', text: '' },
    { id: 'b', ticketId: 'T', name: 'B', text: '' },
  ];
  const state = {
    schemaVersion: 1,
    scenarios: { a: { lastReviewedIso: '2020-01-01T00:00:00Z' }, b: { lastReviewedIso: '2021-01-01T00:00:00Z' } },
  };
  const confirmed = confirmScenario(state, 'a', '2026-07-09T00:00:00Z');
  assert.equal(confirmed.scenarios.a.lastReviewedIso, '2026-07-09T00:00:00Z');
  // b is now the oldest-reviewed, so it surfaces first
  const [first] = selectForRecertification(scenarios, confirmed, 1);
  assert.equal(first.id, 'b');
});

test('confirmScenario does not mutate the input state (pure)', () => {
  const state = emptyRecertStore();
  const updated = confirmScenario(state, 'x', '2026-07-09T00:00:00Z');
  assert.deepEqual(state.scenarios, {});
  assert.ok(updated.scenarios.x);
});

test('recert-03: buildRecertEmailSubject/Body encode scenario id, outcome "update", and the new text', () => {
  const params = { scenarioId: 'BL-096/metrics-01', outcome: 'update', newText: 'Given a new precondition\nThen a new outcome' };
  const subject = buildRecertEmailSubject(params);
  const body = buildRecertEmailBody(params);
  assert.match(subject, /update/);
  assert.match(subject, /BL-096\/metrics-01/);
  assert.match(body, /Given a new precondition/);
});

test('recert-04: buildRecertEmailSubject/Body for a delete carries outcome "delete" and no text section', () => {
  const params = { scenarioId: 'BL-096/metrics-01', outcome: 'delete' };
  const subject = buildRecertEmailSubject(params);
  const body = buildRecertEmailBody(params);
  assert.match(subject, /delete/);
  assert.doesNotMatch(body, /---/);
});

test('parseRecertEmail is the exact inverse of buildRecertEmailSubject/Body for an update', () => {
  const params = { scenarioId: 'BL-150/recert-01', outcome: 'update', newText: 'edited scenario text\nsecond line' };
  const parsed = parseRecertEmail(buildRecertEmailSubject(params), buildRecertEmailBody(params));
  assert.deepEqual(parsed, params);
});

test('parseRecertEmail is the exact inverse of buildRecertEmailSubject/Body for a delete', () => {
  const params = { scenarioId: 'BL-150/recert-04', outcome: 'delete' };
  const parsed = parseRecertEmail(buildRecertEmailSubject(params), buildRecertEmailBody(params));
  assert.equal(parsed.scenarioId, 'BL-150/recert-04');
  assert.equal(parsed.outcome, 'delete');
});

test('parseRecertEmail is the exact inverse of buildRecertEmailSubject/Body for a confirm', () => {
  const params = { scenarioId: 'BL-096/metrics-01', outcome: 'confirm' };
  const parsed = parseRecertEmail(buildRecertEmailSubject(params), buildRecertEmailBody(params));
  assert.deepEqual(parsed, params);
});

test('parseRecertEmail treats a malformed update (subject says update, body has no "---" marker) as an empty newText rather than throwing or slicing the wrong text', () => {
  const parsed = parseRecertEmail('SwarmForge recert: update BL-1/x', 'scenario: BL-1/x\noutcome: update');
  assert.deepEqual(parsed, { scenarioId: 'BL-1/x', outcome: 'update', newText: '' });
});

test('parseRecertEmail returns null for mail that is not a recognized recert email (a real inbox sees other mail too)', () => {
  assert.equal(parseRecertEmail('Re: your invoice', 'unrelated body'), null);
  assert.equal(parseRecertEmail('SwarmForge recert: bogus-outcome BL-1/x', 'body'), null);
});

test('recert-02: handleInboundRecertEmail applies a confirm directly to the store - no content change, no review needed', () => {
  const state = { schemaVersion: 1, scenarios: { 'a': { lastReviewedIso: '2020-01-01T00:00:00Z' } } };
  const parsed = { scenarioId: 'a', outcome: 'confirm' };
  const result = handleInboundRecertEmail(state, parsed, '2026-07-09T12:00:00Z');
  assert.equal(result.kind, 'applied');
  assert.equal(result.state.scenarios.a.lastReviewedIso, '2026-07-09T12:00:00Z');
});

test('recert-03: handleInboundRecertEmail queues an update as a proposal rather than applying it directly', () => {
  const state = { schemaVersion: 1, scenarios: { 'a': { lastReviewedIso: '2020-01-01T00:00:00Z' } } };
  const parsed = { scenarioId: 'a', outcome: 'update', newText: 'new text' };
  const result = handleInboundRecertEmail(state, parsed, '2026-07-09T12:00:00Z');
  assert.equal(result.kind, 'proposed');
  assert.deepEqual(result.proposal, { scenarioId: 'a', outcome: 'update', newText: 'new text', receivedAtIso: '2026-07-09T12:00:00Z' });
  // the store itself is untouched until the specifier accepts
  assert.equal(state.scenarios.a.lastReviewedIso, '2020-01-01T00:00:00Z');
});

test('recert-05: handleInboundRecertEmail queues a delete as a proposal, with no newText field', () => {
  const state = emptyRecertStore();
  const parsed = { scenarioId: 'a', outcome: 'delete' };
  const result = handleInboundRecertEmail(state, parsed, '2026-07-09T12:00:00Z');
  assert.equal(result.kind, 'proposed');
  assert.equal('newText' in result.proposal, false);
});

// recert-04: delete requires an explicit in-app confirmation step before
// the delete email is even sent - a deliberate double-gate on top of the
// specifier's own proposal review.

test('canSendDeleteEmail is false in the idle state - choosing delete alone never sends anything', () => {
  assert.equal(canSendDeleteEmail('idle'), false);
});

test('requestDelete moves to pendingConfirm, which still cannot send', () => {
  const gate = requestDelete();
  assert.equal(gate, 'pendingConfirm');
  assert.equal(canSendDeleteEmail(gate), false);
});

test('confirmDelete only unlocks sending after requestDelete - confirming from idle is a no-op', () => {
  assert.equal(canSendDeleteEmail(confirmDelete('idle')), false);
});

test('requestDelete then confirmDelete reaches confirmed, which can send', () => {
  const gate = confirmDelete(requestDelete());
  assert.equal(gate, 'confirmed');
  assert.equal(canSendDeleteEmail(gate), true);
});

test('recert-05: applyAcceptedProposal for an accepted delete removes the scenario from the recertification queue entirely', () => {
  const state = {
    schemaVersion: 1,
    scenarios: { 'a': { lastReviewedIso: '2020-01-01T00:00:00Z' }, 'b': { lastReviewedIso: '2020-01-01T00:00:00Z' } },
  };
  const proposal = { scenarioId: 'a', outcome: 'delete', receivedAtIso: '2026-07-09T00:00:00Z' };
  const updated = applyAcceptedProposal(state, proposal, '2026-07-09T12:00:00Z');
  assert.equal('a' in updated.scenarios, false);
  assert.ok('b' in updated.scenarios);
});

test('recert-03 tail: applyAcceptedProposal for an accepted update advances the timestamp like a confirm', () => {
  const state = { schemaVersion: 1, scenarios: { a: { lastReviewedIso: '2020-01-01T00:00:00Z' } } };
  const proposal = { scenarioId: 'a', outcome: 'update', newText: 'x', receivedAtIso: '2026-07-09T00:00:00Z' };
  const updated = applyAcceptedProposal(state, proposal, '2026-07-09T12:00:00Z');
  assert.equal(updated.scenarios.a.lastReviewedIso, '2026-07-09T12:00:00Z');
});
