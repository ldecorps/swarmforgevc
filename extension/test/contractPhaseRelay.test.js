const assert = require('node:assert/strict');
const {
  decideContractPhaseAction,
  runContractPhaseAction,
} = require('../out/onboarding/contractPhaseRelay');
const {
  CONTRACT_AGREED_MESSAGE,
  ROUND_LIMIT_MESSAGE,
  COULD_NOT_DERIVE_CHANGE_MESSAGE,
} = require('../out/onboarding/negotiationTelegramRelay');

const TARGET_URL = 'https://github.com/acme/widget';
const NOW_MS = 1_700_000_000_000;

function baseState(phase) {
  return {
    targetRepoUrl: TARGET_URL,
    phase,
    stepIndex: 5,
    verifiedSteps: ['toolchain', 'github-access', 'fork-clone', 'target-repo', 'bot-token'],
    paused: false,
    updatedAtMs: NOW_MS - 1000,
  };
}

const FIXTURE_CONTRACT = {
  scope: ['Deliver the seed vision: Ship the MVP.'],
  outOfScope: ['Rewriting the stack.'],
  boundaries: ['Every feature still passes its own approval gate.'],
  initialBacklogSummary: '3 tickets queued.',
  agreement: 'proposed',
};

const FIXTURE_FACTS = {
  languages: ['TypeScript'],
  layoutSummary: 'src/, test/',
  readmeSummary: 'A widget.',
  seedVision: 'Ship the MVP.',
  initialBacklogSummary: '3 tickets queued.',
  useCaseObservations: [],
};

// A spying, fully-scriptable fake ContractPhaseAdapters - every method
// records its calls (so a test can assert push was never reached) and
// returns whatever the test configured, never touching git/claude/fs.
function fakeAdapters(overrides = {}) {
  const calls = { clone: [], survey: [], propose: [], readCurrent: [], object: [], approve: [], gate: [], push: [] };
  const adapters = {
    async cloneTarget(url) {
      calls.clone.push(url);
      return overrides.cloneTarget ? overrides.cloneTarget(url) : { ok: true };
    },
    async surveyRepo(url) {
      calls.survey.push(url);
      if (overrides.surveyRepo) return overrides.surveyRepo(url);
      return FIXTURE_FACTS;
    },
    async proposeContract(url, facts) {
      calls.propose.push({ url, facts });
      if (overrides.proposeContract) return overrides.proposeContract(url, facts);
      return FIXTURE_CONTRACT;
    },
    async readCurrentContract(url) {
      calls.readCurrent.push(url);
      if (overrides.readCurrentContract) return overrides.readCurrentContract(url);
      return FIXTURE_CONTRACT;
    },
    async negotiateObject(url, objection) {
      calls.object.push({ url, objection });
      if (overrides.negotiateObject) return overrides.negotiateObject(url, objection);
      return { outcome: 'revised', contract: { ...FIXTURE_CONTRACT, scope: [...FIXTURE_CONTRACT.scope, `Per operator request: ${objection}`] } };
    },
    async negotiateApprove(url) {
      calls.approve.push(url);
      if (overrides.negotiateApprove) return overrides.negotiateApprove(url);
      return { outcome: 'agreed', contract: { ...FIXTURE_CONTRACT, agreement: 'agreed' } };
    },
    async checkGate(url) {
      calls.gate.push(url);
      if (overrides.checkGate) return overrides.checkGate(url);
      return { decision: 'allow' };
    },
    async commitAndPush(url) {
      calls.push.push(url);
      if (overrides.commitAndPush) return overrides.commitAndPush(url);
      return { ok: true, commitSha: 'abc1234def' };
    },
  };
  return { adapters, calls };
}

const now = () => NOW_MS;

// ── decideContractPhaseAction ───────────────────────────────────────────

test('BL-624: "proceed" at prerequisites-ready decides start-survey', () => {
  assert.deepEqual(decideContractPhaseAction(baseState('prerequisites-ready'), 'proceed'), { kind: 'start-survey' });
});

test('BL-624: unrecognized text at prerequisites-ready decides unrecognized', () => {
  assert.deepEqual(decideContractPhaseAction(baseState('prerequisites-ready'), 'blah'), { kind: 'unrecognized' });
});

test('BL-624: "show-me" at contract-proposed decides show-current-contract', () => {
  assert.deepEqual(decideContractPhaseAction(baseState('contract-proposed'), 'show-me'), { kind: 'show-current-contract' });
});

test('BL-624: "change-this <objection>" at contract-proposed decides negotiate-object with the trimmed objection', () => {
  assert.deepEqual(decideContractPhaseAction(baseState('contract-proposed'), 'change-this   drop the PWA work  '), {
    kind: 'negotiate-object',
    objection: 'drop the PWA work',
  });
});

test('BL-624: bare "change-this" with no objection text decides unrecognized (nothing to derive)', () => {
  assert.deepEqual(decideContractPhaseAction(baseState('contract-proposed'), 'change-this'), { kind: 'unrecognized' });
});

test('BL-624: "proceed" at negotiating decides negotiate-approve', () => {
  assert.deepEqual(decideContractPhaseAction(baseState('negotiating'), 'proceed'), { kind: 'negotiate-approve' });
});

test('BL-624: show-me/change-this/proceed all decide unrecognized once contract-agreed (terminal for this slice)', () => {
  assert.deepEqual(decideContractPhaseAction(baseState('contract-agreed'), 'show-me'), { kind: 'unrecognized' });
  assert.deepEqual(decideContractPhaseAction(baseState('contract-agreed'), 'proceed'), { kind: 'unrecognized' });
});

// ── BL-624 survey-runs-on-own-clone-01 ──────────────────────────────────

test('BL-624 scenario 01: start-survey clones, surveys, proposes and advances to contract-proposed', async () => {
  const { adapters, calls } = fakeAdapters();
  const state = baseState('prerequisites-ready');
  const turn = await runContractPhaseAction(state, { kind: 'start-survey' }, adapters, now);
  assert.equal(turn.state.phase, 'contract-proposed');
  assert.equal(turn.state.updatedAtMs, NOW_MS);
  assert.deepEqual(calls.clone, [TARGET_URL]);
  assert.deepEqual(calls.survey, [TARGET_URL]);
  assert.equal(calls.propose.length, 1);
  assert.ok(turn.message.includes(FIXTURE_CONTRACT.boundaries[0]), 'expected the proposed contract to be posted');
});

// ── BL-624 clone-failure-is-a-visible-hold-07 ───────────────────────────

test('BL-624 scenario 07: a clone failure leaves the state exactly as it was, with a visible reason and retry instruction', async () => {
  const { adapters, calls } = fakeAdapters({ cloneTarget: async () => ({ ok: false, error: 'repository not found' }) });
  const state = baseState('prerequisites-ready');
  const turn = await runContractPhaseAction(state, { kind: 'start-survey' }, adapters, now);
  assert.deepEqual(turn.state, state, 'expected the state to stay exactly as it was on a clone failure');
  assert.ok(turn.message.includes('repository not found'));
  assert.match(turn.message, /proceed.*to retry/i);
  assert.equal(calls.survey.length, 0, 'expected survey never to run after a clone failure');
});

test('BL-624: a survey failure also leaves the state untouched with a visible reason', async () => {
  const { adapters, calls } = fakeAdapters({
    surveyRepo: async () => {
      throw new Error('claude survey timed out');
    },
  });
  const state = baseState('prerequisites-ready');
  const turn = await runContractPhaseAction(state, { kind: 'start-survey' }, adapters, now);
  assert.deepEqual(turn.state, state);
  assert.ok(turn.message.includes('claude survey timed out'));
  assert.equal(calls.propose.length, 0, 'expected propose never to run after a survey failure');
});

test('BL-624: a propose failure also leaves the state untouched with a visible reason', async () => {
  const { adapters } = fakeAdapters({
    proposeContract: async () => {
      throw new Error('failed to write contract.yaml');
    },
  });
  const state = baseState('prerequisites-ready');
  const turn = await runContractPhaseAction(state, { kind: 'start-survey' }, adapters, now);
  assert.deepEqual(turn.state, state);
  assert.ok(turn.message.includes('failed to write contract.yaml'));
});

// ── BL-624 show-me-inspection-02 ────────────────────────────────────────

test('BL-624 scenario 02: show-current-contract never changes state and posts the current contract', async () => {
  const { adapters } = fakeAdapters();
  const state = baseState('contract-proposed');
  const turn = await runContractPhaseAction(state, { kind: 'show-current-contract' }, adapters, now);
  assert.deepEqual(turn.state, state);
  assert.ok(turn.message.includes(FIXTURE_CONTRACT.boundaries[0]));
});

test('BL-624: show-current-contract reports plainly when no contract is found', async () => {
  const { adapters } = fakeAdapters({ readCurrentContract: async () => undefined });
  const state = baseState('contract-proposed');
  const turn = await runContractPhaseAction(state, { kind: 'show-current-contract' }, adapters, now);
  assert.deepEqual(turn.state, state);
  assert.match(turn.message, /no proposed contract/i);
});

// ── BL-624 change-this-runs-a-real-object-round-03 ──────────────────────

test('BL-624 scenario 03: negotiate-object with a derived change advances to negotiating and posts the revision', async () => {
  const { adapters, calls } = fakeAdapters();
  const state = baseState('contract-proposed');
  const turn = await runContractPhaseAction(state, { kind: 'negotiate-object', objection: 'drop the PWA work' }, adapters, now);
  assert.equal(turn.state.phase, 'negotiating');
  assert.equal(turn.state.updatedAtMs, NOW_MS);
  assert.deepEqual(calls.object, [{ url: TARGET_URL, objection: 'drop the PWA work' }]);
  assert.ok(turn.message.includes('drop the PWA work'));
});

test('BL-624 BL-442: an objection from which nothing could be derived never advances the phase', async () => {
  const { adapters } = fakeAdapters({ negotiateObject: async () => ({ outcome: 'not-derived' }) });
  const state = baseState('contract-proposed');
  const turn = await runContractPhaseAction(state, { kind: 'negotiate-object', objection: 'all agreed' }, adapters, now);
  assert.deepEqual(turn.state, state);
  assert.equal(turn.message, COULD_NOT_DERIVE_CHANGE_MESSAGE);
});

test('BL-624 onboarding-negotiation-05: a round-limited objection never advances the phase and reports the limit', async () => {
  const { adapters } = fakeAdapters({ negotiateObject: async () => ({ outcome: 'round-limit' }) });
  const state = baseState('negotiating');
  const turn = await runContractPhaseAction(state, { kind: 'negotiate-object', objection: 'one more thing' }, adapters, now);
  assert.deepEqual(turn.state, state);
  assert.equal(turn.message, ROUND_LIMIT_MESSAGE);
});

test('BL-624: an objection against an already-ended negotiation never advances the phase', async () => {
  const { adapters } = fakeAdapters({ negotiateObject: async () => ({ outcome: 'already-ended' }) });
  const state = baseState('negotiating');
  const turn = await runContractPhaseAction(state, { kind: 'negotiate-object', objection: 'too late' }, adapters, now);
  assert.deepEqual(turn.state, state);
  assert.equal(turn.message, CONTRACT_AGREED_MESSAGE);
});

// ── BL-624 proceed-agrees-via-existing-approve-04 / gate-is-the-existing-gate-05 / agreed-contract-committed-back-06 ──

test('BL-624 scenarios 04+05+06: proceed while negotiating agrees, proves the gate, and commits+pushes the agreed contract', async () => {
  const { adapters, calls } = fakeAdapters();
  const state = baseState('negotiating');
  const turn = await runContractPhaseAction(state, { kind: 'negotiate-approve' }, adapters, now);
  assert.equal(turn.state.phase, 'contract-agreed');
  assert.equal(turn.state.updatedAtMs, NOW_MS);
  assert.deepEqual(calls.approve, [TARGET_URL]);
  assert.deepEqual(calls.gate, [TARGET_URL]);
  assert.deepEqual(calls.push, [TARGET_URL]);
  assert.match(turn.message, /agreed/i);
  assert.match(turn.message, /gate is open/i);
  assert.match(turn.message, /abc1234def/);
});

test('BL-624 scenario 05: a holding gate keeps the onboarding blocked with the gate\'s own reason, and never pushes', async () => {
  const { adapters, calls } = fakeAdapters({ checkGate: async () => ({ decision: 'hold', reason: 'proposed: the onboarding contract is not yet agreed' }) });
  const state = baseState('negotiating');
  const turn = await runContractPhaseAction(state, { kind: 'negotiate-approve' }, adapters, now);
  assert.equal(turn.state.phase, 'contract-agreed', 'agreement itself was still recorded');
  assert.ok(turn.message.includes('proposed: the onboarding contract is not yet agreed'));
  assert.equal(calls.push.length, 0, 'BL-624 invariant 2: nothing is pushed while the gate holds');
});

test('BL-624: a push failure after an open gate is reported and never silently dropped', async () => {
  const { adapters } = fakeAdapters({ commitAndPush: async () => ({ ok: false, error: 'permission denied (publickey)' }) });
  const state = baseState('negotiating');
  const turn = await runContractPhaseAction(state, { kind: 'negotiate-approve' }, adapters, now);
  assert.equal(turn.state.phase, 'contract-agreed');
  assert.ok(turn.message.includes('permission denied (publickey)'));
});

test('BL-624: approving an already-ended negotiation never re-advances the phase', async () => {
  const { adapters, calls } = fakeAdapters({ negotiateApprove: async () => ({ outcome: 'already-ended' }) });
  const state = baseState('negotiating');
  const turn = await runContractPhaseAction(state, { kind: 'negotiate-approve' }, adapters, now);
  assert.deepEqual(turn.state, state);
  assert.equal(turn.message, CONTRACT_AGREED_MESSAGE);
  assert.equal(calls.gate.length, 0);
  assert.equal(calls.push.length, 0);
});

// ── unrecognized ─────────────────────────────────────────────────────────

test('BL-624: an unrecognized action never touches any adapter and never changes state', async () => {
  const { adapters, calls } = fakeAdapters();
  const state = baseState('contract-proposed');
  const turn = await runContractPhaseAction(state, { kind: 'unrecognized' }, adapters, now);
  assert.deepEqual(turn.state, state);
  assert.deepEqual(calls, { clone: [], survey: [], propose: [], readCurrent: [], object: [], approve: [], gate: [], push: [] });
});
