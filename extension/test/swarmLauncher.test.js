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
  countRolesInConfig,
  runningSwarmMatchesConfig,
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

function writeSwarmScriptThatBecomesReady(targetPath, body = 'exit 0') {
  const sock = path.join(targetPath, 'fake.sock');
  const sessions = '1\tcoder\tswarmforge-coder\tCoder\tclaude\n';
  return writeSwarmScript(
    targetPath,
    `mkdir -p .swarmforge
echo "${sock}" > .swarmforge/tmux-socket
printf '%s' '${sessions}' > .swarmforge/sessions.tsv
${body}`
  );
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

// --- BL-116: login-shell PATH probe - a GUI-launched VS Code on Linux with
//     tmux/bb/claude in a linuxbrew or custom shell-profile dir needs the
//     REAL login shell's PATH, not just a hardcoded macOS-shaped list. ---

const {
  parseLoginShellPathOutput,
  probeLoginShellPath,
  getCachedLoginShellPathDirs,
  resetLoginShellPathCacheForTests,
} = require('../out/swarm/swarmLauncher');

test('parseLoginShellPathOutput splits a colon-separated PATH into directories', () => {
  assert.deepEqual(parseLoginShellPathOutput('/usr/bin:/home/u/.local/bin\n'), ['/usr/bin', '/home/u/.local/bin']);
});

test('parseLoginShellPathOutput drops empty segments (leading/trailing/doubled colons)', () => {
  assert.deepEqual(parseLoginShellPathOutput(':/usr/bin::/bin:'), ['/usr/bin', '/bin']);
});

test('BL-116 path-probe-01: augmentPath merges probed directories ahead of the hardcoded list', () => {
  const result = augmentPath('/usr/bin', ['/home/u/.linuxbrew/bin']);
  const parts = result.split(':');
  assert(parts.includes('/home/u/.linuxbrew/bin'), 'probed dir missing');
  assert(parts.includes('/opt/homebrew/bin'), 'hardcoded fallback dir must still be present');
  assert(parts.indexOf('/home/u/.linuxbrew/bin') < parts.indexOf('/opt/homebrew/bin'), 'probed dirs take precedence');
});

test('augmentPath with no probedDirs argument behaves exactly as before this ticket', () => {
  assert.equal(augmentPath('/usr/bin'), augmentPath('/usr/bin', []));
});

test('BL-116 path-probe-01: probeLoginShellPath parses the login shell PATH on success (exit 0)', async () => {
  const fakeRun = async () => ({ code: 0, stdout: '/home/u/.linuxbrew/bin:/usr/bin\n' });
  const dirs = await probeLoginShellPath('/bin/zsh', 1000, fakeRun);
  assert.deepEqual(dirs, ['/home/u/.linuxbrew/bin', '/usr/bin']);
});

test('BL-116 path-probe-02: probeLoginShellPath falls back to [] on a nonzero exit', async () => {
  const fakeRun = async () => ({ code: 1, stdout: '' });
  const dirs = await probeLoginShellPath('/bin/zsh', 1000, fakeRun);
  assert.deepEqual(dirs, []);
});

test('BL-116 path-probe-02: probeLoginShellPath falls back to [] on a timeout (code null)', async () => {
  const fakeRun = async () => ({ code: null, stdout: '' });
  const dirs = await probeLoginShellPath('/bin/zsh', 1000, fakeRun);
  assert.deepEqual(dirs, []);
});

test('BL-116 path-probe-01: the probe runs at most once per activation (cached, not re-run on a second call)', async () => {
  resetLoginShellPathCacheForTests();
  let calls = 0;
  const fakeRun = async () => {
    calls += 1;
    return { code: 0, stdout: '/probed/bin\n' };
  };

  const first = await getCachedLoginShellPathDirs('/bin/zsh', 1000, fakeRun);
  const second = await getCachedLoginShellPathDirs('/bin/zsh', 1000, fakeRun);

  assert.deepEqual(first, ['/probed/bin']);
  assert.deepEqual(second, ['/probed/bin']);
  assert.equal(calls, 1, 'the login shell must only ever be probed once per (cached) activation');
});

test('BL-116: concurrent callers before the probe resolves share the same in-flight probe, not a second one', async () => {
  resetLoginShellPathCacheForTests();
  let calls = 0;
  const fakeRun = () =>
    new Promise((resolve) => {
      calls += 1;
      setImmediate(() => resolve({ code: 0, stdout: '/probed/bin\n' }));
    });

  const [first, second] = await Promise.all([
    getCachedLoginShellPathDirs('/bin/zsh', 1000, fakeRun),
    getCachedLoginShellPathDirs('/bin/zsh', 1000, fakeRun),
  ]);

  assert.deepEqual(first, ['/probed/bin']);
  assert.deepEqual(second, ['/probed/bin']);
  assert.equal(calls, 1, 'two callers racing before resolution must share one in-flight probe');
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

test('buildLaunchEnv forwards SWARMFORGE_CONFIG when set explicitly', () => {
  const env = buildLaunchEnv(undefined, '/tmp/seven-pack.conf');
  assert.equal(env['SWARMFORGE_CONFIG'], '/tmp/seven-pack.conf');
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
  // BL-207: orchestration/UI can branch on the stable category instead of
  // parsing this message text.
  assert.equal(result.category, 'launch-failed');
});

test('launchSwarm resolves success once the process closes and the swarm is ready', async () => {
  const targetPath = mkTmp();
  writeSwarmScriptThatBecomesReady(targetPath);
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
  writeSwarmScriptThatBecomesReady(targetPath, 'echo "SwarmForge is ready"');
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    const result = await launchSwarm(targetPath);
    assert.equal(result.success, true);
    assert.match(result.message, /launched successfully/);
  } finally {
    fake.restore();
  }
});

// BL-212: a fake spawned child, injected via launchSwarm's spawnFn seam -
// no real OS process, no process group left to kill, deterministic under
// parallel load. Registering a 'data' listener on .stdout schedules the
// "ready" announcement on the next microtask: by the time launchSwarm's
// synchronous Promise executor has registered that listener, spawnFn (and
// so spawnTrackedJob's registry write) has already run, so there is no
// timing race to observe the entry - it exists deterministically, not
// "usually by the time we check."
function fakeSwarmChild(pid) {
  const listeners = {};
  const stdoutListeners = {};
  return {
    pid,
    stdout: {
      on(event, listener) {
        stdoutListeners[event] = listener;
        if (event === 'data') {
          queueMicrotask(() => listener(Buffer.from('SwarmForge is ready\n')));
        }
      },
    },
    stderr: { on() {} },
    on(event, listener) {
      listeners[event] = listener;
    },
    emitExit() {
      listeners.exit?.();
    },
  };
}

// BL-219: forces the "cannot be spawned" condition deterministically via
// launchSwarm's spawnFn seam, instead of chmod 0o000 - root bypasses
// permission checks entirely, and WSL/mounted filesystems don't reliably
// enforce mode bits, so a chmod-based simulation silently stops
// reproducing the failure it exists to test. This fires the same 'error'
// event a real ENOENT/EACCES spawn failure would.
function fakeUnspawnableChild() {
  return {
    pid: undefined,
    stdout: { on() {} },
    stderr: { on() {} },
    on(event, listener) {
      if (event === 'error') {
        queueMicrotask(() => listener(new Error('spawn ENOENT')));
      }
    },
  };
}

test('spawn-registry-01: launchSwarm records a tracked child-job entry keyed on the spawned process group', async () => {
  const targetPath = mkTmp();
  writeSwarmScript(targetPath, 'exit 0'); // only fs.existsSync(swarmScript) needs this - never actually run
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  const child = fakeSwarmChild(54321);
  try {
    const result = await launchSwarm(targetPath, undefined, 120_000, undefined, () => {
      // stopSwarm (called at the top of launchSwarm, before spawnFn) tears
      // down any pre-existing ready-state on purpose - a real ./swarm
      // script's first action recreates it (writeSwarmScriptThatBecomesReady's
      // own body), so the fake spawn must too, right when "launched".
      writeReadyState(targetPath);
      return child;
    });
    assert.equal(result.success, true);

    const entries = readTrackedJobs(path.join(targetPath, '.swarmforge'));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, 'swarm-launch');
    assert.equal(entries[0].worktree, targetPath);
    assert.equal(entries[0].pgid, 54321);

    // spawn-registry-01 (childJobRegistry.test.js) already covers the
    // generic remove-on-exit mechanism deterministically; this only
    // confirms launchSwarm's own entry is the one that reacts to it.
    child.emitExit();
    assert.deepEqual(readTrackedJobs(path.join(targetPath, '.swarmforge')), []);
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
  writeSwarmScript(targetPath, 'exit 0'); // only fs.existsSync(swarmScript) needs this - the injected spawnFn below never actually runs it
  const result = await launchSwarm(targetPath, undefined, 120_000, undefined, () => fakeUnspawnableChild());
  assert.equal(result.success, false);
  assert.match(result.message, /Failed to start swarm/);
  assert.equal(result.category, 'launch-failed');
});

test('launchSwarm resolves success via the readiness poll when the process keeps running quietly', async () => {
  const targetPath = mkTmp();
  writeSwarmScriptThatBecomesReady(targetPath, 'sleep 2');
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    const result = await launchSwarm(targetPath);
    assert.equal(result.success, true);
  } finally {
    fake.restore();
  }
});

test('launchSwarm does not report success against a pre-existing smaller swarm', async () => {
  const targetPath = mkTmp();
  writeReadyState(targetPath);
  writeSwarmScript(targetPath, 'sleep 5');
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    const result = await launchSwarm(targetPath, undefined, 300);
    assert.equal(result.success, false);
    assert.match(result.message, /Timed out waiting/);
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
  assert.equal(result.category, 'timeout');
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
  writeSwarmScriptThatBecomesReady(targetPath, 'echo "SwarmForge is ready"');
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
  let now = 0;
  const getNowMs = () => now;
  const scheduleTick = (fn) => {
    now += 30; // advance the fake clock by exactly one poll interval
    fn();
  };
  const ready = await waitForSwarmReady(targetPath, 150, 30, getNowMs, scheduleTick);
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
    let now = 0;
    const getNowMs = () => now;
    let tickCount = 0;
    const scheduleTick = (fn) => {
      now += 30;
      tickCount += 1;
      if (tickCount === 2) {
        // Readiness appears only after a couple of polls - proves the loop
        // genuinely re-checks rather than only succeeding on the first try.
        writeReadyState(targetPath);
      }
      fn();
    };
    const ready = await waitForSwarmReady(targetPath, 5000, 30, getNowMs, scheduleTick);
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

test('countRolesInConfig counts window lines in a pack/profile conf', () => {
  const targetPath = mkTmp();
  const configPath = path.join(targetPath, 'cheap.conf');
  fs.writeFileSync(
    configPath,
    'config active_backlog_max_depth 3\nwindow coordinator copilot master\nwindow coder copilot coder\n'
  );
  assert.equal(countRolesInConfig(configPath), 2);
});

test('runningSwarmMatchesConfig is false when roles.tsv count differs from config', () => {
  const targetPath = mkTmp();
  const configPath = path.join(targetPath, 'seven.conf');
  fs.writeFileSync(
    configPath,
    Array.from({ length: 8 }, (_, i) => `window role${i} copilot master`).join('\n')
  );
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(targetPath, '.swarmforge', 'roles.tsv'),
    'coordinator\tmaster\t' + targetPath + '\tswarmforge-coordinator\tCoordinator\tcopilot\ttask\toff\n'
  );
  assert.equal(runningSwarmMatchesConfig(targetPath, configPath), false);
});
