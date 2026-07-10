const assert = require('node:assert/strict');
const { qualifyCandidate } = require('../out/recruiter/qualify');

// BL-233 slice 3 (qualify-via-battery-04). trialRunner/battery are the
// injectable seams the TESTABLE-boundary constraint requires - no real
// candidate-driving or subprocess calls here. The real battery
// implementation (createComplianceBatteryGate) is exercised directly by
// recruiterComplianceBatteryGate.test.js against the real compliance_battery.bb.

function candidate(overrides = {}) {
  return {
    model: 'free-model-mini',
    provider: 'acme-ai',
    planCost: { amountUsd: 0, unit: 'free' },
    signupPath: { url: 'https://acme.example/signup', automation: 'automatable' },
    ...overrides,
  };
}

function fakeTrialRunner(trials) {
  return {
    calls: [],
    async runTrials(c) {
      this.calls.push(c);
      return trials;
    },
  };
}

function fakeBattery(gateResultsByRole, scorecardResult) {
  return {
    gateCalls: [],
    scorecardCalls: [],
    async gate(role, args) {
      this.gateCalls.push({ role, args });
      return gateResultsByRole[role];
    },
    async scorecard(model, entries) {
      this.scorecardCalls.push({ model, entries });
      return scorecardResult;
    },
  };
}

test('qualifyCandidate runs the trial runner, gates each trial, and scores the aggregated entries', async () => {
  const trials = [
    { role: 'hardener', gateArgs: ['2', '1.0', '0'] },
    { role: 'coordinator', gateArgs: ['1', '3', 'true'] },
  ];
  const trialRunner = fakeTrialRunner(trials);
  const gateResultsByRole = {
    hardener: { competency: 'hardener-gate', status: 'pass' },
    coordinator: { competency: 'coordinator-gate', status: 'pass' },
  };
  const scorecardResult = {
    model: 'free-model-mini',
    entries: [gateResultsByRole.hardener, gateResultsByRole.coordinator],
    overall: 'swarm-compliant',
  };
  const battery = fakeBattery(gateResultsByRole, scorecardResult);

  const outcome = await qualifyCandidate(candidate(), { trialRunner, battery });

  assert.equal(trialRunner.calls.length, 1);
  assert.equal(trialRunner.calls[0].model, 'free-model-mini');
  assert.deepEqual(battery.gateCalls, [
    { role: 'hardener', args: ['2', '1.0', '0'] },
    { role: 'coordinator', args: ['1', '3', 'true'] },
  ]);
  assert.equal(battery.scorecardCalls.length, 1);
  assert.equal(battery.scorecardCalls[0].model, 'free-model-mini');
  assert.deepEqual(battery.scorecardCalls[0].entries, [gateResultsByRole.hardener, gateResultsByRole.coordinator]);
  assert.deepEqual(outcome, { model: 'free-model-mini', scorecard: scorecardResult });
});

test('a candidate with no configured trials still gets an (empty-entries) scorecard, not a crash', async () => {
  const trialRunner = fakeTrialRunner([]);
  const scorecardResult = { model: 'free-model-mini', entries: [], overall: 'swarm-compliant' };
  const battery = fakeBattery({}, scorecardResult);

  const outcome = await qualifyCandidate(candidate(), { trialRunner, battery });

  assert.equal(battery.scorecardCalls[0].entries.length, 0);
  assert.deepEqual(outcome, { model: 'free-model-mini', scorecard: scorecardResult });
});

test('a non-compliant gate result still flows through to the scorecard (qualify never filters, only records)', async () => {
  const trials = [{ role: 'hardener', gateArgs: ['10', '0.1', '3'] }];
  const trialRunner = fakeTrialRunner(trials);
  const gateResultsByRole = {
    hardener: { competency: 'hardener-gate', status: 'fail', reason: '3 mutant(s) survived' },
  };
  const scorecardResult = { model: 'free-model-mini', entries: [gateResultsByRole.hardener], overall: 'non-compliant' };
  const battery = fakeBattery(gateResultsByRole, scorecardResult);

  const outcome = await qualifyCandidate(candidate(), { trialRunner, battery });

  assert.equal(outcome.scorecard.overall, 'non-compliant');
  assert.equal(outcome.scorecard.entries[0].status, 'fail');
});
