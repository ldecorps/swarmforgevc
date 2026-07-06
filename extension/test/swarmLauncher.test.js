const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  isSwarmReady,
  buildLaunchEnv,
  launchSwarm,
  waitForSwarmReady,
  chooseReattachTimeoutMs,
} = require('../out/swarm/swarmLauncher');
const { installFakeTmux } = require('./helpers/fakeTmux');
const { installExecutable } = require('./helpers/sharedBin');
const { readTrackedJobs } = require('../out/swarm/childJobRegistry');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-launch-'));
}

function writeReadyState(targetPath, roleLines = '1\tcoder\tswarmforge-coder\tCoder\tclaude\n') {
  const stateDir = path.join(targetPath, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), path.join(targetPath, 'fake.sock'));
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), roleLines);
}

function writeSwarmScript(targetPath, body) {
  return installExecutable(path.join(targetPath, 'swarm'), `#!/bin/sh\n${body}\n`);
}

test('isSwarmReady returns false when tmux server is not running', () => {
  const targetPath = mkTmp();
  const stateDir = path.join(targetPath, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/nonexistent-swarmforge.sock');
  fs.writeFileSync(
    path.join(stateDir, 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n'
  );

  assert.equal(isSwarmReady(targetPath), false);
});

test('isSwarmReady returns false when socket file is missing', () => {
  const targetPath = mkTmp();
  assert.equal(isSwarmReady(targetPath), false);
});

test('buildLaunchEnv sets SWARM_RUN_NAME when runName provided', () => {
  const env = buildLaunchEnv('fix-auth-bug');
  assert.equal(env['SWARM_RUN_NAME'], 'swarm/fix-auth-bug');
  assert.equal(env['SWARMFORGE_TERMINAL'], 'none');
});

// --- PATH augmentation: GUI-launched VS Code lacks Homebrew paths where
//     tmux/bb/claude live, so the swarm launch fails. buildLaunchEnv must
//     ensure those dirs are on PATH. ---

const { augmentPath } = require('../out/swarm/swarmLauncher');

test('augmentPath prepends Homebrew and /usr/local/bin when missing', () => {
  const result = augmentPath('/usr/bin:/bin');
  const parts = result.split(':');
  assert(parts.includes('/opt/homebrew/bin'), 'missing /opt/homebrew/bin');
  assert(parts.includes('/usr/local/bin'), 'missing /usr/local/bin');
  assert(parts.includes('/usr/bin'), 'must preserve original PATH entries');
  // Tool dirs take precedence (come before the inherited PATH).
  assert(parts.indexOf('/opt/homebrew/bin') < parts.indexOf('/usr/bin'));
});

test('augmentPath does not duplicate an already-present tool dir', () => {
  const result = augmentPath('/opt/homebrew/bin:/usr/bin');
  const occurrences = result.split(':').filter((p) => p === '/opt/homebrew/bin');
  assert.equal(occurrences.length, 1);
});

test('augmentPath handles undefined PATH', () => {
  const result = augmentPath(undefined);
  const parts = result.split(':');
  assert(parts.includes('/opt/homebrew/bin'));
  assert(parts.includes('/usr/local/bin'));
});

test('buildLaunchEnv PATH includes Homebrew bin so tmux/bb/claude resolve', () => {
  const env = buildLaunchEnv();
  assert(env['PATH'].split(':').includes('/opt/homebrew/bin'));
  assert(env['PATH'].split(':').includes('/usr/local/bin'));
});

test('buildLaunchEnv omits SWARM_RUN_NAME when runName is empty string', () => {
  const env = buildLaunchEnv('');
  assert.equal(env['SWARM_RUN_NAME'], undefined);
});

test('buildLaunchEnv omits SWARM_RUN_NAME when runName is undefined', () => {
  const env = buildLaunchEnv();
  assert.equal(env['SWARM_RUN_NAME'], undefined);
  assert.equal(env['SWARMFORGE_TERMINAL'], 'none');
});

test('buildLaunchEnv deletes inherited SWARM_RUN_NAME when runName is undefined', () => {
  const savedValue = process.env.SWARM_RUN_NAME;
  process.env.SWARM_RUN_NAME = 'inherited-value';
  try {
    const env = buildLaunchEnv();
    assert.equal(env['SWARM_RUN_NAME'], undefined);
    assert(!env.hasOwnProperty('SWARM_RUN_NAME'), 'SWARM_RUN_NAME should be deleted, not just undefined');
  } finally {
    if (savedValue) {
      process.env.SWARM_RUN_NAME = savedValue;
    } else {
      delete process.env.SWARM_RUN_NAME;
    }
  }
});

test('launchSwarm fails fast when no ./swarm wrapper exists', async () => {
  const targetPath = mkTmp();
  const result = await launchSwarm(targetPath);
  assert.equal(result.success, false);
  assert.match(result.message, /No .\/swarm wrapper found/);
  assert.equal(result.targetPath, targetPath);
});

test('launchSwarm resolves success once the process closes and the swarm is ready', async () => {
  const targetPath = mkTmp();
  writeReadyState(targetPath);
  writeSwarmScript(targetPath, 'exit 0');
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    const result = await launchSwarm(targetPath);
    assert.equal(result.success, true);
    assert.match(result.message, /launched successfully/);
  } finally {
    fake.restore();
  }
});

test('launchSwarm resolves success as soon as stdout announces readiness', async () => {
  const targetPath = mkTmp();
  writeReadyState(targetPath);
  writeSwarmScript(targetPath, 'echo "SwarmForge is ready"');
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    const result = await launchSwarm(targetPath);
    assert.equal(result.success, true);
    assert.match(result.message, /launched successfully/);
  } finally {
    fake.restore();
  }
});

test('spawn-registry-01: launchSwarm records a tracked child-job entry keyed on the spawned process group', async () => {
  const targetPath = mkTmp();
  writeReadyState(targetPath);
  // Announce readiness but keep the child alive (blocked on stdin) so the
  // registry entry can be observed before the process exits and removes it.
  writeSwarmScript(targetPath, 'echo "SwarmForge is ready"\nread _line\nexit 0');
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    const result = await launchSwarm(targetPath);
    assert.equal(result.success, true);

    const entries = readTrackedJobs(path.join(targetPath, '.swarmforge'));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, 'swarm-launch');
    assert.equal(entries[0].worktree, targetPath);
    assert.equal(typeof entries[0].pgid, 'number');

    // detached:true makes the child's pid its process group's leader -
    // killing the negated pid tears down the whole group so the test
    // leaves no process behind.
    process.kill(-entries[0].pgid, 'SIGKILL');
  } finally {
    fake.restore();
  }
});

test('launchSwarm resolves failure with stderr when the process closes and swarm never became ready', async () => {
  const targetPath = mkTmp();
  writeSwarmScript(targetPath, 'echo "boom" >&2\nexit 1');
  const result = await launchSwarm(targetPath);
  assert.equal(result.success, false);
  assert.match(result.message, /boom/);
});

test('launchSwarm reports the exit code when the process closes with no output and swarm never became ready', async () => {
  const targetPath = mkTmp();
  writeSwarmScript(targetPath, 'exit 7');
  const result = await launchSwarm(targetPath);
  assert.equal(result.success, false);
  assert.match(result.message, /exit code 7/);
});

test('launchSwarm resolves failure when the process cannot be spawned', async () => {
  const targetPath = mkTmp();
  const scriptPath = writeSwarmScript(targetPath, 'exit 0');
  fs.chmodSync(scriptPath, 0o000);
  try {
    const result = await launchSwarm(targetPath);
    assert.equal(result.success, false);
    assert.match(result.message, /Failed to start swarm/);
  } finally {
    fs.chmodSync(scriptPath, 0o755);
  }
});

test('launchSwarm resolves success via the readiness poll when the process keeps running quietly', async () => {
  const targetPath = mkTmp();
  writeReadyState(targetPath);
  writeSwarmScript(targetPath, 'sleep 2');
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    const result = await launchSwarm(targetPath);
    assert.equal(result.success, true);
  } finally {
    fake.restore();
  }
});

test('launchSwarm times out when the swarm never becomes ready in time', async () => {
  const targetPath = mkTmp();
  writeSwarmScript(targetPath, 'sleep 2');
  const result = await launchSwarm(targetPath, undefined, 200);
  assert.equal(result.success, false);
  assert.match(result.message, /Timed out waiting/);
});

// --- Launch log (BL-058): launch failures were ephemeral toast messages —
//     the 2026-07-03 18:12 failed launch left zero diagnosable output. Every
//     attempt, success or failure, must persist the spawned ./swarm
//     stdout+stderr and the final LaunchResult to .swarmforge/last-launch.log. ---

function readLaunchLog(targetPath) {
  return fs.readFileSync(path.join(targetPath, '.swarmforge', 'last-launch.log'), 'utf8');
}

test('launchSwarm persists stderr and the failure outcome to last-launch.log', async () => {
  const targetPath = mkTmp();
  writeSwarmScript(targetPath, 'echo "boom" >&2\nexit 1');
  const result = await launchSwarm(targetPath);
  assert.equal(result.success, false);
  const log = readLaunchLog(targetPath);
  assert.match(log, /boom/);
  assert.match(log, /success: false/);
  assert.match(log, /Swarm launch failed/);
});

test('launchSwarm persists stdout and the success outcome to last-launch.log', async () => {
  const targetPath = mkTmp();
  writeReadyState(targetPath);
  writeSwarmScript(targetPath, 'echo "SwarmForge is ready"');
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    const result = await launchSwarm(targetPath, 'fix-auth-bug');
    assert.equal(result.success, true);
    const log = readLaunchLog(targetPath);
    assert.match(log, /success: true/);
    assert.match(log, /SwarmForge is ready/);
    assert.match(log, /fix-auth-bug/);
  } finally {
    fake.restore();
  }
});

test('launchSwarm writes the launch log even when no ./swarm wrapper exists', async () => {
  const targetPath = mkTmp();
  const result = await launchSwarm(targetPath);
  assert.equal(result.success, false);
  const log = readLaunchLog(targetPath);
  assert.match(log, /No .\/swarm wrapper found/);
  assert.match(log, /success: false/);
});

test('launchSwarm overwrites the launch log on each attempt', async () => {
  const targetPath = mkTmp();
  writeSwarmScript(targetPath, 'echo "FIRST-ATTEMPT" >&2\nexit 1');
  await launchSwarm(targetPath);
  writeSwarmScript(targetPath, 'echo "SECOND-ATTEMPT" >&2\nexit 1');
  await launchSwarm(targetPath);
  const log = readLaunchLog(targetPath);
  assert.match(log, /SECOND-ATTEMPT/);
  assert.doesNotMatch(log, /FIRST-ATTEMPT/);
});

test('waitForSwarmReady resolves true immediately when already ready', async () => {
  const targetPath = mkTmp();
  writeReadyState(targetPath);
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    const ready = await waitForSwarmReady(targetPath, 5000, 50);
    assert.equal(ready, true);
  } finally {
    fake.restore();
  }
});

test('waitForSwarmReady resolves false after the timeout elapses', async () => {
  const targetPath = mkTmp();
  const ready = await waitForSwarmReady(targetPath, 150, 30);
  assert.equal(ready, false);
});

test('chooseReattachTimeoutMs returns the cold-start budget when a swarm socket is present', () => {
  assert.equal(chooseReattachTimeoutMs(true, 120000, 3000), 120000);
});

test('chooseReattachTimeoutMs returns the fast budget when no swarm socket is present', () => {
  assert.equal(chooseReattachTimeoutMs(false, 120000, 3000), 3000);
});

test('waitForSwarmReady resolves true once readiness appears mid-poll', async () => {
  const targetPath = mkTmp();
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    setTimeout(() => writeReadyState(targetPath), 100);
    const ready = await waitForSwarmReady(targetPath, 5000, 30);
    assert.equal(ready, true);
  } finally {
    fake.restore();
  }
});

test('buildLaunchEnv deletes inherited SWARM_RUN_NAME when runName is empty string', () => {
  const savedValue = process.env.SWARM_RUN_NAME;
  process.env.SWARM_RUN_NAME = 'inherited-value';
  try {
    const env = buildLaunchEnv('');
    assert.equal(env['SWARM_RUN_NAME'], undefined);
    assert(!env.hasOwnProperty('SWARM_RUN_NAME'), 'SWARM_RUN_NAME should be deleted, not just undefined');
  } finally {
    if (savedValue) {
      process.env.SWARM_RUN_NAME = savedValue;
    } else {
      delete process.env.SWARM_RUN_NAME;
    }
  }
});
