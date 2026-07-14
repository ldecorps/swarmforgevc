const assert = require('node:assert/strict');
const { answerCapturedGate } = require('../out/bridge/gateAnswerPath');

// BL-240: the remote gate-answer write path's pure scope-check + dispatch
// logic, tested with fake deps - no real tmux, matching the ticket's own
// "transport/UI seam faked" testable-boundary constraint.

function fakeDeps(overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      capturePaneText: (role) => (overrides.paneTextByRole ? overrides.paneTextByRole[role] : undefined),
      isPaneGated: overrides.isPaneGated ?? ((text) => /\(y\/n\)/.test(text)),
      sendAnswer: (role, answer) => calls.push({ role, answer }),
      ...overrides.deps,
    },
  };
}

// ── answer-unblocks-01 ────────────────────────────────────────────────────

test('answers a role currently showing a captured gate, dispatching via sendAnswer', () => {
  const { deps, calls } = fakeDeps({ paneTextByRole: { coder: 'Proceed with the migration? (y/n)' } });

  const result = answerCapturedGate({ role: 'coder', answer: 'y' }, deps);

  assert.equal(result.success, true);
  assert.deepEqual(calls, [{ role: 'coder', answer: 'y' }]);
});

// ── scope-gates-only-02 ────────────────────────────────────────────────────

test('refuses a role with no captured gate, dispatching nothing', () => {
  const { deps, calls } = fakeDeps({ paneTextByRole: { coder: 'Compiling... done. [auto] idle' } });

  const result = answerCapturedGate({ role: 'coder', answer: 'y' }, deps);

  assert.equal(result.success, false);
  assert.match(result.reason, /no captured gate/);
  assert.deepEqual(calls, [], 'a non-gated role must never reach sendAnswer');
});

test('refuses a request missing a role, dispatching nothing', () => {
  const { deps, calls } = fakeDeps();
  const result = answerCapturedGate({ role: '', answer: 'y' }, deps);
  assert.equal(result.success, false);
  assert.deepEqual(calls, []);
});

test('refuses a request whose answer is not a string, dispatching nothing', () => {
  const { deps, calls } = fakeDeps({ paneTextByRole: { coder: 'Proceed? (y/n)' } });
  const result = answerCapturedGate({ role: 'coder', answer: undefined }, deps);
  assert.equal(result.success, false);
  assert.deepEqual(calls, []);
});

// ── unauthenticated-refused-03 ─────────────────────────────────────────────
// (auth itself is the HTTP layer's job, reusing bridgeAuth.ts - this module
// never touches it; covered at the bridgeServer.test.js integration layer)

// ── answer-targets-specific-gate-04 ────────────────────────────────────────

test('answering one gated role never dispatches to a different, also-gated role', () => {
  const { deps, calls } = fakeDeps({
    paneTextByRole: {
      coder: 'Proceed with the migration? (y/n)',
      cleaner: 'Overwrite the file? (y/n)',
    },
  });

  const result = answerCapturedGate({ role: 'coder', answer: 'y' }, deps);

  assert.equal(result.success, true);
  assert.deepEqual(calls, [{ role: 'coder', answer: 'y' }]);
  assert.ok(!calls.some((c) => c.role === 'cleaner'), 'must not touch the other gated role');
});

test('an unreachable/unknown role (capturePaneText returns undefined) is refused, not treated as gated', () => {
  const { deps, calls } = fakeDeps({ paneTextByRole: {} });
  const result = answerCapturedGate({ role: 'nonexistent-role', answer: 'y' }, deps);
  assert.equal(result.success, false);
  assert.deepEqual(calls, []);
});
