const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { startChaserMonitor, stopChaserMonitor } = require('../out/watchdog/chaserMonitor');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-chaser-monitor-'));
}

// Handoff inboxes are resolved from roles.tsv (per-worktree layout), not a
// <target>/.swarmforge/handoffs/<role>/ shape (BL-067 root cause 2).
function writeRolesTsv(targetPath, role, worktreePath) {
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(targetPath, '.swarmforge', 'roles.tsv'),
    `${role}\tbranch\t${worktreePath}\tswarmforge-${role}\t${role}\tclaude\ttask\n`
  );
}

function inboxNewDir(worktreePath) {
  return path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', 'new');
}

function baseConfig(targetPath, overrides = {}) {
  return {
    targetPath,
    rolesList: ['coder'],
    chaseIntervalSeconds: 0.05,
    chaseTimeoutSeconds: 0,
    maxChases: 3,
    stuckInProcessTimeoutSeconds: 60,
    respawnCooldownSeconds: 300,
    ...overrides,
  };
}

function noopCallbacks(overrides = {}) {
  return {
    getLiveness: () => 'alive',
    sendWakeUp: () => {},
    triggerRespawn: () => {},
    logDeadLetter: () => {},
    getLastActivityMs: () => Date.now(),
    onStuckEscalation: () => {},
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
  writeRolesTsv(tmpDir, 'coder', tmpDir);
  const newDir = inboxNewDir(tmpDir);
  fs.mkdirSync(newDir, { recursive: true });
  fs.writeFileSync(path.join(newDir, '00_test.handoff'), 'test\n');

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
    stopChaserMonitor(timer);
    try {
      assert.equal(chasedRole, 'coder');
      fs.rmSync(tmpDir, { recursive: true });
      done();
    } catch (err) {
      done(err);
    }
  }, 200);
});

test('stopChaserMonitor stops further sweeps', (t, done) => {
  const tmpDir = mkTmp();
  writeRolesTsv(tmpDir, 'coder', tmpDir);
  const newDir = inboxNewDir(tmpDir);
  fs.mkdirSync(newDir, { recursive: true });
  fs.writeFileSync(path.join(newDir, '00_test.handoff'), 'test\n');

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
      try {
        assert.equal(sweepCount, countAtStop);
        fs.rmSync(tmpDir, { recursive: true });
        done();
      } catch (err) {
        done(err);
      }
    }, 150);
  }, 60);
});

test('stopChaserMonitor tolerates a null timer', () => {
  assert.doesNotThrow(() => stopChaserMonitor(null));
});
