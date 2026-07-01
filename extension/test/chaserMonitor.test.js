const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { startChaserMonitor, stopChaserMonitor } = require('../out/watchdog/chaserMonitor');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-chaser-monitor-'));
}

function baseConfig(targetPath, overrides = {}) {
  return {
    targetPath,
    rolesList: ['coder'],
    chaseIntervalSeconds: 0.05,
    chaseTimeoutSeconds: 0,
    maxChases: 3,
    stuckInProcessTimeoutSeconds: 60,
    ...overrides,
  };
}

function noopCallbacks(overrides = {}) {
  return {
    getLiveness: () => 'alive',
    sendWakeUp: () => {},
    triggerRespawn: () => {},
    logDeadLetter: () => {},
    ...overrides,
  };
}

test('startChaserMonitor returns null when .swarmforge does not exist', () => {
  const tmpDir = mkTmp();
  const timer = startChaserMonitor(baseConfig(tmpDir), noopCallbacks());
  assert.equal(timer, null);
  fs.rmSync(tmpDir, { recursive: true });
});

test('startChaserMonitor returns a timer when .swarmforge exists', () => {
  const tmpDir = mkTmp();
  fs.mkdirSync(path.join(tmpDir, '.swarmforge'));
  const timer = startChaserMonitor(baseConfig(tmpDir), noopCallbacks());
  assert.ok(timer !== null);
  stopChaserMonitor(timer);
  fs.rmSync(tmpDir, { recursive: true });
});

test('periodic sweep chases a stale handoff and reports via callback', (t, done) => {
  const tmpDir = mkTmp();
  const swarmforgeDir = path.join(tmpDir, '.swarmforge');
  const inboxNewDir = path.join(swarmforgeDir, 'handoffs', 'coder', 'inbox', 'new');
  fs.mkdirSync(inboxNewDir, { recursive: true });
  fs.writeFileSync(path.join(inboxNewDir, '00_test.handoff'), 'test\n');

  let chasedRole = null;
  const timer = startChaserMonitor(
    baseConfig(tmpDir),
    noopCallbacks({
      sendWakeUp: (role) => {
        chasedRole = role;
      },
    })
  );

  setTimeout(() => {
    assert.equal(chasedRole, 'coder');
    stopChaserMonitor(timer);
    fs.rmSync(tmpDir, { recursive: true });
    done();
  }, 200);
});

test('stopChaserMonitor stops further sweeps', (t, done) => {
  const tmpDir = mkTmp();
  const swarmforgeDir = path.join(tmpDir, '.swarmforge');
  const inboxNewDir = path.join(swarmforgeDir, 'handoffs', 'coder', 'inbox', 'new');
  fs.mkdirSync(inboxNewDir, { recursive: true });
  fs.writeFileSync(path.join(inboxNewDir, '00_test.handoff'), 'test\n');

  let sweepCount = 0;
  const timer = startChaserMonitor(
    baseConfig(tmpDir),
    noopCallbacks({
      sendWakeUp: () => {
        sweepCount += 1;
      },
    })
  );

  setTimeout(() => {
    stopChaserMonitor(timer);
    const countAtStop = sweepCount;
    setTimeout(() => {
      assert.equal(sweepCount, countAtStop);
      fs.rmSync(tmpDir, { recursive: true });
      done();
    }, 150);
  }, 60);
});

test('stopChaserMonitor tolerates a null timer', () => {
  assert.doesNotThrow(() => stopChaserMonitor(null));
});
