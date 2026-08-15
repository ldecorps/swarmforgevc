const assert = require('node:assert/strict');
const { routeOnboardingMessage, pickActiveContractPhaseState } = require('../out/onboarding/onboarderContractPhaseRouter');
const { createOnboardingState } = require('../out/onboarding/onboarderState');

const TARGET_URL = 'https://github.com/acme/widget';
const NOW_MS = 1_700_000_000_000;
const now = () => NOW_MS;

const FIXTURE_CONTRACT = {
  scope: ['Deliver the seed vision: Ship the MVP.'],
  outOfScope: [],
  boundaries: ['Every feature still passes its own approval gate.'],
  initialBacklogSummary: '3 tickets queued.',
  agreement: 'proposed',
};

function fakeAdapters(overrides = {}) {
  const calls = { clone: [], survey: [], propose: [], readCurrent: [], object: [], approve: [], gate: [], push: [] };
  return {
    async cloneTarget(url) {
      calls.clone.push(url);
      return { ok: true };
    },
    async surveyRepo(url) {
      calls.survey.push(url);
      return { languages: [], layoutSummary: '', readmeSummary: '', seedVision: '', initialBacklogSummary: '', useCaseObservations: [] };
    },
    async proposeContract(url) {
      calls.propose.push(url);
      return FIXTURE_CONTRACT;
    },
    async readCurrentContract(url) {
      calls.readCurrent.push(url);
      return FIXTURE_CONTRACT;
    },
    async negotiateObject(url, objection) {
      calls.object.push({ url, objection });
      return { outcome: 'revised', contract: FIXTURE_CONTRACT };
    },
    async negotiateApprove(url) {
      calls.approve.push(url);
      return { outcome: 'agreed', contract: { ...FIXTURE_CONTRACT, agreement: 'agreed' } };
    },
    async checkGate(url) {
      calls.gate.push(url);
      return { decision: 'allow' };
    },
    async commitAndPush(url) {
      calls.push.push(url);
      return { ok: true, commitSha: 'abc1234def' };
    },
    ...overrides,
    calls,
  };
}

function stateAt(phase, overrides = {}) {
  return { targetRepoUrl: TARGET_URL, phase, stepIndex: 5, verifiedSteps: [], paused: false, updatedAtMs: NOW_MS - 1000, ...overrides };
}

// ── pickActiveContractPhaseState ────────────────────────────────────────

test('BL-624: pickActiveContractPhaseState picks prerequisites-ready/contract-proposed/negotiating but never contract-agreed', () => {
  assert.equal(pickActiveContractPhaseState([stateAt('prerequisites-ready')]).phase, 'prerequisites-ready');
  assert.equal(pickActiveContractPhaseState([stateAt('contract-proposed')]).phase, 'contract-proposed');
  assert.equal(pickActiveContractPhaseState([stateAt('negotiating')]).phase, 'negotiating');
  assert.equal(pickActiveContractPhaseState([stateAt('contract-agreed')]), undefined);
  assert.equal(pickActiveContractPhaseState([stateAt('checking-prerequisites')]), undefined);
  assert.equal(pickActiveContractPhaseState([]), undefined);
});

test('BL-624: pickActiveContractPhaseState picks the most recently touched target among several', () => {
  const older = stateAt('prerequisites-ready', { targetRepoUrl: 'https://github.com/acme/older', updatedAtMs: 1 });
  const newer = stateAt('negotiating', { targetRepoUrl: 'https://github.com/acme/newer', updatedAtMs: 2 });
  assert.equal(pickActiveContractPhaseState([older, newer]).targetRepoUrl, newer.targetRepoUrl);
});

// ── routeOnboardingMessage composition ──────────────────────────────────

test('BL-624: a repo URL still routes through the unchanged prerequisites start/resume path, untouched by the new adapters', async () => {
  const adapters = fakeAdapters();
  const outcome = await routeOnboardingMessage([], TARGET_URL, now, adapters);
  assert.equal(outcome.kind, 'started');
  assert.equal(outcome.state.phase, 'checking-prerequisites');
  assert.deepEqual(adapters.calls.clone, [], 'expected no contract-phase adapter to be touched for a URL start');
});

test('BL-624: a plain reply while a checking-prerequisites target is active still routes through the old prerequisite machinery', async () => {
  const adapters = fakeAdapters();
  const checking = createOnboardingState(TARGET_URL, now);
  const outcome = await routeOnboardingMessage([checking], 'pause', now, adapters);
  assert.equal(outcome.kind, 'advanced');
  assert.equal(outcome.state.paused, true);
  assert.deepEqual(adapters.calls.clone, []);
});

test('BL-624: "proceed" while prerequisites-ready is active routes into the new survey orchestration', async () => {
  const adapters = fakeAdapters();
  const ready = stateAt('prerequisites-ready');
  const outcome = await routeOnboardingMessage([ready], 'proceed', now, adapters);
  assert.equal(outcome.kind, 'advanced');
  assert.equal(outcome.state.phase, 'contract-proposed');
  assert.deepEqual(adapters.calls.clone, [TARGET_URL]);
});

test('BL-624: "show-me" while negotiating routes into the new orchestration without advancing', async () => {
  const adapters = fakeAdapters();
  const negotiating = stateAt('negotiating');
  const outcome = await routeOnboardingMessage([negotiating], 'show-me', now, adapters);
  assert.equal(outcome.kind, 'advanced');
  assert.equal(outcome.state.phase, 'negotiating');
  assert.deepEqual(adapters.calls.readCurrent, [TARGET_URL]);
});

test('BL-624: with nothing checking-prerequisites and nothing at or past prerequisites-ready, the reply is no-active-onboarding', async () => {
  const adapters = fakeAdapters();
  const outcome = await routeOnboardingMessage([], 'proceed', now, adapters);
  assert.equal(outcome.kind, 'no-active-onboarding');
});

test('BL-624: a contract-agreed target is terminal for routing - a stray reply is no-active-onboarding, never re-enters the orchestration', async () => {
  const adapters = fakeAdapters();
  const agreed = stateAt('contract-agreed');
  const outcome = await routeOnboardingMessage([agreed], 'show-me', now, adapters);
  assert.equal(outcome.kind, 'no-active-onboarding');
  assert.deepEqual(adapters.calls.readCurrent, []);
});
