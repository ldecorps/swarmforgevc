const assert = require('node:assert/strict');
const {
  reviseContractFromObjection,
  startNegotiation,
  objectToContract,
  approveContract,
  DEFAULT_MAX_NEGOTIATION_ROUNDS,
} = require('../out/onboarding/contractNegotiation');
const { parseNegotiationLog, renderNegotiationLogLine } = require('../out/onboarding/negotiationLog');

const BASE_CONTRACT = {
  scope: ['Deliver the seed vision: Ship the MVP.', 'Work within the existing TypeScript codebase.'],
  outOfScope: ['Rewriting the stack.'],
  boundaries: ['Every feature still passes its own approval gate.'],
  initialBacklogSummary: '5 tickets queued.',
  agreement: 'proposed',
};

// ── reviseContractFromObjection (onboarding-negotiation-01/02/03/07) ──────

test('BL-344 onboarding-negotiation-01: an objection in the operator\'s own words is accepted (never throws, never rejected)', () => {
  assert.doesNotThrow(() => reviseContractFromObjection(BASE_CONTRACT, 'please remove the TypeScript rewrite bit'));
});

test('BL-344 onboarding-negotiation-02: a removal objection actually removes the matching scope entry', () => {
  const { contract, changedFields } = reviseContractFromObjection(BASE_CONTRACT, 'remove the TypeScript codebase work');
  assert.equal(contract.scope.length, BASE_CONTRACT.scope.length - 1);
  assert.ok(!contract.scope.some((s) => s.includes('TypeScript codebase')));
  assert.ok(contract.outOfScope.some((s) => s.includes('TypeScript codebase')));
  assert.deepEqual(changedFields, ['scope', 'outOfScope']);
});

test('onboarding-negotiation-02: an addition objection adds a new scope entry carrying the operator\'s own words', () => {
  const { contract, changedFields } = reviseContractFromObjection(BASE_CONTRACT, 'also add support for the CLI tool');
  assert.equal(contract.scope.length, BASE_CONTRACT.scope.length + 1);
  assert.ok(contract.scope[contract.scope.length - 1].includes('add support for the CLI tool'));
  assert.deepEqual(changedFields, ['scope']);
});

test('onboarding-negotiation-02/07: an objection matching neither pattern is still reflected, as a new boundary', () => {
  const { contract, changedFields } = reviseContractFromObjection(BASE_CONTRACT, 'I am not sure this is the right approach');
  assert.ok(contract.boundaries.some((b) => b.includes('I am not sure this is the right approach')));
  assert.deepEqual(changedFields, ['boundaries']);
});

test('BL-344 onboarding-negotiation-03: the revised contract is never identical to the previous one for a real objection', () => {
  const { contract } = reviseContractFromObjection(BASE_CONTRACT, 'also include documentation generation');
  assert.notDeepEqual(contract, BASE_CONTRACT);
});

test('a blank objection changes nothing (never fabricates a change from silence)', () => {
  const { contract, changedFields } = reviseContractFromObjection(BASE_CONTRACT, '   ');
  assert.deepEqual(contract, BASE_CONTRACT);
  assert.deepEqual(changedFields, []);
});

test('a removal objection naming something NOT in scope falls back to a boundary note, never silently drops nothing', () => {
  const { contract, changedFields } = reviseContractFromObjection(BASE_CONTRACT, 'remove the unrelated payments integration');
  assert.equal(contract.scope.length, BASE_CONTRACT.scope.length);
  assert.ok(contract.boundaries.some((b) => b.includes('payments integration')));
  assert.deepEqual(changedFields, ['boundaries']);
});

test('every revision path marks the contract "proposed" again (a revision is never silently pre-agreed)', () => {
  assert.equal(reviseContractFromObjection(BASE_CONTRACT, 'remove the TypeScript codebase work').contract.agreement, 'proposed');
  assert.equal(reviseContractFromObjection(BASE_CONTRACT, 'also add logging').contract.agreement, 'proposed');
  assert.equal(reviseContractFromObjection(BASE_CONTRACT, 'not sure about this').contract.agreement, 'proposed');
});

test('a 4-letter word is significant enough to drive the phrase-overlap match (word.length >= 4, not > 4)', () => {
  // "ship" is exactly 4 characters and appears in BASE_CONTRACT.scope[0]
  // ("...Ship the MVP.") - a >4 threshold would exclude it and this
  // removal would wrongly fall back to a boundary note instead.
  const { contract, changedFields } = reviseContractFromObjection(BASE_CONTRACT, 'remove the ship deliverable');
  assert.equal(contract.scope.length, BASE_CONTRACT.scope.length - 1);
  assert.ok(!contract.scope.some((s) => s.toLowerCase().includes('ship')));
  assert.deepEqual(changedFields, ['scope', 'outOfScope']);
});

test('"dont include" (no apostrophe) is still recognized as removal intent, not addition', () => {
  // don'?t include - the apostrophe is optional in the pattern.
  const { contract, changedFields } = reviseContractFromObjection(BASE_CONTRACT, "dont include the TypeScript codebase");
  assert.equal(contract.scope.length, BASE_CONTRACT.scope.length - 1);
  assert.deepEqual(changedFields, ['scope', 'outOfScope']);
});

test('an addition objection whose words happen to overlap an EXISTING scope entry still adds, never removes', () => {
  // "typescript" overlaps BASE_CONTRACT.scope[1], but "include" alone
  // (no remove/exclude/drop/don't-include/never) is addition intent, not
  // removal - a removal-branch-first bug would delete scope[1] instead.
  const { contract, changedFields } = reviseContractFromObjection(BASE_CONTRACT, 'also include typescript improvements');
  assert.equal(contract.scope.length, BASE_CONTRACT.scope.length + 1);
  assert.ok(contract.scope.some((s) => s.includes('TypeScript codebase')), 'the existing TypeScript scope entry must survive');
  assert.deepEqual(changedFields, ['scope']);
});

// ── objectToContract / round tracking (onboarding-negotiation-05/07) ─────

test('objectToContract records a new round with the objection and what changed', () => {
  const state = startNegotiation(BASE_CONTRACT);
  const next = objectToContract(state, 'also add logging support');
  assert.equal(next.rounds.length, 1);
  assert.equal(next.rounds[0].round, 1);
  assert.equal(next.rounds[0].objection, 'also add logging support');
  assert.deepEqual(next.rounds[0].changedFields, ['scope']);
  assert.equal(next.ended, false);
});

test('BL-344 onboarding-negotiation-05: the negotiation ends after the bounded round cap, without approving anything', () => {
  let state = startNegotiation(BASE_CONTRACT);
  for (let i = 0; i < DEFAULT_MAX_NEGOTIATION_ROUNDS; i++) {
    state = objectToContract(state, `objection number ${i}`);
    assert.equal(state.ended, false, `round ${i + 1} should not end the negotiation yet`);
  }
  // One more objection past the cap ends it, without approving.
  state = objectToContract(state, 'one objection too many');
  assert.equal(state.ended, true);
  assert.equal(state.endedReason, 'round-limit');
  assert.notEqual(state.contract.agreement, 'agreed');
  assert.equal(state.rounds.length, DEFAULT_MAX_NEGOTIATION_ROUNDS);
});

test('a custom round cap is honored', () => {
  let state = startNegotiation(BASE_CONTRACT);
  state = objectToContract(state, 'first', 1);
  assert.equal(state.ended, false);
  state = objectToContract(state, 'second', 1);
  assert.equal(state.ended, true);
  assert.equal(state.endedReason, 'round-limit');
  assert.equal(state.rounds.length, 1);
});

test('once ended, further objections are refused (state is simply returned unchanged)', () => {
  let state = startNegotiation(BASE_CONTRACT);
  state = objectToContract(state, 'first', 1);
  state = objectToContract(state, 'second', 1); // ends here (round-limit)
  const roundsBefore = state.rounds.length;
  const again = objectToContract(state, 'third', 1);
  assert.equal(again.rounds.length, roundsBefore);
  assert.equal(again.ended, true);
});

test('an APPROVED negotiation refuses a further objection outright (no phantom round appended)', () => {
  let state = startNegotiation(BASE_CONTRACT);
  state = approveContract(state);
  const again = objectToContract(state, 'too late now');
  assert.deepEqual(again, state);
});

// ── approveContract (onboarding-negotiation-04/06) ────────────────────────

test('BL-344 onboarding-negotiation-04: approval ends the negotiation and the approved contract is the one that stands', () => {
  let state = startNegotiation(BASE_CONTRACT);
  state = objectToContract(state, 'also add feature X');
  const revisedContract = state.contract;
  state = approveContract(state);
  assert.equal(state.ended, true);
  assert.equal(state.endedReason, 'approved');
  assert.equal(state.contract.agreement, 'agreed');
  // the approved contract carries the REVISION, not the original proposal.
  assert.deepEqual({ ...state.contract, agreement: 'proposed' }, revisedContract);
});

test('onboarding-negotiation-06: a never-approved negotiation state carries agreement other than "agreed"', () => {
  const state = startNegotiation(BASE_CONTRACT);
  assert.notEqual(state.contract.agreement, 'agreed');
});

test('approving an already-ended negotiation is a no-op (never re-approves or errors on double-approve)', () => {
  let state = startNegotiation(BASE_CONTRACT);
  state = approveContract(state);
  const again = approveContract(state);
  assert.deepEqual(again, state);
});

test('approving a negotiation already ended by round-limit is refused, never retroactively agrees it', () => {
  let state = startNegotiation(BASE_CONTRACT);
  state = objectToContract(state, 'first', 1);
  state = objectToContract(state, 'second', 1); // ends here (round-limit)
  const again = approveContract(state);
  assert.deepEqual(again, state);
  assert.notEqual(again.contract.agreement, 'agreed');
  assert.equal(again.endedReason, 'round-limit');
});

// ── negotiationLog (onboarding-negotiation-07) ────────────────────────────

test('renderNegotiationLogLine + parseNegotiationLog round-trip a round exactly', () => {
  const round = { round: 1, objection: 'remove the payments work', changedFields: ['scope', 'outOfScope'] };
  const line = renderNegotiationLogLine(round);
  const parsed = parseNegotiationLog(line);
  assert.deepEqual(parsed, [round]);
});

test('parseNegotiationLog accumulates every round across multiple lines, in order', () => {
  const lines =
    renderNegotiationLogLine({ round: 1, objection: 'a', changedFields: ['scope'] }) +
    renderNegotiationLogLine({ round: 2, objection: 'b', changedFields: ['boundaries'] });
  const parsed = parseNegotiationLog(lines);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].objection, 'a');
  assert.equal(parsed[1].objection, 'b');
});

test('parseNegotiationLog skips a malformed/truncated line rather than losing the rest of the log', () => {
  const lines = renderNegotiationLogLine({ round: 1, objection: 'a', changedFields: [] }) + 'not json\n' + '{"incomplete":\n';
  const parsed = parseNegotiationLog(lines);
  assert.equal(parsed.length, 1);
});

test('parseNegotiationLog on empty content is an empty round list, not an error', () => {
  assert.deepEqual(parseNegotiationLog(''), []);
});

test('parseNegotiationLog rejects a syntactically-valid JSON line whose fields have the wrong types', () => {
  const lines =
    renderNegotiationLogLine({ round: 1, objection: 'a', changedFields: ['scope'] }) +
    '{"round":"one","objection":5,"changedFields":"not-an-array"}\n';
  const parsed = parseNegotiationLog(lines);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].objection, 'a');
});

test('parseNegotiationLog tolerates a CRLF-terminated line (trims the trailing \\r before parsing)', () => {
  const round = { round: 1, objection: 'remove the payments work', changedFields: ['scope'] };
  const crlfContent = `${JSON.stringify(round)}\r\n`;
  const parsed = parseNegotiationLog(crlfContent);
  assert.deepEqual(parsed, [round]);
});
