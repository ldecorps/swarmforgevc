const assert = require('node:assert/strict');
const { routeOnboardingMessage, pickActiveContractPhaseState, pickUnambiguousInFlightState } = require('../out/onboarding/onboarderContractPhaseRouter');
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
  const calls = { clone: [], survey: [], propose: [], readCurrent: [], object: [], approve: [], gate: [], push: [], prompts: [] };
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
    async proposePrompts(url) {
      calls.prompts.push(url);
      return { committed: true, withheld: false };
    },
    ...overrides,
    calls,
  };
}

function stateAt(phase, overrides = {}) {
  return { targetRepoUrl: TARGET_URL, phase, stepIndex: 5, verifiedSteps: [], paused: false, updatedAtMs: NOW_MS - 1000, ...overrides };
}

// ── pickActiveContractPhaseState ────────────────────────────────────────

test('BL-624/BL-625: pickActiveContractPhaseState picks prerequisites-ready through ready-to-launch, but never checking-prerequisites or done', () => {
  assert.equal(pickActiveContractPhaseState([stateAt('prerequisites-ready')]).phase, 'prerequisites-ready');
  assert.equal(pickActiveContractPhaseState([stateAt('contract-proposed')]).phase, 'contract-proposed');
  assert.equal(pickActiveContractPhaseState([stateAt('negotiating')]).phase, 'negotiating');
  assert.equal(pickActiveContractPhaseState([stateAt('contract-agreed')]).phase, 'contract-agreed');
  assert.equal(pickActiveContractPhaseState([stateAt('prompts-proposed')]).phase, 'prompts-proposed');
  assert.equal(pickActiveContractPhaseState([stateAt('ready-to-launch')]).phase, 'ready-to-launch');
  assert.equal(pickActiveContractPhaseState([stateAt('done')]), undefined);
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

test('BL-625: a contract-agreed target is now in flight for the launch phases - an unrecognized control gets a helpful reply, never no-active-onboarding', async () => {
  const adapters = fakeAdapters();
  const agreed = stateAt('contract-agreed');
  const outcome = await routeOnboardingMessage([agreed], 'show-me', now, adapters);
  assert.equal(outcome.kind, 'advanced');
  assert.equal(outcome.state.phase, 'contract-agreed', 'show-me is not a recognized control here, so state stays put');
  assert.deepEqual(adapters.calls.readCurrent, []);
});

test('BL-625 scenario 01 (routed): "proceed" while contract-agreed is active routes into the prompts orchestration', async () => {
  const adapters = fakeAdapters();
  const agreed = stateAt('contract-agreed');
  const outcome = await routeOnboardingMessage([agreed], 'proceed', now, adapters);
  assert.equal(outcome.kind, 'advanced');
  assert.equal(outcome.state.phase, 'prompts-proposed');
  assert.deepEqual(adapters.calls.prompts, [TARGET_URL]);
});

// ── BL-625 invariant 2: pickUnambiguousInFlightState / ambiguous-target ──

test('BL-625 invariant 2: with 0 or 1 target in flight, pickUnambiguousInFlightState defers (no ambiguity possible)', () => {
  assert.deepEqual(pickUnambiguousInFlightState([], 'proceed'), { state: undefined });
  assert.deepEqual(pickUnambiguousInFlightState([stateAt('contract-agreed')], 'proceed'), { state: undefined });
});

test('BL-625 invariant 2: with 2+ targets in flight, a reply naming exactly one target resolves to it', () => {
  const a = stateAt('contract-agreed', { targetRepoUrl: 'https://github.com/acme/alpha' });
  const b = stateAt('prompts-proposed', { targetRepoUrl: 'https://github.com/acme/beta' });
  const result = pickUnambiguousInFlightState([a, b], 'proceed for https://github.com/acme/beta');
  assert.equal(result.state.targetRepoUrl, b.targetRepoUrl);
  assert.equal(result.ambiguousMessage, undefined);
});

test('BL-625 invariant 2: with 2+ targets in flight, a reply naming none of them is refused as ambiguous, listing every in-flight target', () => {
  const a = stateAt('contract-agreed', { targetRepoUrl: 'https://github.com/acme/alpha' });
  const b = stateAt('prompts-proposed', { targetRepoUrl: 'https://github.com/acme/beta' });
  const result = pickUnambiguousInFlightState([a, b], 'proceed');
  assert.equal(result.state, undefined);
  assert.match(result.ambiguousMessage, /alpha/);
  assert.match(result.ambiguousMessage, /beta/);
});

test('BL-625 invariant 2: routeOnboardingMessage refuses an unattributable reply as ambiguous-target rather than picking the most recently touched', async () => {
  const adapters = fakeAdapters();
  const older = stateAt('contract-agreed', { targetRepoUrl: 'https://github.com/acme/older', updatedAtMs: 1 });
  const newer = stateAt('prompts-proposed', { targetRepoUrl: 'https://github.com/acme/newer', updatedAtMs: 2 });
  const outcome = await routeOnboardingMessage([older, newer], 'proceed', now, adapters);
  assert.equal(outcome.kind, 'ambiguous-target');
  assert.equal(outcome.state, undefined);
  assert.deepEqual(adapters.calls.prompts, [], 'expected neither target to be acted on while ambiguous');
  assert.deepEqual(adapters.calls.push, []);
});

test('BL-625 invariant 2: a fresh repo URL is never ambiguous even with 2+ other targets in flight', async () => {
  const adapters = fakeAdapters();
  const a = stateAt('contract-agreed', { targetRepoUrl: 'https://github.com/acme/alpha' });
  const b = stateAt('prompts-proposed', { targetRepoUrl: 'https://github.com/acme/beta' });
  const outcome = await routeOnboardingMessage([a, b], 'https://github.com/acme/gamma', now, adapters);
  assert.equal(outcome.kind, 'started');
  assert.equal(outcome.state.targetRepoUrl, 'https://github.com/acme/gamma');
});
