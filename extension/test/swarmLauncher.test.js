const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { isSwarmReady, buildLaunchEnv } = require('../out/swarm/swarmLauncher');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-launch-'));
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

test('buildLaunchEnv omits SWARM_RUN_NAME when runName is empty string', () => {
  const env = buildLaunchEnv('');
  assert.equal(env['SWARM_RUN_NAME'], undefined);
});

test('buildLaunchEnv omits SWARM_RUN_NAME when runName is undefined', () => {
  const env = buildLaunchEnv();
  assert.equal(env['SWARM_RUN_NAME'], undefined);
  assert.equal(env['SWARMFORGE_TERMINAL'], 'none');
});
