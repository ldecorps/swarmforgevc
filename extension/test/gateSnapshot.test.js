const assert = require('node:assert/strict');
const { computeRoleGateStates, filterPendingGates } = require('../out/bridge/gateSnapshot');

test('computeRoleGateStates marks a role gated with its question snippet', () => {
  const states = computeRoleGateStates(['coder', 'cleaner'], (role) =>
    role === 'coder' ? 'Some output\nAllow this action? (y/n)' : 'Some output\n[auto] idle'
  );

  assert.deepEqual(states, [
    { role: 'coder', gated: true, snippet: 'Some output Allow this action? (y/n)' },
    { role: 'cleaner', gated: false },
  ]);
});

test('computeRoleGateStates reports not-gated (no snippet) for a role whose pane could not be captured', () => {
  const states = computeRoleGateStates(['coder'], () => undefined);

  assert.deepEqual(states, [{ role: 'coder', gated: false }]);
});

test('computeRoleGateStates never includes a snippet field for a non-gated role', () => {
  const states = computeRoleGateStates(['coder'], () => '[auto] idle');

  assert.deepEqual(states, [{ role: 'coder', gated: false }]);
  assert.equal('snippet' in states[0], false);
});

// ── filterPendingGates (pure, BL-265) ─────────────────────────────────────

// BL-265 gates-list-pending-01
test('filterPendingGates keeps only the currently-gated roles, dropping non-gated ones', () => {
  const states = [
    { role: 'coder', gated: true, snippet: 'Allow this? (y/n)' },
    { role: 'cleaner', gated: false },
  ];

  assert.deepEqual(filterPendingGates(states), [{ role: 'coder', gated: true, snippet: 'Allow this? (y/n)' }]);
});

// BL-265 gates-empty-when-none-02
test('filterPendingGates returns an empty list, not an error, when no role is gated', () => {
  const states = [{ role: 'coder', gated: false }, { role: 'cleaner', gated: false }];

  assert.deepEqual(filterPendingGates(states), []);
});

test('filterPendingGates handles an empty input list', () => {
  assert.deepEqual(filterPendingGates([]), []);
});
