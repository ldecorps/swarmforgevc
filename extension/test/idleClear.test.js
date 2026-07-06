const assert = require('node:assert/strict');
const {
  decideIdleClear,
  IdleClearTracker,
  startIdleClearMonitor,
  stopIdleClearMonitor,
} = require('../out/swarm/idleClear');

const NOW = Date.parse('2026-07-02T12:00:00Z');
const CONFIG = { enabled: true, settleWindowSeconds: 120, fullnessThresholdPercent: 75 };
const FULL = { percent: 100, source: 'telemetry' };

function idleStatus(overrides = {}) {
  return {
    role: 'coder',
    hasInProcessWork: false,
    hasQueuedNew: false,
    needsHumanPending: false,
    drainInProgress: false,
    lastHumanInputMs: null,
    lastActivityMs: NOW - 121_000, // just past the settle window
    contextFullness: FULL,
    ...overrides,
  };
}

// ── decideIdleClear (pure) — BL-076 idle-clear-01/02 ────────────────────

test('a drained-idle role past the settle window is cleared', () => {
  assert.equal(decideIdleClear(idleStatus(), false, NOW, CONFIG), 'clear');
});

test('a role still within the settle window is not cleared', () => {
  const status = idleStatus({ lastActivityMs: NOW - 60_000 });
  assert.equal(decideIdleClear(status, false, NOW, CONFIG), 'skip');
});

test('an already-cleared role is not cleared again', () => {
  assert.equal(decideIdleClear(idleStatus(), true, NOW, CONFIG), 'skip');
});

test('disabling the feature skips every role', () => {
  const config = { ...CONFIG, enabled: false };
  assert.equal(decideIdleClear(idleStatus(), false, NOW, config), 'skip');
});

// unsafe-state table (BL-076 idle-clear-02)
const unsafeStates = [
  ['holding an in_process task', { hasInProcessWork: true }],
  ['holding an in_process batch', { hasInProcessWork: true }],
  ['inbox/new contains a queued handoff', { hasQueuedNew: true }],
  ['needs-human state pending on its tile', { needsHumanPending: true }],
  ['human typed into the pane inside the window', { lastHumanInputMs: NOW - 10_000 }],
  ['a graceful bounce drain is in progress', { drainInProgress: true }],
  // BL-141 context-clear-75-01: below the fullness threshold blocks a clear
  // just like any other unsafe state, even though every other gate passes.
  ['context fullness below the threshold', { contextFullness: { percent: 74, source: 'telemetry' } }],
];

for (const [label, overrides] of unsafeStates) {
  test(`unsafe state never cleared: ${label}`, () => {
    const status = idleStatus(overrides);
    assert.equal(decideIdleClear(status, false, NOW, CONFIG), 'skip');
  });
}

// ── BL-141: fullness gate ────────────────────────────────────────────────

test('drained-idle but below the fullness threshold does not clear (context-clear-75-01)', () => {
  const status = idleStatus({ contextFullness: { percent: 50, source: 'telemetry' } });
  assert.equal(decideIdleClear(status, false, NOW, CONFIG), 'skip');
});

test('drained-idle and at or above the fullness threshold clears (context-clear-75-02)', () => {
  const status = idleStatus({ contextFullness: { percent: 75, source: 'telemetry' } });
  assert.equal(decideIdleClear(status, false, NOW, CONFIG), 'clear');
});

test('proxy-sourced fullness at or above the threshold clears the same as telemetry (context-clear-75-03)', () => {
  const status = idleStatus({ contextFullness: { percent: 90, source: 'proxy' } });
  assert.equal(decideIdleClear(status, false, NOW, CONFIG), 'clear');
});

test('human input within the settle window blocks a clear even at 100% fullness (context-clear-75-04)', () => {
  const status = idleStatus({
    contextFullness: { percent: 100, source: 'telemetry' },
    lastHumanInputMs: NOW - 10_000,
  });
  assert.equal(decideIdleClear(status, false, NOW, CONFIG), 'skip');
});

test('a human keystroke that already predates the settle window no longer blocks a clear', () => {
  const status = idleStatus({ lastHumanInputMs: NOW - 121_000 });
  assert.equal(decideIdleClear(status, false, NOW, CONFIG), 'clear');
});

// ── IdleClearTracker — BL-076 idle-clear-01/03 (clear once, re-arm) ─────

test('IdleClearTracker clears an idle role exactly once', () => {
  const tracker = new IdleClearTracker();
  assert.equal(tracker.evaluate(idleStatus(), NOW, CONFIG), 'clear');
  assert.equal(tracker.evaluate(idleStatus(), NOW + 1000, CONFIG), 'skip', 'must not clear again while still idle');
  assert.equal(tracker.evaluate(idleStatus(), NOW + 300_000, CONFIG), 'skip', 'still must not re-clear, however long it stays idle');
});

test('IdleClearTracker re-arms once the role holds in_process work again, then clears once more after the next idle settle', () => {
  const tracker = new IdleClearTracker();
  assert.equal(tracker.evaluate(idleStatus(), NOW, CONFIG), 'clear');

  // the role picks up a new task
  const busy = idleStatus({ hasInProcessWork: true, lastActivityMs: NOW });
  assert.equal(tracker.evaluate(busy, NOW + 1000, CONFIG), 'skip');

  // it finishes and goes idle again; nothing clears until the settle window passes
  const idleAgain = idleStatus({ lastActivityMs: NOW + 1000 });
  assert.equal(tracker.evaluate(idleAgain, NOW + 1000 + 60_000, CONFIG), 'skip', 'inside the new settle window');
  assert.equal(
    tracker.evaluate(idleAgain, NOW + 1000 + 121_000, CONFIG),
    'clear',
    'cleared once more after the settle window elapses on the new idle period'
  );
});

// BL-076 idle-clear-04 is a protocol-level guarantee (every handoff body
// already says "re-read your role and constitution" regardless of context
// state — see handoff-protocol.md), not new host behavior to unit test here.

// ── startIdleClearMonitor / stopIdleClearMonitor (real short interval) ──

function waitUntil(predicate, timeoutMs = 2000, intervalMs = 10) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('waitUntil timed out'));
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

test('startIdleClearMonitor sends a clear for a drained-idle role and logs it', async () => {
  const cleared = [];
  const logs = [];
  const timer = startIdleClearMonitor(
    { enabled: true, settleWindowSeconds: 0, fullnessThresholdPercent: 75, pollIntervalSeconds: 0.02 },
    {
      getRoleStatuses: () => [
        {
          role: 'coder',
          hasInProcessWork: false,
          hasQueuedNew: false,
          needsHumanPending: false,
          drainInProgress: false,
          lastHumanInputMs: null,
          lastActivityMs: Date.now() - 1000,
          contextFullness: { percent: 100, source: 'telemetry' },
        },
      ],
      sendClear: (role) => cleared.push(role),
      log: (message) => logs.push(message),
    }
  );
  try {
    await waitUntil(() => cleared.length > 0);
    assert.deepEqual(cleared, ['coder']);
    assert.match(logs[0], /coder/);
  } finally {
    stopIdleClearMonitor(timer);
  }
});

// BL-141 context-clear-75-03: the log line must say when the decision used
// the proxy metric, not exact telemetry.
test('startIdleClearMonitor logs that proxy mode was used when the fullness came from the proxy', async () => {
  const cleared = [];
  const logs = [];
  const timer = startIdleClearMonitor(
    { enabled: true, settleWindowSeconds: 0, fullnessThresholdPercent: 75, pollIntervalSeconds: 0.02 },
    {
      getRoleStatuses: () => [
        {
          role: 'coder',
          hasInProcessWork: false,
          hasQueuedNew: false,
          needsHumanPending: false,
          drainInProgress: false,
          lastHumanInputMs: null,
          lastActivityMs: Date.now() - 1000,
          contextFullness: { percent: 80, source: 'proxy' },
        },
      ],
      sendClear: (role) => cleared.push(role),
      log: (message) => logs.push(message),
    }
  );
  try {
    await waitUntil(() => cleared.length > 0);
    assert.match(logs[0], /proxy/i);
  } finally {
    stopIdleClearMonitor(timer);
  }
});

test('startIdleClearMonitor never clears a role whose fullness stays below the threshold', async () => {
  const cleared = [];
  const timer = startIdleClearMonitor(
    { enabled: true, settleWindowSeconds: 0, fullnessThresholdPercent: 75, pollIntervalSeconds: 0.02 },
    {
      getRoleStatuses: () => [
        {
          role: 'coder',
          hasInProcessWork: false,
          hasQueuedNew: false,
          needsHumanPending: false,
          drainInProgress: false,
          lastHumanInputMs: null,
          lastActivityMs: Date.now() - 1000,
          contextFullness: { percent: 10, source: 'telemetry' },
        },
      ],
      sendClear: (role) => cleared.push(role),
      log: () => {},
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 120));
  stopIdleClearMonitor(timer);
  assert.deepEqual(cleared, []);
});

test('startIdleClearMonitor never sends a clear for a role holding in_process work', async () => {
  const cleared = [];
  const timer = startIdleClearMonitor(
    { enabled: true, settleWindowSeconds: 0, fullnessThresholdPercent: 75, pollIntervalSeconds: 0.02 },
    {
      getRoleStatuses: () => [
        {
          role: 'coder',
          hasInProcessWork: true,
          hasQueuedNew: false,
          needsHumanPending: false,
          drainInProgress: false,
          lastHumanInputMs: null,
          lastActivityMs: Date.now() - 1000,
          contextFullness: { percent: 100, source: 'telemetry' },
        },
      ],
      sendClear: (role) => cleared.push(role),
      log: () => {},
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 120));
  stopIdleClearMonitor(timer);
  assert.deepEqual(cleared, []);
});

test('startIdleClearMonitor disabled sends no clears even past many settle windows', async () => {
  const cleared = [];
  const timer = startIdleClearMonitor(
    { enabled: false, settleWindowSeconds: 0, fullnessThresholdPercent: 75, pollIntervalSeconds: 0.02 },
    {
      getRoleStatuses: () => [
        {
          role: 'coder',
          hasInProcessWork: false,
          hasQueuedNew: false,
          needsHumanPending: false,
          drainInProgress: false,
          lastHumanInputMs: null,
          lastActivityMs: Date.now() - 1000,
          contextFullness: { percent: 100, source: 'telemetry' },
        },
      ],
      sendClear: (role) => cleared.push(role),
      log: () => {},
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  stopIdleClearMonitor(timer);
  assert.deepEqual(cleared, []);
});
