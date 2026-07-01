const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { spawn } = require('node:child_process');
const { buildKillSessionArgs, stopSwarm } = require('../out/swarm/swarmStopper');
const { installFakeTmux } = require('./helpers/fakeTmux');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-stop-'));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

test('buildKillSessionArgs returns tmux kill-session args for each session', () => {
  const args = buildKillSessionArgs('/tmp/swarm.sock', ['swarmforge-coder', 'swarmforge-cleaner']);
  assert.deepEqual(args, [
    ['-S', '/tmp/swarm.sock', 'kill-session', '-t', 'swarmforge-coder'],
    ['-S', '/tmp/swarm.sock', 'kill-session', '-t', 'swarmforge-cleaner'],
  ]);
});

test('buildKillSessionArgs returns empty array when no sessions given', () => {
  const args = buildKillSessionArgs('/tmp/swarm.sock', []);
  assert.deepEqual(args, []);
});

test('stopSwarm returns failure when no tmux socket file exists', () => {
  const tmp = mkTmp();
  const result = stopSwarm(tmp);
  assert.equal(result.success, false);
  assert.match(result.message, /No tmux socket found/);
  assert.deepEqual(result.sessionsKilled, []);
});

test('stopSwarm returns failure when sessions.tsv is empty', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'tmux-socket'), '/nonexistent/swarm.sock');
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'sessions.tsv'), '');
  const result = stopSwarm(tmp);
  assert.equal(result.success, false);
  assert.match(result.message, /No sessions found/);
  assert.deepEqual(result.sessionsKilled, []);
});

test('stopSwarm returns failure when tmux socket is invalid and no sessions can be killed', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'tmux-socket'), '/nonexistent/swarm.sock');
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n'
  );
  const result = stopSwarm(tmp);
  assert.equal(result.success, false);
  assert.match(result.message, /No sessions could be stopped/);
  assert.deepEqual(result.sessionsKilled, []);
});

test('stopSwarm tolerates a missing daemon pid file', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'tmux-socket'), '/nonexistent/swarm.sock');
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n'
  );
  // no daemon/handoffd.pid — code must not throw
  const result = stopSwarm(tmp);
  assert.equal(result.success, false);
});

test('stopSwarm reports success and the killed session list when tmux kills succeed', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'tmux-socket'), '/fake/swarm.sock');
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n2\tcleaner\tswarmforge-cleaner\tCleaner\tclaude\n'
  );
  const fake = installFakeTmux([{ subcommand: 'kill-session', exitCode: 0 }]);
  try {
    const result = stopSwarm(tmp);
    assert.equal(result.success, true);
    assert.deepEqual(result.sessionsKilled, ['swarmforge-coder', 'swarmforge-cleaner']);
    assert.match(result.message, /Stopped 2 session\(s\)/);
  } finally {
    fake.restore();
  }
});

test('stopSwarm sends SIGTERM to a live daemon pid and still succeeds', async () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'tmux-socket'), '/fake/swarm.sock');
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n'
  );
  mkdirp(path.join(tmp, '.swarmforge', 'daemon'));

  // Spawn a real, harmless long-lived process so we have a PID we know is
  // safe to signal (never guess/reuse an arbitrary system PID).
  const dummy = spawn('sleep', ['30']);
  const exited = new Promise((resolve) => dummy.once('exit', (code, signal) => resolve(signal)));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'daemon', 'handoffd.pid'), String(dummy.pid));

  const fake = installFakeTmux([{ subcommand: 'kill-session', exitCode: 0 }]);
  try {
    const result = stopSwarm(tmp);
    assert.equal(result.success, true);
    const signal = await exited;
    assert.equal(signal, 'SIGTERM');
  } finally {
    fake.restore();
  }
});

test('stopSwarm ignores a daemon pid file with non-numeric content', () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'tmux-socket'), '/fake/swarm.sock');
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n'
  );
  mkdirp(path.join(tmp, '.swarmforge', 'daemon'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'daemon', 'handoffd.pid'), 'not-a-pid');

  const fake = installFakeTmux([{ subcommand: 'kill-session', exitCode: 0 }]);
  try {
    assert.doesNotThrow(() => stopSwarm(tmp));
  } finally {
    fake.restore();
  }
});

test('stopSwarm tolerates a daemon pid file pointing at an already-dead process', async () => {
  const tmp = mkTmp();
  mkdirp(path.join(tmp, '.swarmforge'));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'tmux-socket'), '/fake/swarm.sock');
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n'
  );
  mkdirp(path.join(tmp, '.swarmforge', 'daemon'));

  const dummy = spawn('true', []);
  const deadPid = await new Promise((resolve) => dummy.once('exit', () => resolve(dummy.pid)));
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'daemon', 'handoffd.pid'), String(deadPid));

  const fake = installFakeTmux([{ subcommand: 'kill-session', exitCode: 0 }]);
  try {
    assert.doesNotThrow(() => stopSwarm(tmp));
  } finally {
    fake.restore();
  }
});

const { respawnAgent } = require('../out/swarm/tmuxClient');

test('respawnAgent returns failure when launch script missing', () => {
  const result = respawnAgent('/nonexistent-target', 'coder');
  assert.equal(result.success, false);
  assert.ok(result.message.includes('launch script') || result.message.length > 0);
});
