const assert = require('node:assert/strict');
const { runRecruiter } = require('../out/recruiter/orchestrator');

// BL-233 QA bounce (ddc0d351ed, "no orchestrator/report-writer ties slices
// 1-4 together"): runRecruiter is the missing "report writer" - wires
// discover -> acquire -> qualify -> group-by-role -> rank -> recommend
// using ONLY already-shipped slice functions (no new business logic, pure
// composition). Every dependency is faked here per the TESTABLE-boundary
// constraint; the real discoverySource/secretStore/battery wiring is
// exercised by recruiterRun CLI's own test against real implementations.

function candidate(model, overrides = {}) {
  return {
    model,
    provider: 'acme-ai',
    planCost: { amountUsd: 0, unit: 'free' },
    signupPath: { url: 'https://acme.example/signup', automation: 'automatable' },
    ...overrides,
  };
}

function fakeDiscovery(candidates) {
  return { async discover() { return candidates; } };
}

function fakeSignup(keyByModel) {
  return {
    async signUp(c) {
      const key = keyByModel[c.model];
      if (!key) throw new Error(`unexpected signUp call for ${c.model}`);
      return key;
    },
  };
}

function fakeSecretStore() {
  return { calls: [], async store(c, apiKey) { this.calls.push({ candidate: c, apiKey }); } };
}

// trialsByModel: { [model]: RoleTrial[] }
function fakeTrialRunner(trialsByModel) {
  return { async runTrials(c) { return trialsByModel[c.model] || []; } };
}

// gateResultsByCompetency: { [competency]: BatteryEntry }
function fakeBattery(gateResultsByCompetency, overallByModel) {
  return {
    async gate(role, _args) {
      const competency = `${role}-gate`;
      return gateResultsByCompetency[competency] || { competency, status: 'fail', reason: 'unconfigured in fixture' };
    },
    async scorecard(model, entries) {
      return { model, entries, overall: overallByModel[model] };
    },
  };
}

test('discovers, acquires, qualifies, and ranks a single automatable candidate for its trialled role', async () => {
  const discovery = fakeDiscovery([candidate('free-model-mini')]);
  const signup = fakeSignup({ 'free-model-mini': 'sk-live-abc' });
  const secretStore = fakeSecretStore();
  const trialRunner = fakeTrialRunner({ 'free-model-mini': [{ role: 'hardener', gateArgs: ['2', '1.0', '0'] }] });
  const battery = fakeBattery(
    { 'hardener-gate': { competency: 'hardener-gate', status: 'pass' } },
    { 'free-model-mini': 'swarm-compliant' }
  );

  const report = await runRecruiter({
    discovery,
    signup,
    secretStore,
    trialRunner,
    battery,
    currentModelByRole: { hardener: 'incumbent-model' },
  });

  assert.equal(secretStore.calls.length, 1, 'the acquired key must actually be stored');
  assert.equal(secretStore.calls[0].apiKey, 'sk-live-abc');
  assert.equal(report.roles.length, 1);
  assert.equal(report.roles[0].role, 'hardener');
  assert.deepEqual(report.roles[0].leaderboard.ranked.map((e) => e.model), ['free-model-mini']);
  assert.deepEqual(report.roles[0].leaderboard.reference, { model: 'incumbent-model' });
  assert.equal(report.roles[0].suggestion.suggestedModel, 'free-model-mini');
  assert.match(report.roles[0].suggestion.swarmforgeConfLine, /--model free-model-mini/);
  assert.deepEqual(report.escalated, []);
});

test('a wall-blocked candidate is escalated, never acquired, qualified, or ranked', async () => {
  const wallCandidate = candidate('walled-model', { signupPath: { url: 'https://x', automation: 'payment-wall' } });
  const discovery = fakeDiscovery([wallCandidate]);
  const signup = fakeSignup({}); // must never be called
  const secretStore = fakeSecretStore();
  const trialRunner = { calls: [], async runTrials(c) { this.calls.push(c); return []; } };
  const battery = fakeBattery({}, {});

  const report = await runRecruiter({
    discovery,
    signup,
    secretStore,
    trialRunner,
    battery,
    currentModelByRole: {},
  });

  assert.deepEqual(report.escalated, [{ model: 'walled-model', wall: 'payment-wall' }]);
  assert.equal(secretStore.calls.length, 0);
  assert.equal(trialRunner.calls.length, 0, 'a candidate that never got access must never be sent through qualify');
  assert.deepEqual(report.roles, []);
});

test('a non-compliant candidate is qualified but excluded from its role leaderboard', async () => {
  const discovery = fakeDiscovery([candidate('flaky-model')]);
  const signup = fakeSignup({ 'flaky-model': 'sk-live-xyz' });
  const secretStore = fakeSecretStore();
  const trialRunner = fakeTrialRunner({ 'flaky-model': [{ role: 'coordinator', gateArgs: ['1', '3', 'false'] }] });
  const battery = fakeBattery(
    { 'coordinator-gate': { competency: 'coordinator-gate', status: 'fail', reason: 'declined to promote' } },
    { 'flaky-model': 'non-compliant' }
  );

  const report = await runRecruiter({
    discovery,
    signup,
    secretStore,
    trialRunner,
    battery,
    currentModelByRole: { coordinator: 'incumbent-model' },
  });

  assert.equal(report.roles.length, 1);
  assert.deepEqual(report.roles[0].leaderboard.ranked, []);
  assert.equal(report.roles[0].leaderboard.recommended, null);
  assert.equal(report.roles[0].suggestion, null, 'no recommendation to suggest when nothing is compliant');
});

test('candidates trialled for multiple roles are grouped and ranked once per role', async () => {
  const discovery = fakeDiscovery([candidate('multi-role-model')]);
  const signup = fakeSignup({ 'multi-role-model': 'sk-live-multi' });
  const secretStore = fakeSecretStore();
  const trialRunner = fakeTrialRunner({
    'multi-role-model': [
      { role: 'hardener', gateArgs: ['2', '1.0', '0'] },
      { role: 'coordinator', gateArgs: ['1', '3', 'true'] },
    ],
  });
  const battery = fakeBattery(
    {
      'hardener-gate': { competency: 'hardener-gate', status: 'pass' },
      'coordinator-gate': { competency: 'coordinator-gate', status: 'pass' },
    },
    { 'multi-role-model': 'swarm-compliant' }
  );

  const report = await runRecruiter({
    discovery,
    signup,
    secretStore,
    trialRunner,
    battery,
    currentModelByRole: { hardener: 'incumbent-hardener', coordinator: 'incumbent-coordinator' },
  });

  const roles = report.roles.map((r) => r.role).sort();
  assert.deepEqual(roles, ['coordinator', 'hardener']);
  for (const roleReport of report.roles) {
    assert.deepEqual(roleReport.leaderboard.ranked.map((e) => e.model), ['multi-role-model']);
  }
});

test('an empty discovery result produces an empty report, not a crash', async () => {
  const report = await runRecruiter({
    discovery: fakeDiscovery([]),
    signup: fakeSignup({}),
    secretStore: fakeSecretStore(),
    trialRunner: fakeTrialRunner({}),
    battery: fakeBattery({}, {}),
    currentModelByRole: {},
  });

  assert.deepEqual(report, { roles: [], escalated: [] });
});
