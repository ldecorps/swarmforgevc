const assert = require('node:assert/strict');
const {
  awaitRealWatchEvent,
  describeWatchWaitTimeout,
  DEFAULT_TIMEOUT_MS,
  resolveBoundedWatchDeadlineMs,
} = require('./boundedWatchWait');
const { resolveUnitLaneTimeout } = require('../../../specs/pipeline/steps/lib/contentionBudget');

// BL-933: this helper's own tests. Never a real fs.watch or a real elapsed
// wait - vi's fake timers drive the deadline race deterministically, same
// as onboarderReconcileCli.test.js's fakeTimers convention.

test('awaitRealWatchEvent resolves with the promise value when it settles before the deadline', async () => {
  const result = await awaitRealWatchEvent(Promise.resolve('the-value'), {
    eventLabel: 'bounce file creation',
    watchedPath: '/tmp/example/bounce',
  });
  assert.equal(result, 'the-value');
});

test('awaitRealWatchEvent propagates the underlying promise rejection when it rejects before the deadline', async () => {
  await assert.rejects(
    awaitRealWatchEvent(Promise.reject(new Error('boom')), {
      eventLabel: 'bounce file creation',
      watchedPath: '/tmp/example/bounce',
    }),
    /boom/
  );
});

test('awaitRealWatchEvent throws synchronously when eventLabel is missing', () => {
  assert.throws(() => awaitRealWatchEvent(new Promise(() => {}), { watchedPath: '/tmp/example/bounce' }), /eventLabel/);
});

test('awaitRealWatchEvent throws synchronously when watchedPath is missing', () => {
  assert.throws(() => awaitRealWatchEvent(new Promise(() => {}), { eventLabel: 'bounce file creation' }), /watchedPath/);
});

test('awaitRealWatchEvent rejects naming the event and path once the deadline expires with no event', async () => {
  vi.useFakeTimers();
  try {
    const neverResolves = new Promise(() => {});
    const pending = awaitRealWatchEvent(neverResolves, {
      eventLabel: 'bounce file creation',
      watchedPath: '/tmp/example/bounce',
      timeoutMs: 1000,
    });
    const assertion = assert.rejects(pending, /bounce file creation.*\/tmp\/example\/bounce.*1000ms/s);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  } finally {
    vi.useRealTimers();
  }
});

test('awaitRealWatchEvent does not reject before its own deadline elapses', async () => {
  vi.useFakeTimers();
  try {
    let capturedResolve;
    const eventuallyResolves = new Promise((resolve) => {
      capturedResolve = resolve;
    });
    const pending = awaitRealWatchEvent(eventuallyResolves, {
      eventLabel: 'bounce file creation',
      watchedPath: '/tmp/example/bounce',
      timeoutMs: 1000,
    });
    let settled = false;
    pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(999);
    assert.equal(settled, false, 'must not settle before the deadline');

    capturedResolve('arrived');
    await pending;
    assert.equal(settled, true);
  } finally {
    vi.useRealTimers();
  }
});

test('BL-1008: quiet-host deadline base stays below the quiet-host lane budget', () => {
  assert.equal(resolveBoundedWatchDeadlineMs({ factor: 1 }), DEFAULT_TIMEOUT_MS);
  assert.ok(DEFAULT_TIMEOUT_MS < 20000);
});

test('BL-1008: deadline stays strictly below the test effective budget at any factor', () => {
  for (const factor of [1, 3, 1000, 'unusable']) {
    const deadline = resolveBoundedWatchDeadlineMs({ factor });
    const testBudget = resolveUnitLaneTimeout(20000, { factor }).effectiveMs;
    assert.ok(deadline < testBudget, `factor=${factor}: ${deadline} < ${testBudget}`);
  }
});

// BL-933 hardening (BL-1008): omitted timeoutMs uses the contention-scaled
// deadline for a pinned quiet factor, still naming event/path in the message.
test('awaitRealWatchEvent, when timeoutMs is omitted, times out at the resolved quiet-host deadline', async () => {
  vi.useFakeTimers();
  try {
    const expected = resolveBoundedWatchDeadlineMs({ factor: 1 });
    const neverResolves = new Promise(() => {});
    const pending = awaitRealWatchEvent(neverResolves, {
      eventLabel: 'bounce file creation',
      watchedPath: '/tmp/example/bounce',
      factor: 1,
    });
    let settled = false;
    let caught = null;
    pending.then(
      () => {
        settled = true;
      },
      (err) => {
        settled = true;
        caught = err;
      }
    );

    await vi.advanceTimersByTimeAsync(expected - 1);
    assert.equal(settled, false, 'must not settle even 1ms before the resolved deadline');

    await vi.advanceTimersByTimeAsync(1);
    assert.equal(settled, true, 'must settle once the resolved deadline has fully elapsed');
    assert.ok(caught, 'expected the omitted-timeoutMs default to reject, not resolve');
    assert.match(caught.message, new RegExp(`${expected}ms`));
  } finally {
    vi.useRealTimers();
  }
});

test('describeWatchWaitTimeout names the event, the path, and the deadline', () => {
  const message = describeWatchWaitTimeout('a bounce-graceful file', '/tmp/example/bounce-graceful', 4000);
  assert.match(message, /a bounce-graceful file/);
  assert.match(message, /\/tmp\/example\/bounce-graceful/);
  assert.match(message, /4000ms/);
});
