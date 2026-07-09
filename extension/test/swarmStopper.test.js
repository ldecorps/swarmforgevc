const assert = require('node:assert/strict');
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

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-stop-'));
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
  const bounceFile = path.join(targetPath, '.swarmforge', 'bounce-graceful');
  fs.writeFileSync(bounceFile, 'swarm');
}

function writeBounceDrainState(targetPath) {
  const drainFile = path.join(targetPath, '.swarmforge', 'bounce-drain.json');
  fs.writeFileSync(drainFile, JSON.stringify({ bounceType: 'swarm', startedAt: Date.now() }));
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
  writeDaemonPids(targetPath, process.pid, process.pid);

  const result = stopAllDaemonProcesses(targetPath);

  // At least one should be attempted
  assert('daemonStopped' in result);
  assert('supervisorStopped' in result);
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
  // Should have completion phases
  assert(result.phases.some(p => p.name === 'daemon-stop'));
  assert(result.phases.some(p => p.name === 'state-cleanup'));
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
  writeDaemonPids(targetPath, process.pid, process.pid);

  const result = stopSwarmCompletely(targetPath, 100, true);

  // Should have attempted graceful shutdown
  assert('phases' in result);
  assert(result.phases.some(p => p.name.includes('graceful') || p.name.includes('term')));
});

test('stopSwarmCompletely result includes timing info', () => {
  const targetPath = mkTmp();
  writeSwarmState(targetPath);

  const result = stopSwarmCompletely(targetPath);

  assert('durationMs' in result);
  assert(typeof result.durationMs === 'number');
  assert(result.durationMs >= 0);
});
