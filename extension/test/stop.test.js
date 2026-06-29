const assert = require('node:assert/strict');
const test = require('node:test');

const { buildKillSessionArgs, buildKillDaemonArgs } = require('../out/swarm/swarmStopper');

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
