const assert = require('node:assert/strict');
const test = require('node:test');

const {
  recordHumanInput,
  lastHumanInputMs,
  resetHumanInputTracker,
} = require('../out/swarm/humanInputTracker');

test.beforeEach(() => {
  resetHumanInputTracker();
});

test('lastHumanInputMs returns null for a role with no recorded input', () => {
  assert.equal(lastHumanInputMs('coder'), null);
});

test('recordHumanInput remembers the timestamp for its role', () => {
  recordHumanInput('coder', 1000);
  assert.equal(lastHumanInputMs('coder'), 1000);
});

test('recordHumanInput overwrites with the latest timestamp', () => {
  recordHumanInput('coder', 1000);
  recordHumanInput('coder', 2000);
  assert.equal(lastHumanInputMs('coder'), 2000);
});

test('recordHumanInput tracks roles independently', () => {
  recordHumanInput('coder', 1000);
  recordHumanInput('cleaner', 2000);
  assert.equal(lastHumanInputMs('coder'), 1000);
  assert.equal(lastHumanInputMs('cleaner'), 2000);
});

test('recordHumanInput defaults to the current time when no timestamp is given', () => {
  const before = Date.now();
  recordHumanInput('coder');
  const after = Date.now();
  const recorded = lastHumanInputMs('coder');
  assert.ok(recorded >= before && recorded <= after);
});
