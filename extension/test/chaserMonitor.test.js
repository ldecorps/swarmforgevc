const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { startChaserMonitor, stopChaserMonitor, readChaseEscalations, syncStuckEscalations } = require('../out/watchdog/chaserMonitor');

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
    maxRecoveryAttempts: 3,
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

// BL-146: chase/nudge sweep decision (runSweep) moved into handoffd.bb - the
// single daemon process that now owns delivery AND liveness. The extension
// host's own interval must never also chase the same inbox item; two
// processes independently chasing would race and double-count against the
// shared .chase.json sidecar (BL-146 single-daemon-04: exactly one process
// owns the sweep).
test('periodic interval never chases a stale handoff - that duty moved to handoffd.bb', () => new Promise((resolve, reject) => {
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
      assert.equal(chasedRole, null);
      fs.rmSync(tmpDir, { recursive: true });
      resolve();
    } catch (err) {
      reject(err);
    }
  }, 200);
}));

test('stopChaserMonitor stops further sweeps', () => new Promise((resolve, reject) => {
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
        resolve();
      } catch (err) {
        reject(err);
      }
    }, 150);
  }, 60);
}));

test('stopChaserMonitor tolerates a null timer', () => {
  assert.doesNotThrow(() => stopChaserMonitor(null));
});

// ── BL-148: bridging the daemon's chase-escalations.json ────────────────────

test('readChaseEscalations returns an empty set when the file is missing', () => {
  const tmpDir = mkTmp();
  assert.deepEqual(readChaseEscalations(path.join(tmpDir, '.swarmforge', 'daemon')), new Set());
});

test('readChaseEscalations returns an empty set for malformed JSON', () => {
  const tmpDir = mkTmp();
  const daemonDir = path.join(tmpDir, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(path.join(daemonDir, 'chase-escalations.json'), 'not json');
  assert.deepEqual(readChaseEscalations(daemonDir), new Set());
});

test('readChaseEscalations reads the roles the daemon marked escalated, matching chase_sweep_lib.bb write-escalation! shape', () => {
  const tmpDir = mkTmp();
  const daemonDir = path.join(tmpDir, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(path.join(daemonDir, 'chase-escalations.json'), JSON.stringify({ coder: true, cleaner: true }));
  assert.deepEqual(readChaseEscalations(daemonDir), new Set(['coder', 'cleaner']));
});

test('readChaseEscalations excludes roles the daemon cleared back to false', () => {
  const tmpDir = mkTmp();
  const daemonDir = path.join(tmpDir, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  // write-escalation! actually dissoc's a cleared role rather than writing
  // false, but tolerate an explicit false too, matching decideRecoveryAction's
  // own defensive style.
  fs.writeFileSync(path.join(daemonDir, 'chase-escalations.json'), JSON.stringify({ coder: true, cleaner: false }));
  assert.deepEqual(readChaseEscalations(daemonDir), new Set(['coder']));
});

test('syncStuckEscalations(BL-148 wedge-alert-01): a role the daemon marked escalated fires onStuckEscalation(role, true)', () => {
  const tmpDir = mkTmp();
  const daemonDir = path.join(tmpDir, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(path.join(daemonDir, 'chase-escalations.json'), JSON.stringify({ coder: true }));

  const calls = [];
  syncStuckEscalations(tmpDir, ['coder', 'cleaner'], (role, escalated) => calls.push({ role, escalated }));

  assert.deepEqual(calls, [
    { role: 'coder', escalated: true },
    { role: 'cleaner', escalated: false },
  ]);
});

test('syncStuckEscalations(BL-148 wedge-alert-03): a role no longer in the daemon file clears its escalation', () => {
  const tmpDir = mkTmp();
  const daemonDir = path.join(tmpDir, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  // The role was previously escalated but the daemon's own dissoc removed it
  // (self-recovered before the wedged threshold, or was redelivered).
  fs.writeFileSync(path.join(daemonDir, 'chase-escalations.json'), JSON.stringify({}));

  const calls = [];
  syncStuckEscalations(tmpDir, ['coder'], (role, escalated) => calls.push({ role, escalated }));

  assert.deepEqual(calls, [{ role: 'coder', escalated: false }]);
});

test('syncStuckEscalations with no daemon dir at all clears every role (never crashes)', () => {
  const tmpDir = mkTmp();
  const calls = [];
  assert.doesNotThrow(() => syncStuckEscalations(tmpDir, ['coder', 'cleaner'], (role, escalated) => calls.push({ role, escalated })));
  assert.deepEqual(calls, [
    { role: 'coder', escalated: false },
    { role: 'cleaner', escalated: false },
  ]);
});

// BL-148 wedge-alert-01/02: the interval itself (not just the pure sync
// function) reaches onStuckEscalation for a daemon-marked wedge - proves the
// wiring is live on chaserMonitor's own panel-independent timer, not merely
// callable in isolation.
test('BL-148: startChaserMonitor\'s own interval calls onStuckEscalation for a daemon-marked wedge', () => new Promise((resolve, reject) => {
  const tmpDir = mkTmp();
  writeRolesTsv(tmpDir, 'coder', tmpDir);
  const daemonDir = path.join(tmpDir, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(path.join(daemonDir, 'chase-escalations.json'), JSON.stringify({ coder: true }));

  const escalations = [];
  const timer = startChaserMonitor(
    baseConfig(tmpDir),
    noopCallbacks({
      onStuckEscalation: (role, escalated) => escalations.push({ role, escalated }),
    })
  );

  setTimeout(() => {
    stopChaserMonitor(timer);
    try {
      assert.ok(
        escalations.some((e) => e.role === 'coder' && e.escalated === true),
        `expected an escalated=true call for coder; got: ${JSON.stringify(escalations)}`
      );
      fs.rmSync(tmpDir, { recursive: true });
      resolve();
    } catch (err) {
      reject(err);
    }
  }, 200);
}));
