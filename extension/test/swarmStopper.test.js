const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  stopSwarmCompletely,
  stopAllDaemonProcesses,
  clearAllSwarmState,
  verifySwarmStopped,
  StopPhase,
} = require('../out/swarm/swarmStopper');
const { installInProcessTmux } = require('./helpers/fakeTmux');

function ownedSocket(tmp) {
  return path.join(tmp, '.swarmforge', 'tmux', 'swarm.sock');
}

function mkTmp() {
  return mkTmpDir('sfvc-stop-');
}

// A disposable child process to use as "a real running process" in tests.
// Using `process.pid` here would be a live grenade: stopAllDaemonProcesses
// really calls `process.kill(pid, 'SIGTERM')`, so passing this test's own
// pid SIGTERMs the vitest worker running the test itself mid-run, which
// crashes the whole test-runner IPC channel rather than just failing one
// assertion (BL-121 hardening lesson — this reliably killed the worker
// pool on every invocation that included this file, isolated or not).
function spawnDisposableProcess() {
  return cp.spawn('sleep', ['30'], { stdio: 'ignore' });
}

function reapDisposableProcess(child) {
  try {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      process.kill(child.pid, 'SIGKILL');
    }
  } catch {
    // already gone
  }
}

function writeSwarmState(targetPath, roleCount = 2) {
  const swarmforgeDir = path.join(targetPath, '.swarmforge');
  fs.mkdirSync(swarmforgeDir, { recursive: true });

  // Socket file
  const socketPath = path.join(targetPath, 'fake.sock');
  fs.writeFileSync(path.join(swarmforgeDir, 'tmux-socket'), socketPath);

  // Roles file
  const roles = Array.from({ length: roleCount }, (_, i) => {
    const role = `role${i}`;
    return `${i}\t${role}\tswarmforge-${role}\t${role}\tclaude`;
  }).join('\n');
  fs.writeFileSync(path.join(swarmforgeDir, 'roles.tsv'), roles);

  // Sessions file (matches roles)
  const sessions = Array.from({ length: roleCount }, (_, i) => `swarmforge-role${i}`).join('\n');
  fs.writeFileSync(path.join(swarmforgeDir, 'sessions.tsv'), sessions);
}

function writeDaemonPids(targetPath, daemonPid = 99999, supervisorPid = 99998) {
  const daemonDir = path.join(targetPath, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });

  if (daemonPid) {
    fs.writeFileSync(path.join(daemonDir, 'handoffd.pid'), String(daemonPid));
  }
  if (supervisorPid) {
    fs.writeFileSync(path.join(daemonDir, 'handoffd-supervisor.pid'), String(supervisorPid));
  }
}

function writeBounceState(targetPath) {
  const swarmforgeDir = path.join(targetPath, '.swarmforge');
  fs.mkdirSync(swarmforgeDir, { recursive: true });
  fs.writeFileSync(path.join(swarmforgeDir, 'bounce-graceful'), 'swarm');
}

function writeBounceDrainState(targetPath) {
  const swarmforgeDir = path.join(targetPath, '.swarmforge');
  fs.mkdirSync(swarmforgeDir, { recursive: true });
  fs.writeFileSync(
    path.join(swarmforgeDir, 'bounce-drain.json'),
    JSON.stringify({ bounceType: 'swarm', startedAt: Date.now() })
  );
}

// --- clearAllSwarmState: comprehensive state cleanup ---

test('clearAllSwarmState removes socket file', () => {
  const targetPath = mkTmp();
  writeSwarmState(targetPath);

  clearAllSwarmState(targetPath);

  assert(!fs.existsSync(path.join(targetPath, '.swarmforge', 'tmux-socket')));
});

test('clearAllSwarmState removes sessions.tsv file', () => {
  const targetPath = mkTmp();
  writeSwarmState(targetPath);

  clearAllSwarmState(targetPath);

  assert(!fs.existsSync(path.join(targetPath, '.swarmforge', 'sessions.tsv')));
});

test('clearAllSwarmState removes roles.tsv file', () => {
  const targetPath = mkTmp();
  writeSwarmState(targetPath);

  clearAllSwarmState(targetPath);

  assert(!fs.existsSync(path.join(targetPath, '.swarmforge', 'roles.tsv')));
});

test('clearAllSwarmState removes bounce-graceful sentinel', () => {
  const targetPath = mkTmp();
  writeBounceState(targetPath);

  clearAllSwarmState(targetPath);

  assert(!fs.existsSync(path.join(targetPath, '.swarmforge', 'bounce-graceful')));
});

test('clearAllSwarmState removes bounce-drain.json', () => {
  const targetPath = mkTmp();
  writeBounceDrainState(targetPath);

  clearAllSwarmState(targetPath);

  assert(!fs.existsSync(path.join(targetPath, '.swarmforge', 'bounce-drain.json')));
});

test('clearAllSwarmState removes bounce-ack.json', () => {
  const targetPath = mkTmp();
  const ackFile = path.join(targetPath, '.swarmforge', 'bounce-ack.json');
  fs.mkdirSync(path.dirname(ackFile), { recursive: true });
  fs.writeFileSync(ackFile, '{}');

  clearAllSwarmState(targetPath);

  assert(!fs.existsSync(ackFile));
});

test('clearAllSwarmState is idempotent (no error on missing files)', () => {
  const targetPath = mkTmp();
  // Call twice on empty target
  clearAllSwarmState(targetPath);
  clearAllSwarmState(targetPath);
  assert(true); // No exception
});

// --- stopAllDaemonProcesses: kill daemon + supervisor ---

test('stopAllDaemonProcesses returns false when no pid files exist', () => {
  const targetPath = mkTmp();
  fs.mkdirSync(path.join(targetPath, '.swarmforge', 'daemon'), { recursive: true });

  const result = stopAllDaemonProcesses(targetPath);

  assert.equal(result.daemonStopped, false);
  assert.equal(result.supervisorStopped, false);
});

test('stopAllDaemonProcesses reports when daemon pid file present', () => {
  const targetPath = mkTmp();
  writeDaemonPids(targetPath, 99999, 99998);

  const result = stopAllDaemonProcesses(targetPath);

  assert.equal(result.daemonStopped, false); // PID doesn't exist
  assert.equal(result.supervisorStopped, false);
});

test('stopAllDaemonProcesses reports success when killing real process', () => {
  const targetPath = mkTmp();
  const daemon = spawnDisposableProcess();
  const supervisor = spawnDisposableProcess();
  try {
    writeDaemonPids(targetPath, daemon.pid, supervisor.pid);

    const result = stopAllDaemonProcesses(targetPath);

    // At least one should be attempted
    assert('daemonStopped' in result);
    assert('supervisorStopped' in result);
  } finally {
    reapDisposableProcess(daemon);
    reapDisposableProcess(supervisor);
  }
});

test('stopAllDaemonProcesses removes pid files after stopping', () => {
  const targetPath = mkTmp();
  writeDaemonPids(targetPath, 99999, 99998);

  stopAllDaemonProcesses(targetPath);

  // Files should be cleared even if kill fails
  assert(!fs.existsSync(path.join(targetPath, '.swarmforge', 'daemon', 'handoffd.pid')) ||
         !fs.readFileSync(path.join(targetPath, '.swarmforge', 'daemon', 'handoffd.pid'), 'utf8').trim());
});

// --- verifySwarmStopped: idempotent readiness check ---

test('verifySwarmStopped returns true when no socket file', () => {
  const targetPath = mkTmp();
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });

  assert.equal(verifySwarmStopped(targetPath), true);
});

test('verifySwarmStopped returns false when socket file exists', () => {
  const targetPath = mkTmp();
  writeSwarmState(targetPath);

  assert.equal(verifySwarmStopped(targetPath), false);
});

test('verifySwarmStopped returns false when daemon pid file exists and process alive', () => {
  const targetPath = mkTmp();
  writeDaemonPids(targetPath, process.pid, null);

  assert.equal(verifySwarmStopped(targetPath), false);
});

test('verifySwarmStopped returns true after complete cleanup', () => {
  const targetPath = mkTmp();
  writeSwarmState(targetPath);
  writeDaemonPids(targetPath);
  writeBounceState(targetPath);

  clearAllSwarmState(targetPath);
  stopAllDaemonProcesses(targetPath);

  assert.equal(verifySwarmStopped(targetPath), true);
});

// --- stopSwarmCompletely: full orchestrated stop ---

test('stopSwarmCompletely succeeds on already-stopped swarm', () => {
  const targetPath = mkTmp();
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });

  const result = stopSwarmCompletely(targetPath);

  assert.equal(result.success, true);
  assert(result.message.toLowerCase().includes('stop'));
});

test('stopSwarmCompletely clears all state files', () => {
  const targetPath = mkTmp();
  writeSwarmState(targetPath, 3);
  writeBounceState(targetPath);
  writeBounceDrainState(targetPath);

  stopSwarmCompletely(targetPath);

  assert(!fs.existsSync(path.join(targetPath, '.swarmforge', 'tmux-socket')));
  assert(!fs.existsSync(path.join(targetPath, '.swarmforge', 'sessions.tsv')));
  assert(!fs.existsSync(path.join(targetPath, '.swarmforge', 'bounce-graceful')));
  assert(!fs.existsSync(path.join(targetPath, '.swarmforge', 'bounce-drain.json')));
});

test('stopSwarmCompletely reports phases in result', () => {
  const targetPath = mkTmp();
  writeSwarmState(targetPath);
  writeDaemonPids(targetPath);

  const result = stopSwarmCompletely(targetPath);

  assert('phases' in result);
  assert(Array.isArray(result.phases));
  // BL-2067: exactly 4 phases on a normal run (tmux-stop, daemon-stop,
  // state-cleanup, verify-stopped) - a `.some()` check alone cannot see a
  // bogus leading entry the initial `phases = []` mutant would introduce,
  // since every real entry is still found by name regardless.
  assert.equal(result.phases.length, 4);
  // Should have completion phases
  assert(result.phases.some(p => p.name === 'daemon-stop'));
  assert(result.phases.some(p => p.name === 'state-cleanup'));
});

// BL-2052: every existing stopSwarmCompletely test's socket
// (writeSwarmState's fake.sock) sits directly in targetPath, OUTSIDE
// .swarmforge/ - so none of them actually exercises the OWNED branch of
// socketOwnedByTarget's gate inside stopSwarmCompletely; all of them were
// silently taking the refused path. This is the one real "owns its own
// socket, kills its own sessions" case.
test('stopSwarmCompletely kills its own sessions and the tmux server when the socket is genuinely owned', () => {
  const targetPath = mkTmp();
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'tmux-socket'), ownedSocket(targetPath));
  fs.writeFileSync(
    path.join(targetPath, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n'
  );

  const fake = installInProcessTmux([
    { subcommand: 'kill-session', exitCode: 0 },
    { subcommand: 'kill-server', exitCode: 0 },
  ]);
  try {
    const result = stopSwarmCompletely(targetPath);
    assert.equal(result.success, true);
    assert.deepEqual(result.sessionsAttempted, ['swarmforge-coder']);
    assert.equal(result.sessionsStopped, 1);
    const tmuxPhase = result.phases.find((p) => p.name === 'tmux-stop');
    assert.ok(tmuxPhase, 'no tmux-stop phase in the result');
    // BL-2067: the phase's own success field was never checked - only its
    // detail text - and the kill-server call's exact args were only
    // checked by substring (.includes), which a mutant dropping '-S'
    // alone (leaving 'kill-server' itself untouched) survives.
    assert.equal(tmuxPhase.success, true);
    assert.match(tmuxPhase.detail, /Stopped 1\/1 sessions/);
    assert.deepEqual(
      fake.calls().filter((c) => c.includes('kill-server')),
      [['-S', ownedSocket(targetPath), 'kill-server']]
    );
    // BL-2067: durationMs's Date.now() - startTime must be a small,
    // genuinely-elapsed value, never a value built by adding the two
    // (which would land near double the current epoch, a 13-digit ms
    // count already).
    assert(result.durationMs >= 0 && result.durationMs < 60000, `durationMs out of bounds: ${result.durationMs}`);
  } finally {
    fake.restore();
  }
});

// BL-2067: the Phase 1 kill-session loop's own `if (result.exitCode === 0)`
// had no test where one session's kill actually failed - the test above
// uses a single session with exitCode 0, same gap as drainAgentSessions
// had before this pass.
test('stopSwarmCompletely counts only the sessions whose kill-session actually succeeded', () => {
  const targetPath = mkTmp();
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'tmux-socket'), ownedSocket(targetPath));
  fs.writeFileSync(
    path.join(targetPath, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n2\tcleaner\tswarmforge-cleaner\tCleaner\tclaude\n'
  );

  const fake = installInProcessTmux([
    { subcommand: 'kill-session', argsInclude: 'swarmforge-coder', exitCode: 0 },
    { subcommand: 'kill-session', argsInclude: 'swarmforge-cleaner', exitCode: 1 },
    { subcommand: 'kill-server', exitCode: 0 },
  ]);
  try {
    const result = stopSwarmCompletely(targetPath);
    assert.equal(result.sessionsStopped, 1);
    assert.deepEqual(result.sessionsAttempted, ['swarmforge-coder', 'swarmforge-cleaner']);
    const tmuxPhase = result.phases.find((p) => p.name === 'tmux-stop');
    assert.ok(tmuxPhase, 'no tmux-stop phase in the result');
    assert.match(tmuxPhase.detail, /Stopped 1\/2 sessions/);
  } finally {
    fake.restore();
  }
});

// BL-2067: stopSwarmCompletely's noneMsg branch ("No tmux socket found") is
// distinct from its refusedMsg branch (a real but foreign socket, tested
// below) - no prior test here ever ran with NO tmux-socket file at all.
test('stopSwarmCompletely reports "no tmux socket" in the tmux-stop phase when none was ever recorded', () => {
  const targetPath = mkTmp();
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });

  const result = stopSwarmCompletely(targetPath);
  assert.equal(result.success, true);
  const tmuxPhase = result.phases.find((p) => p.name === 'tmux-stop');
  assert.ok(tmuxPhase, 'no tmux-stop phase in the result');
  assert.equal(tmuxPhase.success, true);
  assert.match(tmuxPhase.detail, /No tmux socket found \(already stopped\)/);
});

// BL-2067: daemon-stop's own `success: daemonStopped || supervisorStopped`
// had no test where exactly one of the two was true - every real-process
// case ("with graceful flag...") stopped BOTH, which cannot distinguish
// `||` from `&&`, and every pid-absent case left both false. A disposable
// real process as the daemon only (no supervisor pid file at all) proves
// the `||`: with `&&` this would wrongly read false.
test('stopSwarmCompletely reports daemon-stop success when only the daemon (not the supervisor) was running', () => {
  const targetPath = mkTmp();
  const daemon = spawnDisposableProcess();
  try {
    writeDaemonPids(targetPath, daemon.pid, null);

    const result = stopSwarmCompletely(targetPath);

    const daemonPhase = result.phases.find((p) => p.name === 'daemon-stop');
    assert.ok(daemonPhase, 'no daemon-stop phase in the result');
    assert.equal(daemonPhase.success, true);
    assert.equal(result.daemonStopped, true);
    assert.equal(result.supervisorStopped, false);
  } finally {
    reapDisposableProcess(daemon);
  }
});

// BL-2067: the all-false case - no daemon or supervisor pid file at all -
// proves the condition is not hard-coded `true`.
test('stopSwarmCompletely reports daemon-stop failure when neither daemon nor supervisor was running', () => {
  const targetPath = mkTmp();
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });

  const result = stopSwarmCompletely(targetPath);

  const daemonPhase = result.phases.find((p) => p.name === 'daemon-stop');
  assert.ok(daemonPhase, 'no daemon-stop phase in the result');
  assert.equal(daemonPhase.success, false);
  assert.equal(result.daemonStopped, false);
  assert.equal(result.supervisorStopped, false);
});

// BL-2067: state-cleanup and verify-stopped phases' own success/detail
// fields were never checked by any test - only their presence by name.
test('stopSwarmCompletely reports state-cleanup and verify-stopped phases as successful on a clean stop', () => {
  const targetPath = mkTmp();
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });

  const result = stopSwarmCompletely(targetPath);

  const stateCleanupPhase = result.phases.find((p) => p.name === 'state-cleanup');
  assert.ok(stateCleanupPhase, 'no state-cleanup phase in the result');
  assert.equal(stateCleanupPhase.success, true);
  assert.equal(stateCleanupPhase.detail, 'All state files and sentinels removed');

  const verifyPhase = result.phases.find((p) => p.name === 'verify-stopped');
  assert.ok(verifyPhase, 'no verify-stopped phase in the result');
  assert.equal(verifyPhase.success, true);
  assert.equal(verifyPhase.detail, 'Swarm fully stopped');
});

// BL-2067: the catch block (lines 428-454) had zero coverage of any kind -
// no existing fixture ever makes stopSwarmCompletely throw. Replacing
// .swarmforge/tmux-socket with a DIRECTORY makes readTmuxSocket's own
// fs.readFileSync throw EISDIR synchronously, inside the try.
test('stopSwarmCompletely still returns a well-formed degraded result when something inside it throws', () => {
  const targetPath = mkTmp();
  fs.mkdirSync(path.join(targetPath, '.swarmforge', 'tmux-socket'), { recursive: true });
  // BL-2067: the catch block's own cleanup attempt (clearAllSwarmState,
  // best-effort inside its own try) had no assertion proving it actually
  // ran - sessions.tsv is one of clearAllSwarmState's own state files and
  // is never touched by anything before readTmuxSocket throws, so its
  // removal is solely evidence of the catch's cleanup call.
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'sessions.tsv'), '1\tcoder\tswarmforge-coder\tCoder\tclaude\n');

  const result = stopSwarmCompletely(targetPath);
  assert.equal(fs.existsSync(path.join(targetPath, '.swarmforge', 'sessions.tsv')), false);

  assert.equal(result.success, false);
  assert.match(result.message, /Stop encountered error but cleaned up state/);
  assert.equal(result.daemonStopped, false);
  assert.equal(result.supervisorStopped, false);
  assert(Array.isArray(result.sessionsAttempted));
  assert.equal(typeof result.sessionsStopped, 'number');
  assert(result.durationMs >= 0 && result.durationMs < 60000, `durationMs out of bounds: ${result.durationMs}`);
  const errorPhase = result.phases.find((p) => p.name === 'error-recovery');
  assert.ok(errorPhase, 'no error-recovery phase in the result');
  assert.equal(errorPhase.success, false);
  assert.equal(typeof errorPhase.detail, 'string');
  assert(errorPhase.detail.length > 0);
});

// BL-2052 QA bounce D1: socketOwnedByTarget gates drainAgentSessions,
// clearStaleSwarmState, stopSwarm and stopSwarmCompletely, but only
// stopSwarm had a test proving a foreign socket is refused - the other
// three could lose the guard with every existing test still green
// (writeSwarmState's own fixture socket sits OUTSIDE .swarmforge/ too,
// but no test here ever asserted on the refusal that produces).
test('stopSwarmCompletely refuses a foreign tmux-socket pointer: no kill-server, tmux-stop phase names the refusal, state still cleared', () => {
  const main = mkTmp();
  const worktree = mkTmp();
  const foreignSock = path.join(main, '.swarmforge', 'tmux', 'live.sock');
  fs.mkdirSync(path.dirname(foreignSock), { recursive: true });
  fs.writeFileSync(foreignSock, '');
  fs.mkdirSync(path.join(worktree, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(worktree, '.swarmforge', 'tmux-socket'), foreignSock);
  fs.writeFileSync(
    path.join(worktree, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n'
  );

  const result = stopSwarmCompletely(worktree);

  assert.equal(result.success, true);
  assert.deepEqual(result.sessionsAttempted, []);
  assert.equal(result.sessionsStopped, 0);
  const tmuxPhase = result.phases.find((p) => p.name === 'tmux-stop');
  assert.ok(tmuxPhase, 'no tmux-stop phase in the result');
  assert.match(tmuxPhase.detail, /Refused a socket outside this root/);
  // The foreign socket file itself is untouched - nothing was ever sent to it.
  assert.equal(fs.existsSync(foreignSock), true);
  // The target's OWN stale state is still cleared, refusal notwithstanding.
  assert.equal(fs.existsSync(path.join(worktree, '.swarmforge', 'tmux-socket')), false);
  assert.equal(fs.existsSync(path.join(worktree, '.swarmforge', 'sessions.tsv')), false);
});

test('stopSwarmCompletely returns detail on sessions killed', () => {
  const targetPath = mkTmp();
  writeSwarmState(targetPath, 2);

  const result = stopSwarmCompletely(targetPath);

  // Should report attempt to stop sessions
  assert('sessionsAttempted' in result);
  assert(Array.isArray(result.sessionsAttempted));
});

test('stopSwarmCompletely is idempotent', () => {
  const targetPath = mkTmp();
  writeSwarmState(targetPath);

  const result1 = stopSwarmCompletely(targetPath);
  const result2 = stopSwarmCompletely(targetPath);

  assert.equal(result1.success, true);
  assert.equal(result2.success, true);
});

test('stopSwarmCompletely handles missing .swarmforge gracefully', () => {
  const targetPath = mkTmp();

  const result = stopSwarmCompletely(targetPath);

  assert.equal(result.success, true);
  assert(typeof result.message === 'string');
});

test('stopSwarmCompletely reports which processes were stopped', () => {
  const targetPath = mkTmp();
  writeSwarmState(targetPath);
  writeDaemonPids(targetPath);

  const result = stopSwarmCompletely(targetPath);

  assert('daemonStopped' in result);
  assert('supervisorStopped' in result);
  assert('sessionsStopped' in result);
  assert(typeof result.sessionsStopped === 'number');
});

test('stopSwarmCompletely timeout never blocks cleanup', () => {
  const targetPath = mkTmp();
  writeSwarmState(targetPath);

  const start = Date.now();
  const result = stopSwarmCompletely(targetPath, 50); // Very short timeout
  const elapsed = Date.now() - start;

  assert.equal(result.success, true);
  assert(elapsed < 2000); // Should complete quickly even with short timeout
});

test('stopSwarmCompletely with graceful flag attempts SIGTERM before SIGKILL', () => {
  const targetPath = mkTmp();
  const daemon = spawnDisposableProcess();
  const supervisor = spawnDisposableProcess();
  try {
    writeDaemonPids(targetPath, daemon.pid, supervisor.pid);

    const result = stopSwarmCompletely(targetPath, 100, true);

    // Should have attempted graceful shutdown. Phase names are fixed
    // ('daemon-stop', etc.) and never contain "graceful"/"term" themselves —
    // the SIGTERM attempt shows up in that phase's `detail` string instead.
    assert('phases' in result);
    assert(result.phases.some((p) => p.name === 'daemon-stop' && /sigterm/i.test(p.detail)));
  } finally {
    reapDisposableProcess(daemon);
    reapDisposableProcess(supervisor);
  }
});

test('stopSwarmCompletely result includes timing info', () => {
  const targetPath = mkTmp();
  writeSwarmState(targetPath);

  const result = stopSwarmCompletely(targetPath);

  assert('durationMs' in result);
  assert(typeof result.durationMs === 'number');
  assert(result.durationMs >= 0);
});
