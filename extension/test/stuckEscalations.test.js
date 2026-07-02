const assert = require('node:assert/strict');
const test = require('node:test');

const {
  setStuckEscalation,
  escalatedStuckRoles,
  clearStuckEscalations,
} = require('../out/watchdog/stuckEscalations');

test.beforeEach(() => {
  clearStuckEscalations();
});

test('escalatedStuckRoles starts empty', () => {
  assert.deepEqual(escalatedStuckRoles(), []);
});

test('setStuckEscalation(role, true) adds the role to the escalated set', () => {
  setStuckEscalation('hardender', true);
  assert.deepEqual(escalatedStuckRoles(), ['hardender']);
});

test('setStuckEscalation(role, false) removes the role from the escalated set', () => {
  setStuckEscalation('hardender', true);
  setStuckEscalation('hardender', false);
  assert.deepEqual(escalatedStuckRoles(), []);
});

test('setStuckEscalation(role, false) on a role never escalated is a no-op', () => {
  setStuckEscalation('coder', false);
  assert.deepEqual(escalatedStuckRoles(), []);
});

test('tracks multiple roles independently', () => {
  setStuckEscalation('specifier', true);
  setStuckEscalation('hardender', true);
  setStuckEscalation('specifier', false);
  assert.deepEqual(escalatedStuckRoles(), ['hardender']);
});

test('clearStuckEscalations resets the whole registry', () => {
  setStuckEscalation('specifier', true);
  setStuckEscalation('hardender', true);
  clearStuckEscalations();
  assert.deepEqual(escalatedStuckRoles(), []);
});
