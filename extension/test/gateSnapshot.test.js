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

// BL-395 approval-chrome-05: extractQuestionSnippet is the SINGLE source
// feeding both the Telegram send and the git-committed topic record - this
// locks that the chrome filter reaches the snippet recorded here too, not
// just extractQuestionSnippet in isolation.
test('computeRoleGateStates records a snippet free of box-rule and footer chrome', () => {
  const pane = [
    'Should I deploy BL-900 to production?',
    '─'.repeat(60),
    '❯ ',
    '⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents',
  ].join('\n');
  const states = computeRoleGateStates(['coder'], () => pane);

  assert.deepEqual(states, [
    { role: 'coder', gated: true, snippet: 'Should I deploy BL-900 to production?' },
  ]);
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
