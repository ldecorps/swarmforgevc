const assert = require('node:assert/strict');
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

// BL-109: a line with no recognizable prompt marker at all is standing UI
// chrome (e.g. Claude Code's idle status footer), never unsubmitted input.
// The pre-BL-109 fallback ("no marker -> treat the whole line as pending")
// permanently misread that footer as forever-pending text, so
// beginInjection took the "recover pending text" branch and never actually
// typed the wake-up message into a genuinely IDLE pane - reproduced live
// against the real captured footer text below.
test('hasPendingInput is false for a bare line with no marker at all', () => {
  assert.equal(hasPendingInput('commit and hand off to cleaner'), false);
});

test('hasPendingInput is false for the real idle Claude Code status footer (BL-109 root cause)', () => {
  assert.equal(
    hasPendingInput('some history\n  ⏵⏵ bypass permissions on (shift+tab to cycle)                    /rc'),
    false
  );
});

test('isTextStillPending matches the injected text sitting on the input line', () => {
  const capture = 'history line\n❯ bash .swarmforge/launch/specifier.sh';
  assert.equal(isTextStillPending(capture, 'bash .swarmforge/launch/specifier.sh'), true);
});

test('isTextStillPending is false once the input line is empty (submitted)', () => {
  const capture = 'history line\nbash .swarmforge/launch/specifier.sh ran\n❯ ';
  assert.equal(isTextStillPending(capture, 'bash .swarmforge/launch/specifier.sh'), false);
});

test('isTextStillPending is false once the pending line no longer contains the injected text', () => {
  assert.equal(isTextStillPending('❯ something else entirely', 'bash .swarmforge/launch/specifier.sh'), false);
});

test('hasPendingInput is false for a line holding only blank/whitespace content (not the last real line)', () => {
  assert.equal(hasPendingInput('❯ real pending text\n   \n'), true);
});

test('a marker directly adjacent to content with no separating space is still captured in full', () => {
  // Distinguishes the marker char class from its negation: with no space
  // after the marker, a negated class would consume one content character
  // as if it were the marker itself, truncating "foo" down to "oo" - which
  // would then fail to contain the full injected text "foo" (a truncated
  // "oo" cannot include a longer "foo").
  assert.equal(isTextStillPending('❯foo', 'foo'), true);
});

test('hasPendingInput is false when the only candidate line is entirely whitespace', () => {
  assert.equal(hasPendingInput('   '), false);
});

test('isTextStillPending is false when there is no pending input at all, even for an empty injected text', () => {
  // Guards the length>0 short-circuit itself: an empty pending line must
  // never be reported as "still pending" no matter what text is asked about,
  // including an edge-case empty string (which .includes() would trivially
  // match against anything).
  assert.equal(isTextStillPending('❯ ', ''), false);
});

test('isTextStillPending trims the injected text before comparing, tolerating incidental padding', () => {
  assert.equal(isTextStillPending('❯ foo', ' foo '), true);
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
  assert.equal(result.reason, 'submit not confirmed after 2 attempt(s)');
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
  // Exact status/reason (not just "not delivered") pins down that `typed`
  // correctly stays false on the recovering-pending path, distinguishing it
  // from the freshly-typed exhausted-retries case above.
  assert.equal(result.status, 'skipped-pending');
  assert.equal(result.reason, 'pane already held undelivered input and it still would not submit');
});

// BL-093 verified-submit-02
test('sendInstructionVerified: a transport-level send failure aborts immediately, no retry loop burned', () => {
  const { deps, calls } = makeDeps(['❯ '], { sendLiteralOk: false });
  const result = sendInstructionVerified(deps, 'do the thing', { maxRetries: 5, retryDelayMs: 10 });
  assert.equal(result.status, 'failed');
  assert.equal(result.attempts, 0);
  assert.equal(result.reason, 'send failed at the transport level');
  assert.equal(calls.sendEnter, 0, 'must not retry Enter when the send itself never reached the pane');
  assert.equal(calls.wait.length, 0);
});

test('sendInstructionVerified: backs off with an increasing delay per attempt, not a decreasing one', () => {
  const captures = [
    '❯ ',
    '❯ do the thing',
    '❯ do the thing',
    '❯ do the thing',
    'ran do the thing\n❯ ',
  ];
  const { deps, calls } = makeDeps(captures);
  sendInstructionVerified(deps, 'do the thing', { maxRetries: 10, retryDelayMs: 10 });
  assert.deepEqual(calls.wait, [10, 20, 30], 'wait(retryDelayMs * attempts): 10, 20, 30 - not a shrinking division');
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

// BL-093 no-stacking-03
test('sendInstructionVerified: retry loop tracks the RECOVERED pending text, not the newly-requested text', () => {
  // The pane already holds an unrelated, stale instruction when a different
  // one is requested. If pendingText were never updated to the recovered
  // line (i.e. it silently stayed as the newly-requested text, which was
  // never typed on this path), the very first capture - which still shows
  // the stale text and does NOT contain the new text - would look like an
  // immediate "not pending" match and report delivered after only 1 attempt,
  // one Enter too few.
  const captures = [
    '❯ old leftover command', // already pending, unrelated to what's requested
    '❯ old leftover command', // still pending after the first recovery Enter
    'ran\n❯ ', // finally clears after the second Enter
  ];
  const { deps, calls } = makeDeps(captures);
  const result = sendInstructionVerified(deps, 'brand new instruction', { maxRetries: 3, retryDelayMs: 5 });
  assert.equal(result.status, 'delivered');
  assert.equal(result.attempts, 2, 'must track the recovered stale text, requiring the second Enter to see it clear');
  assert.equal(calls.sendLiteral.length, 0);
});
