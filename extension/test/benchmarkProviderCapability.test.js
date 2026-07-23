const assert = require('node:assert/strict');
const { canActAutonomously, autonomyExclusionReason } = require('../out/benchmark/providerCapability');

test('claude can act autonomously', () => {
  assert.equal(canActAutonomously('claude'), true);
  assert.equal(autonomyExclusionReason('claude'), null);
});

test('aider cannot act autonomously and states why', () => {
  assert.equal(canActAutonomously('aider'), false);
  assert.match(autonomyExclusionReason('aider'), /autonomously/);
});
