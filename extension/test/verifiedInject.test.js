const assert = require('node:assert/strict');
const test = require('node:test');

const {
  hasPendingInput,
  isTextStillPending,
  sendInstructionVerified,
} = require('../out/swarm/verifiedInject');

// --- hasPendingInput / isTextStillPending: pure heuristics over rendered
//     pane text, no tmux involved. ---

test('hasPendingInput is false for an empty prompt line', () => {
  assert.equal(hasPendingInput('some history\n❯ '), false);
  assert.equal(hasPendingInput('$ '), false);
  assert.equal(hasPendingInput(''), false);
});

test('hasPendingInput is true when unsubmitted text trails the prompt marker', () => {
  assert.equal(hasPendingInput('some history\n❯ bash .swarmforge/launch/specifier.sh'), true);
  assert.equal(hasPendingInput('$ commit and hand off to cleaner'), true);
});

test('hasPendingInput is true for a bare input line with no marker', () => {
  assert.equal(hasPendingInput('commit and hand off to cleaner'), true);
});

test('isTextStillPending matches the injected text sitting on the input line', () => {
  const capture = 'history line\n❯ bash .swarmforge/launch/specifier.sh';
  assert.equal(isTextStillPending(capture, 'bash .swarmforge/launch/specifier.sh'), true);
});

test('isTextStillPending is false once the input line is empty (submitted)', () => {
  const capture = 'history line\nbash .swarmforge/launch/specifier.sh ran\n❯ ';
  assert.equal(isTextStillPending(capture, 'bash .swarmforge/launch/specifier.sh'), false);
});

// --- sendInstructionVerified: orchestration against injected fakes, no
//     tmux/sleep involved (deps.wait is a spy, never a real timer). ---

function makeDeps(captureSequence, { sendLiteralOk = true } = {}) {
  const calls = { sendLiteral: [], sendEnter: 0, wait: [] };
  let i = 0;
  return {
    calls,
    deps: {
      capturePane: () => {
        const value = captureSequence[Math.min(i, captureSequence.length - 1)];
        i += 1;
        return value;
      },
      sendLiteral: (text) => {
        calls.sendLiteral.push(text);
        return sendLiteralOk;
      },
      sendEnter: () => {
        calls.sendEnter += 1;
      },
      wait: (ms) => calls.wait.push(ms),
    },
  };
}

// BL-093 verified-submit-01
test('sendInstructionVerified: submits on the first try when the pane clears immediately', () => {
  const { deps, calls } = makeDeps(['❯ ', '❯ ']);
  const result = sendInstructionVerified(deps, 'do the thing');
  assert.equal(result.status, 'delivered');
  assert.equal(result.attempts, 1);
  assert.deepEqual(calls.sendLiteral, ['do the thing']);
  assert.equal(calls.sendEnter, 1);
  assert.equal(calls.wait.length, 0);
});

// BL-093 verified-submit-01
test('sendInstructionVerified: a lost Enter is retried until the instruction submits', () => {
  const captures = [
    '❯ ', // before-typing check: nothing pending
    '❯ do the thing', // after first Enter: still sitting there (lost)
    '❯ do the thing', // after second Enter: still sitting there
    'ran do the thing\n❯ ', // after third Enter: submitted
  ];
  const { deps, calls } = makeDeps(captures);
  const result = sendInstructionVerified(deps, 'do the thing', { maxRetries: 5, retryDelayMs: 10 });
  assert.equal(result.status, 'delivered');
  assert.equal(result.attempts, 3);
  assert.equal(calls.sendEnter, 3);
  assert.equal(calls.wait.length, 2, 'must back off between retries, not on the final success');
  assert.deepEqual(calls.sendLiteral, ['do the thing'], 'must type the instruction exactly once, never re-type on retry');
});

// BL-093 verified-submit-02
test('sendInstructionVerified: reports failure after exhausting retries, never re-types', () => {
  const { deps, calls } = makeDeps(['❯ ', '❯ do the thing']);
  const result = sendInstructionVerified(deps, 'do the thing', { maxRetries: 2, retryDelayMs: 5 });
  assert.equal(result.status, 'failed');
  assert.equal(result.attempts, 2);
  assert.match(result.reason, /not confirmed/);
  assert.deepEqual(calls.sendLiteral, ['do the thing']);
});

// BL-093 no-stacking-03
test('sendInstructionVerified: never stacks a second copy onto an already-pending input', () => {
  const { deps, calls } = makeDeps(['❯ bash .swarmforge/launch/specifier.sh']);
  const result = sendInstructionVerified(deps, 'bash .swarmforge/launch/specifier.sh', {
    maxRetries: 1,
    retryDelayMs: 5,
  });
  assert.equal(calls.sendLiteral.length, 0, 'must not type a new copy when one is already pending');
  assert.notEqual(result.status, 'delivered');
});

// BL-093 verified-submit-02
test('sendInstructionVerified: a transport-level send failure aborts immediately, no retry loop burned', () => {
  const { deps, calls } = makeDeps(['❯ '], { sendLiteralOk: false });
  const result = sendInstructionVerified(deps, 'do the thing', { maxRetries: 5, retryDelayMs: 10 });
  assert.equal(result.status, 'failed');
  assert.equal(calls.sendEnter, 0, 'must not retry Enter when the send itself never reached the pane');
  assert.equal(calls.wait.length, 0);
});

// BL-093 no-stacking-03
test('sendInstructionVerified: recovers pre-existing pending input by submitting it, not retyping', () => {
  const captures = [
    '❯ bash .swarmforge/launch/specifier.sh', // already pending on entry
    'ran\n❯ ', // Enter recovers it
  ];
  const { deps, calls } = makeDeps(captures);
  const result = sendInstructionVerified(deps, 'bash .swarmforge/launch/specifier.sh', {
    maxRetries: 3,
    retryDelayMs: 5,
  });
  assert.equal(result.status, 'delivered');
  assert.equal(calls.sendLiteral.length, 0, 'recovering a pre-existing pending line must never type a new copy');
  assert.equal(calls.sendEnter, 1);
});
