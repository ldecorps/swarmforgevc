const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildKillSessionArgs, stopSwarm } = require('../out/swarm/swarmStopper');

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
