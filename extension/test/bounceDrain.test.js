const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  drainSentinelPath,
  readBounceDrainState,
  writeBounceDrainState,
  clearBounceDrainState,
  startBounceDrain,
  decideDrainAction,
  startBounceDrainWatcher,
  stopBounceDrainWatcher,
  startGracefulBounceFileWatcher,
  handleGracefulWatchEvent,
} = require('../out/swarm/bounceDrain');

function mkTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bounce-drain-'));
}

// BL-131: captures the interval callback instead of scheduling it for real -
// fire() simulates one poll tick synchronously, with getNowMs also injected
// so "past the timeout window" needs no real elapsed wall-clock time either
// (same pattern as idleClear.test.js's fakeMonitorClock).
function fakeMonitorClock(startMs) {
  let tick = null;
  let nowMs = startMs;
  return {
    scheduleTick: (fn) => {
      tick = fn;
      return {};
    },
    clearTick: () => {
      tick = null;
    },
    getNowMs: () => nowMs,
    fire: () => {
      if (tick) {
        tick();
      }
    },
    advance: (ms) => {
      nowMs += ms;
    },
  };
}

// BL-131: captures the debounce callback instead of scheduling it for real -
// fire() simulates the 50ms settle delay elapsing synchronously (same
// pattern as bounceWatcher.test.js's fakeScheduler).
function fakeScheduler() {
  let tick = null;
  return {
    scheduleTick: (fn) => {
      tick = fn;
    },
    fire: () => {
      if (tick) {
        tick();
      }
    },
  };
}

// ── sentinel read/write/clear ────────────────────────────────────────────

test('readBounceDrainState returns null when no sentinel exists', () => {
  const target = mkTarget();
  assert.equal(readBounceDrainState(target), null);
});

test('writeBounceDrainState then readBounceDrainState round-trips', () => {
  const target = mkTarget();
  writeBounceDrainState(target, { bounceType: 'swarm', startedAt: '2026-07-02T09:00:00Z', timeoutSeconds: 900 });
  assert.deepEqual(readBounceDrainState(target), {
    bounceType: 'swarm',
    startedAt: '2026-07-02T09:00:00Z',
    timeoutSeconds: 900,
  });
});

test('writeBounceDrainState creates .swarmforge if missing and leaves no temp file behind', () => {
  const target = mkTarget();
  startBounceDrain(target, 'all', 600, '2026-07-02T09:00:00Z');
  const entries = fs.readdirSync(path.join(target, '.swarmforge'));
  assert.deepEqual(entries, ['bounce-drain.json']);
});

test('readBounceDrainState returns null for malformed JSON', () => {
  const target = mkTarget();
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  fs.writeFileSync(drainSentinelPath(target), 'not json');
  assert.equal(readBounceDrainState(target), null);
});

test('readBounceDrainState returns null for a sentinel missing required fields', () => {
  const target = mkTarget();
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });
  fs.writeFileSync(drainSentinelPath(target), JSON.stringify({ bounceType: 'swarm' }));
  assert.equal(readBounceDrainState(target), null);
});

test('clearBounceDrainState removes the sentinel and tolerates it already being absent', () => {
  const target = mkTarget();
  startBounceDrain(target, 'swarm', 900);
  clearBounceDrainState(target);
  assert.equal(readBounceDrainState(target), null);
  assert.doesNotThrow(() => clearBounceDrainState(target));
});

// ── decideDrainAction (pure) — BL-069 graceful-bounce-02/03/06 ──────────

const NOW = Date.parse('2026-07-02T10:00:00Z');

test('decideDrainAction waits while any role holds a single in_process task file', () => {
  const roles = [
    { role: 'coder', hasInProcessWork: true, idle: false },
    { role: 'cleaner', hasInProcessWork: false, idle: true },
  ];
  assert.equal(decideDrainAction(roles, NOW - 10_000, NOW, 900), 'wait');
});

test('decideDrainAction waits while any role holds a batch directory', () => {
  const roles = [
    { role: 'hardender', hasInProcessWork: true, idle: false },
  ];
  assert.equal(decideDrainAction(roles, NOW - 10_000, NOW, 900), 'wait');
});

test('decideDrainAction bounces once every role has no in_process work and an idle pane', () => {
  const roles = [
    { role: 'coder', hasInProcessWork: false, idle: true },
    { role: 'cleaner', hasInProcessWork: false, idle: true },
  ];
  assert.equal(decideDrainAction(roles, NOW - 10_000, NOW, 900), 'bounce');
});

test('decideDrainAction treats a role with no in_process work but a busy pane as not yet drained', () => {
  const roles = [{ role: 'coder', hasInProcessWork: false, idle: false }];
  assert.equal(decideDrainAction(roles, NOW - 10_000, NOW, 900), 'wait');
});

test('decideDrainAction returns timeout once the configured window elapses without all-idle', () => {
  const roles = [{ role: 'coder', hasInProcessWork: true, idle: false }];
  assert.equal(decideDrainAction(roles, NOW - 901_000, NOW, 900), 'timeout');
});

test('decideDrainAction does not time out before the window elapses', () => {
  const roles = [{ role: 'coder', hasInProcessWork: true, idle: false }];
  assert.equal(decideDrainAction(roles, NOW - 899_000, NOW, 900), 'wait');
});

test('decideDrainAction with zero roles bounces immediately', () => {
  assert.equal(decideDrainAction([], NOW - 1000, NOW, 900), 'bounce');
});

// ── startBounceDrainWatcher ───────────────────────────────────────────────

test('startBounceDrainWatcher does nothing while no sentinel exists', () => {
  const target = mkTarget();
  const bounces = [];
  const clock = fakeMonitorClock(Date.now());
  const timer = startBounceDrainWatcher(
    { targetPath: target, pollIntervalSeconds: 0.02 },
    {
      getRoleStatuses: () => [],
      onBounce: (type) => bounces.push(type),
      onTimeout: () => {},
    },
    clock.scheduleTick,
    clock.getNowMs
  );
  clock.fire();
  stopBounceDrainWatcher(timer, clock.clearTick);
  assert.deepEqual(bounces, []);
});

test('startBounceDrainWatcher bounces once all roles report drained', () => {
  const target = mkTarget();
  startBounceDrain(target, 'swarm', 900);
  const bounces = [];
  const clock = fakeMonitorClock(Date.now());
  const timer = startBounceDrainWatcher(
    { targetPath: target, pollIntervalSeconds: 0.02 },
    {
      getRoleStatuses: () => [{ role: 'coder', hasInProcessWork: false, idle: true }],
      onBounce: (type) => bounces.push(type),
      onTimeout: () => {},
    },
    clock.scheduleTick,
    clock.getNowMs
  );
  clock.fire();
  stopBounceDrainWatcher(timer, clock.clearTick);
  assert.deepEqual(bounces, ['swarm']);
});

test('startBounceDrainWatcher fires onBounce only once per drain session even if the caller does not stop it or clear the sentinel promptly', () => {
  // In production the caller (extension.ts) stops the watcher and clears the
  // sentinel synchronously inside onBounce, so a real second tick never
  // happens -- but the watcher must not rely solely on that contract, since
  // a slow/misbehaving adapter would otherwise re-trigger the actual bounce
  // (killing/relaunching panes) on every subsequent poll.
  const target = mkTarget();
  startBounceDrain(target, 'swarm', 900);
  const bounces = [];
  const clock = fakeMonitorClock(Date.now());
  const timer = startBounceDrainWatcher(
    { targetPath: target, pollIntervalSeconds: 0.02 },
    {
      getRoleStatuses: () => [{ role: 'coder', hasInProcessWork: false, idle: true }],
      onBounce: (type) => bounces.push(type), // deliberately does not stop the watcher or clear state
      onTimeout: () => {},
    },
    clock.scheduleTick,
    clock.getNowMs
  );
  clock.fire();
  // several more poll cycles with the sentinel still present
  clock.fire();
  clock.fire();
  stopBounceDrainWatcher(timer, clock.clearTick);
  assert.deepEqual(bounces, ['swarm'], 'onBounce must fire at most once per drain session');
});

test('startBounceDrainWatcher never bounces while a role still holds in_process work', () => {
  const target = mkTarget();
  startBounceDrain(target, 'swarm', 900);
  const bounces = [];
  const clock = fakeMonitorClock(Date.now());
  const timer = startBounceDrainWatcher(
    { targetPath: target, pollIntervalSeconds: 0.02 },
    {
      getRoleStatuses: () => [{ role: 'coder', hasInProcessWork: true, idle: false }],
      onBounce: (type) => bounces.push(type),
      onTimeout: () => {},
    },
    clock.scheduleTick,
    clock.getNowMs
  );
  clock.fire();
  stopBounceDrainWatcher(timer, clock.clearTick);
  assert.deepEqual(bounces, []);
});

test('startBounceDrainWatcher prompts on timeout exactly once with the busy role list', () => {
  const target = mkTarget();
  startBounceDrain(target, 'swarm', 0); // already-elapsed timeout
  const prompts = [];
  const clock = fakeMonitorClock(Date.now());
  const timer = startBounceDrainWatcher(
    { targetPath: target, pollIntervalSeconds: 0.02 },
    {
      getRoleStatuses: () => [{ role: 'coder', hasInProcessWork: true, idle: false }],
      onBounce: () => {},
      onTimeout: (type, busyRoles) => prompts.push({ type, busyRoles }),
    },
    clock.scheduleTick,
    clock.getNowMs
  );
  clock.fire();
  clock.fire(); // a few more sweeps
  clock.fire();
  stopBounceDrainWatcher(timer, clock.clearTick);
  assert.equal(prompts.length, 1, 'the human is prompted once per drain session, not every poll');
  assert.deepEqual(prompts[0], { type: 'swarm', busyRoles: ['coder'] });
});

// ── startGracefulBounceFileWatcher (remote sentinel variant) ─────────────

test('startGracefulBounceFileWatcher returns null when .swarmforge does not exist', () => {
  const target = mkTarget();
  const watcher = startGracefulBounceFileWatcher(target, () => {});
  assert.equal(watcher, null);
});

// BL-131: fs.watch's own event delivery is the only genuinely OS-async part
// here - awaits a promise that an injected scheduleTick resolves the instant
// the real watch event arrives (event-driven, not a real-clock wait), then
// fires the debounce synchronously.
test('startGracefulBounceFileWatcher detects a bounce-graceful file and deletes it', async () => {
  const target = mkTarget();
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });

  const triggered = [];
  let capturedTick = null;
  let resolveCaptured;
  const captured = new Promise((resolve) => {
    resolveCaptured = resolve;
  });
  const scheduleTick = (fn) => {
    capturedTick = fn;
    resolveCaptured();
  };
  const watcher = startGracefulBounceFileWatcher(target, (type) => triggered.push(type), undefined, scheduleTick);
  assert.ok(watcher);
  try {
    fs.writeFileSync(path.join(target, '.swarmforge', 'bounce-graceful'), 'swarm\n');
    await captured;
    capturedTick();
    assert.deepEqual(triggered, ['swarm']);
    assert.equal(fs.existsSync(path.join(target, '.swarmforge', 'bounce-graceful')), false);
  } finally {
    watcher.close();
  }
});

// BL-131: no real fs.watch event needed - the guard that ignores the
// non-graceful filename is exercised directly, synchronously.
test('handleGracefulWatchEvent ignores the plain (non-graceful) bounce file', () => {
  const triggered = [];
  const { scheduleTick, fire } = fakeScheduler();
  handleGracefulWatchEvent('bounce', '/irrelevant/bounce-graceful', (type) => triggered.push(type), undefined, scheduleTick);
  fire();
  assert.deepEqual(triggered, []);
});
