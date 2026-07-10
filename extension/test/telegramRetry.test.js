const assert = require('node:assert/strict');
const {
  computeTelegramRetryBackoffMs,
  decideTelegramRetryAction,
  sendWithBoundedRetry,
} = require('../out/notify/telegramRetry');

const CONFIG = { maxAttempts: 3, backoffBaseMs: 1000, backoffMaxMs: 8000 };

// ── computeTelegramRetryBackoffMs / decideTelegramRetryAction (pure) ───────

test('computeTelegramRetryBackoffMs doubles per attempt already made, capped at backoffMaxMs', () => {
  assert.equal(computeTelegramRetryBackoffMs(1, CONFIG), 1000);
  assert.equal(computeTelegramRetryBackoffMs(2, CONFIG), 2000);
  assert.equal(computeTelegramRetryBackoffMs(3, CONFIG), 4000);
  assert.equal(computeTelegramRetryBackoffMs(5, { ...CONFIG, backoffMaxMs: 8000 }), 8000);
});

test('decideTelegramRetryAction retries under the bound and escalates once exhausted', () => {
  assert.equal(decideTelegramRetryAction(1, CONFIG), 'retry');
  assert.equal(decideTelegramRetryAction(2, CONFIG), 'retry');
  assert.equal(decideTelegramRetryAction(3, CONFIG), 'escalate');
});

// ── sendWithBoundedRetry (injectable send + wait, no real timers) ──────────

test('sendWithBoundedRetry returns immediately on first-attempt success, no wait/retry', async () => {
  const waits = [];
  let calls = 0;
  const result = await sendWithBoundedRetry(
    async () => {
      calls++;
      return { success: true, messageId: 7 };
    },
    CONFIG,
    async (ms) => waits.push(ms)
  );

  assert.deepEqual(result, { success: true, messageId: 7, attempts: 1 });
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
});

test('sendWithBoundedRetry retries with growing backoff and succeeds once the send recovers', async () => {
  const waits = [];
  let calls = 0;
  const result = await sendWithBoundedRetry(
    async () => {
      calls++;
      if (calls < 3) return { success: false, error: 'network blip' };
      return { success: true, messageId: 99 };
    },
    CONFIG,
    async (ms) => waits.push(ms)
  );

  assert.deepEqual(result, { success: true, messageId: 99, attempts: 3 });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test('sendWithBoundedRetry escalates (gives up) after maxAttempts consecutive failures', async () => {
  const waits = [];
  let calls = 0;
  const result = await sendWithBoundedRetry(
    async () => {
      calls++;
      return { success: false, error: 'still down' };
    },
    CONFIG,
    async (ms) => waits.push(ms)
  );

  assert.equal(result.success, false);
  assert.equal(result.attempts, 3);
  assert.equal(result.error, 'still down');
  assert.equal(calls, 3, 'must never exceed maxAttempts');
  assert.deepEqual(waits, [1000, 2000], 'no wait after the final (escalating) attempt');
});
