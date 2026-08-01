const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  parseRedeployCommand,
  redeployScriptPath,
  readRedeployLock,
  startRedeployRun,
  formatRedeployStartMessage,
  formatRedeployFailureMessage,
} = require('../out/tools/telegramCursorBridgeRedeploy');

function mkRoot() {
  const root = mkTmpDir('sf-redeploy-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function lockPathFor(root) {
  return path.join(root, '.swarmforge', 'operator', 'redeploy-bridge.lock');
}

// Mirrors onboarderLauncherPidGuard.property.test.js's own spawnDeadPid: a
// just-exited child's pid is guaranteed reaped/unused by spawnSync's
// synchronous wait - safe to reuse as a "definitely not alive" pid.
function spawnDeadPid() {
  const child = spawnSync('sh', ['-c', 'exit 0']);
  return child.pid;
}

test('parseRedeployCommand accepts /redeploy and /r only', () => {
  assert.equal(parseRedeployCommand('/redeploy'), true);
  assert.equal(parseRedeployCommand('  /REDEPLOY  '), true);
  assert.equal(parseRedeployCommand('/r'), true);
  assert.equal(parseRedeployCommand(' /R '), true);
  assert.equal(parseRedeployCommand('/redeploy now'), false);
  assert.equal(parseRedeployCommand('/r now'), false);
  assert.equal(parseRedeployCommand('/expedite'), false);
});

test('parseRedeployCommand requires the command at the START of the text, not merely present anywhere in it', () => {
  assert.equal(parseRedeployCommand('foo /redeploy'), false);
  assert.equal(parseRedeployCommand('not /r'), false);
});

test('startRedeployRun spawns detached script and writes lock', () => {
  const root = mkRoot();
  const script = redeployScriptPath(root);
  fs.writeFileSync(script, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(script, 0o755);
  const spawnCalls = [];
  const closedFds = [];
  const originalCloseSync = fs.closeSync;
  fs.closeSync = (fd) => {
    closedFds.push(fd);
    return originalCloseSync(fd);
  };
  let result;
  try {
    result = startRedeployRun(root, (...args) => {
      spawnCalls.push(args);
      return { pid: process.pid, unref: () => {} };
    });
  } finally {
    fs.closeSync = originalCloseSync;
  }
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.pid, process.pid);
    // Constructed independently of redeployLogPath so this actually checks
    // every path segment, not just the trailing filename.
    assert.equal(result.logPath, path.join(root, '.swarmforge', 'operator', 'redeploy-cursor-bridge.log'));
    assert.equal(
      formatRedeployStartMessage(result),
      [
        `🔄 Redeploy started (pid ${result.pid}): compile → stop → restart.`,
        'This bridge will restart shortly; send /status once it is back.',
        `Log: ${result.logPath}`,
      ].join('\n')
    );
  }
  // Exact spawn call shape — command, args, and the detached/stdio options
  // that make the redeploy survive this process exiting.
  assert.equal(spawnCalls[0][0], 'bash');
  assert.deepEqual(spawnCalls[0][1], [script, root]);
  assert.equal(spawnCalls[0][2].detached, true);
  assert.equal(spawnCalls[0][2].stdio.length, 3);
  assert.equal(spawnCalls[0][2].stdio[0], 'ignore');
  assert.equal(typeof spawnCalls[0][2].stdio[1], 'number');
  assert.equal(typeof spawnCalls[0][2].stdio[2], 'number');
  // The two log fds opened for spawn's stdio are closed in the `finally`
  // once the child is detached — never left open past this call.
  assert.deepEqual(closedFds, [spawnCalls[0][2].stdio[1], spawnCalls[0][2].stdio[2]]);
  assert.deepEqual(readRedeployLock(root), { pid: process.pid });
});

test('startRedeployRun reports spawn-failed when the child process has no pid', () => {
  const root = mkRoot();
  const script = redeployScriptPath(root);
  fs.writeFileSync(script, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(script, 0o755);
  const result = startRedeployRun(root, () => ({ pid: undefined, unref: () => {} }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'spawn-failed');
    assert.equal(result.detail, 'no pid from spawn');
    assert.equal(formatRedeployFailureMessage(result), 'Could not start redeploy: no pid from spawn');
  }
  // A failed spawn must not write a lock — nothing is actually running.
  assert.equal(readRedeployLock(root), undefined);
});

test('startRedeployRun rejects when script is missing', () => {
  const root = mkRoot();
  const result = startRedeployRun(root);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'missing-script');
    assert.equal(
      formatRedeployFailureMessage(result),
      `Redeploy script not found at ${result.detail}`
    );
  }
});

test('startRedeployRun rejects when another redeploy is running', () => {
  const root = mkRoot();
  const script = redeployScriptPath(root);
  fs.writeFileSync(script, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(script, 0o755);
  const lockPath = path.join(root, '.swarmforge', 'operator', 'redeploy-bridge.lock');
  fs.writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid })}\n`, 'utf8');
  const result = startRedeployRun(root, () => ({ pid: 1, unref: () => {} }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'already-running');
    assert.equal(result.detail, `pid ${process.pid}`);
    assert.equal(
      formatRedeployFailureMessage(result),
      `Redeploy already running (pid ${process.pid}). Wait for it to finish.`
    );
  }
});

test('readRedeployLock clears and reports undefined for a stale lock whose pid is no longer alive', () => {
  const root = mkRoot();
  const deadPid = spawnDeadPid();
  fs.writeFileSync(lockPathFor(root), `${JSON.stringify({ pid: deadPid })}\n`, 'utf8');
  assert.equal(readRedeployLock(root), undefined);
  assert.equal(fs.existsSync(lockPathFor(root)), false);
});

test('readRedeployLock returns undefined for a lock file whose pid field is not a number, leaving the lock file untouched (never unlinked)', () => {
  const root = mkRoot();
  fs.writeFileSync(lockPathFor(root), `${JSON.stringify({ pid: 'not-a-number' })}\n`, 'utf8');
  assert.equal(readRedeployLock(root), undefined);
  // A non-number pid is a malformed lock, not a stale-but-well-formed one —
  // it must be rejected up front, never fall through to the liveness check
  // (which would delete it as a side effect of treating it as dead).
  assert.equal(fs.existsSync(lockPathFor(root)), true);
});

test('readRedeployLock treats a pid it cannot signal (permission denied) as alive, not dead', () => {
  const root = mkRoot();
  // pid 1 always exists and a non-root process cannot signal it (EPERM,
  // not ESRCH) — the reliable, real way to exercise the "can't tell, so
  // assume alive" branch without mocking process.kill.
  fs.writeFileSync(lockPathFor(root), `${JSON.stringify({ pid: 1 })}\n`, 'utf8');
  assert.deepEqual(readRedeployLock(root), { pid: 1 });
  assert.equal(fs.existsSync(lockPathFor(root)), true);
});

test('readRedeployLock returns undefined (never throws) for malformed JSON in the lock file', () => {
  const root = mkRoot();
  fs.writeFileSync(lockPathFor(root), 'not json', 'utf8');
  assert.equal(readRedeployLock(root), undefined);
});
