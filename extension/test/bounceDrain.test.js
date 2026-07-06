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
} = require('../out/swarm/bounceDrain');

function mkTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bounce-drain-'));
}

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

// ── startBounceDrainWatcher (real short interval) ────────────────────────

test('startBounceDrainWatcher does nothing while no sentinel exists', async () => {
  const target = mkTarget();
  const bounces = [];
  const timer = startBounceDrainWatcher(
    { targetPath: target, pollIntervalSeconds: 0.02 },
    {
      getRoleStatuses: () => [],
      onBounce: (type) => bounces.push(type),
      onTimeout: () => {},
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  stopBounceDrainWatcher(timer);
  assert.deepEqual(bounces, []);
});

test('startBounceDrainWatcher bounces once all roles report drained', async () => {
  const target = mkTarget();
  startBounceDrain(target, 'swarm', 900);
  const bounces = [];
  const timer = startBounceDrainWatcher(
    { targetPath: target, pollIntervalSeconds: 0.02 },
    {
      getRoleStatuses: () => [{ role: 'coder', hasInProcessWork: false, idle: true }],
      onBounce: (type) => bounces.push(type),
      onTimeout: () => {},
    }
  );
  try {
    await waitUntil(() => bounces.length > 0);
    assert.deepEqual(bounces, ['swarm']);
  } finally {
    stopBounceDrainWatcher(timer);
  }
});

test('startBounceDrainWatcher fires onBounce only once per drain session even if the caller does not stop it or clear the sentinel promptly', async () => {
  // In production the caller (extension.ts) stops the watcher and clears the
  // sentinel synchronously inside onBounce, so a real second tick never
  // happens -- but the watcher must not rely solely on that contract, since
  // a slow/misbehaving adapter would otherwise re-trigger the actual bounce
  // (killing/relaunching panes) on every subsequent poll.
  const target = mkTarget();
  startBounceDrain(target, 'swarm', 900);
  const bounces = [];
  const timer = startBounceDrainWatcher(
    { targetPath: target, pollIntervalSeconds: 0.02 },
    {
      getRoleStatuses: () => [{ role: 'coder', hasInProcessWork: false, idle: true }],
      onBounce: (type) => bounces.push(type), // deliberately does not stop the watcher or clear state
      onTimeout: () => {},
    }
  );
  try {
    await waitUntil(() => bounces.length > 0);
    // let several more poll cycles elapse with the sentinel still present
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.deepEqual(bounces, ['swarm'], 'onBounce must fire at most once per drain session');
  } finally {
    stopBounceDrainWatcher(timer);
  }
});

test('startBounceDrainWatcher never bounces while a role still holds in_process work', async () => {
  const target = mkTarget();
  startBounceDrain(target, 'swarm', 900);
  const bounces = [];
  const timer = startBounceDrainWatcher(
    { targetPath: target, pollIntervalSeconds: 0.02 },
    {
      getRoleStatuses: () => [{ role: 'coder', hasInProcessWork: true, idle: false }],
      onBounce: (type) => bounces.push(type),
      onTimeout: () => {},
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 120));
  stopBounceDrainWatcher(timer);
  assert.deepEqual(bounces, []);
});

test('startBounceDrainWatcher prompts on timeout exactly once with the busy role list', async () => {
  const target = mkTarget();
  startBounceDrain(target, 'swarm', 0); // already-elapsed timeout
  const prompts = [];
  const timer = startBounceDrainWatcher(
    { targetPath: target, pollIntervalSeconds: 0.02 },
    {
      getRoleStatuses: () => [{ role: 'coder', hasInProcessWork: true, idle: false }],
      onBounce: () => {},
      onTimeout: (type, busyRoles) => prompts.push({ type, busyRoles }),
    }
  );
  await waitUntil(() => prompts.length > 0);
  await new Promise((resolve) => setTimeout(resolve, 100)); // let a few more sweeps run
  stopBounceDrainWatcher(timer);
  assert.equal(prompts.length, 1, 'the human is prompted once per drain session, not every poll');
  assert.deepEqual(prompts[0], { type: 'swarm', busyRoles: ['coder'] });
});

// ── startGracefulBounceFileWatcher (remote sentinel variant) ─────────────

test('startGracefulBounceFileWatcher returns null when .swarmforge does not exist', () => {
  const target = mkTarget();
  const watcher = startGracefulBounceFileWatcher(target, () => {});
  assert.equal(watcher, null);
});

test('startGracefulBounceFileWatcher detects a bounce-graceful file and deletes it', async () => {
  const target = mkTarget();
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });

  const triggered = [];
  const watcher = startGracefulBounceFileWatcher(target, (type) => triggered.push(type));
  assert.ok(watcher);
  try {
    fs.writeFileSync(path.join(target, '.swarmforge', 'bounce-graceful'), 'swarm\n');
    await waitUntil(() => triggered.length > 0);
    assert.deepEqual(triggered, ['swarm']);
    assert.equal(fs.existsSync(path.join(target, '.swarmforge', 'bounce-graceful')), false);
  } finally {
    watcher.close();
  }
});

test('startGracefulBounceFileWatcher ignores the plain (non-graceful) bounce file', async () => {
  const target = mkTarget();
  fs.mkdirSync(path.join(target, '.swarmforge'), { recursive: true });

  const triggered = [];
  const watcher = startGracefulBounceFileWatcher(target, (type) => triggered.push(type));
  try {
    fs.writeFileSync(path.join(target, '.swarmforge', 'bounce'), 'swarm\n');
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(triggered, []);
  } finally {
    watcher.close();
  }
});
