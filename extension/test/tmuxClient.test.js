const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  getPaneBaseIndex,
  paneTarget,
  resolveAgentPaneTarget,
  getPaneCommand,
  capturePane,
  sendKeys,
  sessionExists,
  readSwarmRoles,
  respawnAgent,
} = require('../out/swarm/tmuxClient');

const { installFakeTmux } = require('./helpers/fakeTmux');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-tmuxclient-'));
}

test('paneTarget builds session:window.paneIndex', () => {
  assert.equal(paneTarget('swarmforge-coder', '0', 1), 'swarmforge-coder:0.1');
});

test('getPaneBaseIndex parses numeric stdout from tmux', () => {
  const fake = installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
  ]);
  try {
    assert.equal(getPaneBaseIndex('/tmp/fake.sock'), 1);
  } finally {
    fake.restore();
  }
});

test('getPaneBaseIndex returns 0 when tmux output is not numeric', () => {
  const fake = installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: 'not-a-number\n' },
  ]);
  try {
    assert.equal(getPaneBaseIndex('/tmp/fake.sock'), 0);
  } finally {
    fake.restore();
  }
});

test('resolveAgentPaneTarget uses the first window index from tmux', () => {
  const fake = installFakeTmux([
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n3\n' },
  ]);
  try {
    assert.equal(
      resolveAgentPaneTarget('/tmp/fake.sock', 'swarmforge-coder', 1),
      'swarmforge-coder:2.1'
    );
  } finally {
    fake.restore();
  }
});

test('resolveAgentPaneTarget falls back to window 0 when tmux call fails', () => {
  const fake = installFakeTmux([
    { subcommand: 'list-windows', exitCode: 1, stdout: '' },
  ]);
  try {
    assert.equal(
      resolveAgentPaneTarget('/tmp/fake.sock', 'swarmforge-coder', 1),
      'swarmforge-coder:0.1'
    );
  } finally {
    fake.restore();
  }
});

test('resolveAgentPaneTarget falls back to window 0 when tmux returns empty stdout', () => {
  const fake = installFakeTmux([
    { subcommand: 'list-windows', exitCode: 0, stdout: '' },
  ]);
  try {
    assert.equal(
      resolveAgentPaneTarget('/tmp/fake.sock', 'swarmforge-coder', 1),
      'swarmforge-coder:0.1'
    );
  } finally {
    fake.restore();
  }
});

test('getPaneCommand returns trimmed pane command on success', () => {
  const fake = installFakeTmux([
    { subcommand: 'display-message', exitCode: 0, stdout: 'node\n' },
  ]);
  try {
    assert.equal(getPaneCommand('/tmp/fake.sock', 'sess:0.1'), 'node');
  } finally {
    fake.restore();
  }
});

test('getPaneCommand returns empty string when tmux call fails', () => {
  const fake = installFakeTmux([
    { subcommand: 'display-message', exitCode: 1, stdout: '' },
  ]);
  try {
    assert.equal(getPaneCommand('/tmp/fake.sock', 'sess:0.1'), '');
  } finally {
    fake.restore();
  }
});

test('capturePane returns captured stdout on success', () => {
  const fake = installFakeTmux([
    { subcommand: 'capture-pane', exitCode: 0, stdout: 'hello world\n' },
  ]);
  try {
    const result = capturePane('/tmp/fake.sock', 'sess:0.1');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'hello world');
  } finally {
    fake.restore();
  }
});

test('capturePane includes a start-line flag when startLine is provided', () => {
  const fake = installFakeTmux([{ subcommand: 'capture-pane', exitCode: 0, stdout: '' }]);
  try {
    capturePane('/tmp/fake.sock', 'sess:0.1', -500);
    const call = fake.calls().find((args) => args.includes('capture-pane'));
    assert.ok(call.includes('-S'));
    assert.ok(call.includes('-500'));
  } finally {
    fake.restore();
  }
});

test('sendKeys sends a named key non-literally', () => {
  const fake = installFakeTmux([{ subcommand: 'send-keys', exitCode: 0, stdout: '' }]);
  try {
    sendKeys('/tmp/fake.sock', 'sess:0.1', 'Enter', false);
    const call = fake.calls().find((args) => args.includes('send-keys'));
    assert.deepEqual(call, ['-S', '/tmp/fake.sock', 'send-keys', '-t', 'sess:0.1', 'Enter']);
  } finally {
    fake.restore();
  }
});

test('sendKeys sends literal text with -l --', () => {
  const fake = installFakeTmux([{ subcommand: 'send-keys', exitCode: 0, stdout: '' }]);
  try {
    sendKeys('/tmp/fake.sock', 'sess:0.1', 'hello', true);
    const call = fake.calls().find((args) => args.includes('send-keys'));
    assert.deepEqual(call, [
      '-S',
      '/tmp/fake.sock',
      'send-keys',
      '-t',
      'sess:0.1',
      '-l',
      '--',
      'hello',
    ]);
  } finally {
    fake.restore();
  }
});

test('sessionExists returns true when tmux has-session succeeds', () => {
  const fake = installFakeTmux([{ subcommand: 'has-session', exitCode: 0, stdout: '' }]);
  try {
    assert.equal(sessionExists('/tmp/fake.sock', 'swarmforge-coder'), true);
  } finally {
    fake.restore();
  }
});

test('sessionExists returns false when tmux has-session fails', () => {
  const fake = installFakeTmux([{ subcommand: 'has-session', exitCode: 1, stdout: '' }]);
  try {
    assert.equal(sessionExists('/tmp/fake.sock', 'swarmforge-coder'), false);
  } finally {
    fake.restore();
  }
});

test('readSwarmRoles returns empty array when sessions.tsv does not exist', () => {
  const tmp = mkTmp();
  assert.deepEqual(readSwarmRoles(tmp), []);
});

test('readSwarmRoles skips blank lines in sessions.tsv', () => {
  const tmp = mkTmp();
  const stateDir = path.join(tmp, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n\n2\tcleaner\tswarmforge-cleaner\tCleaner\tclaude\n'
  );
  const roles = readSwarmRoles(tmp);
  assert.equal(roles.length, 2);
  assert.equal(roles[0].role, 'coder');
  assert.equal(roles[1].role, 'cleaner');
});

test('readSwarmRoles skips malformed rows missing required fields', () => {
  const tmp = mkTmp();
  const stateDir = path.join(tmp, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, 'sessions.tsv'),
    '1\tcoder\tswarmforge-coder\tCoder\tclaude\n2\t\t\t\t\n3\tcleaner\tswarmforge-cleaner\tCleaner\tclaude\n'
  );
  const roles = readSwarmRoles(tmp);
  assert.equal(roles.length, 2);
  assert.deepEqual(
    roles.map((r) => r.role),
    ['coder', 'cleaner']
  );
});

test('respawnAgent returns success when the launch script exits 0', () => {
  const tmp = mkTmp();
  const launchDir = path.join(tmp, '.swarmforge', 'launch');
  fs.mkdirSync(launchDir, { recursive: true });
  const script = path.join(launchDir, 'coder.sh');
  fs.writeFileSync(script, '#!/bin/bash\nexit 0\n');
  fs.chmodSync(script, 0o755);

  const result = respawnAgent(tmp, 'coder');
  assert.equal(result.success, true);
  assert.match(result.message, /restarted/);
});

test('respawnAgent returns failure with stderr when the launch script exits non-zero', () => {
  const tmp = mkTmp();
  const launchDir = path.join(tmp, '.swarmforge', 'launch');
  fs.mkdirSync(launchDir, { recursive: true });
  const script = path.join(launchDir, 'coder.sh');
  fs.writeFileSync(script, '#!/bin/bash\necho "boom" >&2\nexit 1\n');
  fs.chmodSync(script, 0o755);

  const result = respawnAgent(tmp, 'coder');
  assert.equal(result.success, false);
  assert.match(result.message, /boom/);
});
