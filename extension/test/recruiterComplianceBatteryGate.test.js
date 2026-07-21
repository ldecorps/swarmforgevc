const assert = require('node:assert/strict');
const { createComplianceBatteryGate } = require('../out/recruiter/complianceBatteryGate');

// BL-233 slice 3 (qualify-via-battery-04): the real implementation - drives
// the REAL swarmforge/scripts/compliance_battery.bb CLI, mirroring
// specs/pipeline/steps/complianceBatterySteps.js's own execFileSync
// convention. Uses the hardener/coordinator gates specifically because
// they need no git/tmux fixture scaffolding (unlike coder/cleaner/
// architect/documenter/QA), matching complianceBatterySteps.js's own
// per-role-04 fixtures for those two roles - real battery execution, no
// hand-simulated check logic.

test('gate("hardener", ...) runs the real battery and returns a pass entry for a compliant trial', async () => {
  const battery = createComplianceBatteryGate();

  const entry = await battery.gate('hardener', ['2', '1.0', '0']);

  assert.equal(entry.competency, 'hardener-gate');
  assert.equal(entry.status, 'pass');
});

test('gate("hardener", ...) returns a fail entry with a reason for a non-compliant trial', async () => {
  const battery = createComplianceBatteryGate();

  const entry = await battery.gate('hardener', ['2', '1.0', '3']);

  assert.equal(entry.competency, 'hardener-gate');
  assert.equal(entry.status, 'fail');
  assert.ok(entry.reason, 'expected a reason for the failing gate');
});

test('gate("coordinator", ...) runs the real battery', async () => {
  const battery = createComplianceBatteryGate();

  const entry = await battery.gate('coordinator', ['1', '3', 'true']);

  assert.equal(entry.competency, 'coordinator-gate');
  assert.equal(entry.status, 'pass');
});

test('scorecard aggregates real gate entries into a model scorecard with an overall verdict', async () => {
  const battery = createComplianceBatteryGate();
  const hardenerEntry = await battery.gate('hardener', ['2', '1.0', '0']);
  const coordinatorEntry = await battery.gate('coordinator', ['1', '3', 'true']);

  const scorecard = await battery.scorecard('candidate-model', [hardenerEntry, coordinatorEntry]);

  assert.equal(scorecard.model, 'candidate-model');
  assert.deepEqual(scorecard.entries, [hardenerEntry, coordinatorEntry]);
  assert.equal(scorecard.overall, 'swarm-compliant');
});

test('scorecard reports a non-compliant overall verdict when any entry failed', async () => {
  const battery = createComplianceBatteryGate();
  const failingEntry = await battery.gate('hardener', ['2', '1.0', '3']);

  const scorecard = await battery.scorecard('candidate-model', [failingEntry]);

  assert.notEqual(scorecard.overall, 'swarm-compliant');
});
