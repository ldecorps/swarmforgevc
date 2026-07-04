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
  runCommand,
  DEFAULT_RUN_COMMAND_TIMEOUT_MS,
} = require('../out/swarm/tmuxClient');
const { installExecutable } = require('./helpers/sharedBin');

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

// --- respawnAgent: the launch script runs `claude` in the foreground and
//     does not exit until the agent does. Running it in the extension host
//     (the old behavior) blocked the host's single JS thread indefinitely and
//     froze the whole extension. Respawn must go INTO the role's tmux pane
//     via send-keys, so the agent lives where the tiles expect it. ---

function writeRespawnState(tmp, role = 'coder') {
  const stateDir = path.join(tmp, '.swarmforge');
  const launchDir = path.join(stateDir, 'launch');
  fs.mkdirSync(launchDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  fs.writeFileSync(
    path.join(stateDir, 'sessions.tsv'),
    `1\t${role}\tswarmforge-${role}\tCoder\tclaude\n`
  );
  const script = path.join(launchDir, `${role}.sh`);
  const marker = path.join(tmp, 'executed-in-host');
  installExecutable(script, `#!/bin/bash\ntouch "${marker}"\n`);
  return { script, marker };
}

test('respawnAgent sends the launch script into the role pane, never running it in-host', () => {
  const tmp = mkTmp();
  const { script, marker } = writeRespawnState(tmp);
  const fake = installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
  ]);
  try {
    const result = respawnAgent(tmp, 'coder');
    assert.equal(result.success, true);
    assert.match(result.message, /restart/);
    assert.ok(
      !fs.existsSync(marker),
      'launch script must not execute inside the extension host'
    );
    const sendCalls = fake.calls().filter((args) => args.includes('send-keys'));
    assert.ok(
      sendCalls.some((args) => args.join(' ').includes(`bash ${script}`)),
      'must type the launch command into the pane'
    );
    assert.ok(
      sendCalls.some((args) => args[args.length - 1] === 'Enter'),
      'must submit the typed command with Enter'
    );
    assert.ok(
      sendCalls.every((args) => args[args.indexOf('-t') + 1] === 'swarmforge-coder:2.1'),
      'must target the role session pane'
    );
  } finally {
    fake.restore();
  }
});

test('respawnAgent fails without touching tmux when the launch script is missing', () => {
  const tmp = mkTmp();
  const result = respawnAgent(tmp, 'coder');
  assert.equal(result.success, false);
  assert.match(result.message, /No launch script found/);
});

test('respawnAgent fails when no tmux socket is recorded', () => {
  const tmp = mkTmp();
  const launchDir = path.join(tmp, '.swarmforge', 'launch');
  fs.mkdirSync(launchDir, { recursive: true });
  installExecutable(path.join(launchDir, 'coder.sh'), '#!/bin/bash\nexit 0\n');

  const result = respawnAgent(tmp, 'coder');
  assert.equal(result.success, false);
  assert.match(result.message, /no tmux socket/i);
});

test('respawnAgent fails when the role has no session in sessions.tsv', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'coder');
  const fake = installFakeTmux([]);
  try {
    const result = respawnAgent(tmp, 'cleaner');
    assert.equal(result.success, false);
    assert.match(result.message, /No launch script found/);

    const launchDir = path.join(tmp, '.swarmforge', 'launch');
    installExecutable(path.join(launchDir, 'cleaner.sh'), '#!/bin/bash\nexit 0\n');
    const withScript = respawnAgent(tmp, 'cleaner');
    assert.equal(withScript.success, false);
    assert.match(withScript.message, /not found in sessions\.tsv/);
  } finally {
    fake.restore();
  }
});

test('respawnAgent reports failure when tmux send-keys fails', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp);
  const fake = installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'send-keys', exitCode: 1, stderr: 'no such session' },
  ]);
  try {
    const result = respawnAgent(tmp, 'coder');
    assert.equal(result.success, false);
    assert.match(result.message, /no such session/);
  } finally {
    fake.restore();
  }
});

// --- BL-093: a wedged TUI (process alive, all input ignored) cannot be
//     recovered by typing into it - capture-pane keeps showing the typed
//     command sitting unsubmitted no matter how many times Enter is sent.
//     respawnAgent must escalate to a forced pane kill+relaunch instead of
//     reporting a bare failure. ---

test('respawnAgent wedged-respawn-04: escalates to a forced pane respawn when the pane never confirms submission', () => {
  const tmp = mkTmp();
  const { script } = writeRespawnState(tmp);
  const fake = installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
    // The pane is wedged: every capture-pane still shows the typed command
    // sitting on the input line, so verification can never confirm submit.
    { subcommand: 'capture-pane', exitCode: 0, stdout: `❯ bash ${script}` },
    { subcommand: 'respawn-pane', exitCode: 0, stdout: '' },
  ]);
  try {
    const result = respawnAgent(tmp, 'coder');
    assert.equal(result.success, true);
    assert.match(result.message, /wedged/i);
    const respawnCalls = fake.calls().filter((args) => args.includes('respawn-pane'));
    assert.equal(respawnCalls.length, 1, 'must force exactly one pane respawn after verification is exhausted');
    assert.ok(
      respawnCalls[0].includes('-k'),
      'forced respawn must kill the wedged process, not just type into it'
    );
    assert.ok(
      respawnCalls[0].some((arg) => arg.includes(`bash ${script}`)),
      'forced respawn must relaunch the same role launch script'
    );
  } finally {
    fake.restore();
  }
});

test('respawnAgent wedged-respawn-05: never forces a pane respawn when send-keys is confirmed delivered', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp);
  const fake = installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
    // A healthy pane: the input line is empty once Enter is sent.
    { subcommand: 'capture-pane', exitCode: 0, stdout: '❯ ' },
  ]);
  try {
    const result = respawnAgent(tmp, 'coder');
    assert.equal(result.success, true);
    assert.doesNotMatch(result.message, /wedged/i);
    const respawnCalls = fake.calls().filter((args) => args.includes('respawn-pane'));
    assert.equal(respawnCalls.length, 0, 'a healthy agent must never trigger a forced pane respawn');
  } finally {
    fake.restore();
  }
});

test('respawnAgent reports failure when both verified send-keys and the forced pane respawn fail', () => {
  const tmp = mkTmp();
  const { script } = writeRespawnState(tmp);
  const fake = installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: `❯ bash ${script}` },
    { subcommand: 'respawn-pane', exitCode: 1, stderr: 'no such pane' },
  ]);
  try {
    const result = respawnAgent(tmp, 'coder');
    assert.equal(result.success, false);
    assert.match(result.message, /no such pane/);
  } finally {
    fake.restore();
  }
});

// --- runCommand timeout: cp.spawnSync with no timeout lets any hung child
//     wedge the extension host's event loop forever (the respawn freeze).
//     Every runCommand call must carry a timeout so a stuck command surfaces
//     as a failed TmuxRunResult instead of a hang. ---

test('runCommand kills a hung child at the timeout and reports failure instead of wedging', () => {
  const start = Date.now();
  const result = runCommand('sleep', ['5'], { encoding: 'utf8', timeout: 150 });
  assert.ok(Date.now() - start < 3000, 'must return well before the child would exit');
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /timed out/i);
});

test('runCommand applies a bounded default timeout', () => {
  assert.ok(Number.isFinite(DEFAULT_RUN_COMMAND_TIMEOUT_MS));
  assert.ok(DEFAULT_RUN_COMMAND_TIMEOUT_MS >= 1_000, 'must not starve slow-but-fine tmux calls');
  assert.ok(DEFAULT_RUN_COMMAND_TIMEOUT_MS <= 15_000, 'must be far below "forever"');
});
