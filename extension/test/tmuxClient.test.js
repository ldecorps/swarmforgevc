const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  getPaneBaseIndex,
  paneTarget,
  resolveAgentPaneTarget,
  getPaneCommand,
  getPanePid,
  getPanePidAndCommand,
  capturePane,
  sendKeys,
  sessionExists,
  readSwarmRoles,
  respawnAgent,
  runCommand,
  DEFAULT_RUN_COMMAND_TIMEOUT_MS,
  isTimedOut,
  shapeRunResult,
  hasRequiredRoleFields,
  parseRoleLine,
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

test('getPanePid returns trimmed pane pid on success', () => {
  const fake = installFakeTmux([
    { subcommand: 'display-message', exitCode: 0, stdout: '54321\n' },
  ]);
  try {
    assert.equal(getPanePid('/tmp/fake.sock', 'sess:0.1'), '54321');
  } finally {
    fake.restore();
  }
});

test('getPanePid returns empty string when tmux call fails', () => {
  const fake = installFakeTmux([
    { subcommand: 'display-message', exitCode: 1, stdout: '' },
  ]);
  try {
    assert.equal(getPanePid('/tmp/fake.sock', 'sess:0.1'), '');
  } finally {
    fake.restore();
  }
});

// BL-362 QA bounce follow-up: one display-message call for both pane_pid and
// pane_current_command, instead of PaneTailer's poll path spawning two.
test('getPanePidAndCommand splits pid and command from a single tab-separated call', () => {
  const fake = installFakeTmux([
    { subcommand: 'display-message', exitCode: 0, stdout: '54321\tnode\n' },
  ]);
  try {
    assert.deepEqual(getPanePidAndCommand('/tmp/fake.sock', 'sess:0.1'), { pid: '54321', command: 'node' });
    const call = fake.calls().find((args) => args.includes('display-message'));
    assert.ok(call.includes('#{pane_pid}\t#{pane_current_command}'), 'expected a single combined format string');
  } finally {
    fake.restore();
  }
});

test('getPanePidAndCommand returns empty pid and command when tmux call fails', () => {
  const fake = installFakeTmux([
    { subcommand: 'display-message', exitCode: 1, stdout: '' },
  ]);
  try {
    assert.deepEqual(getPanePidAndCommand('/tmp/fake.sock', 'sess:0.1'), { pid: '', command: '' });
  } finally {
    fake.restore();
  }
});

// A successful call whose output is missing the tab separator (no
// pane_current_command half) is a different case from a failed call - the
// pid half is still real and must not be discarded just because command
// could not be split out.
test('getPanePidAndCommand keeps a real pid and defaults command to empty when the output has no tab separator', () => {
  const fake = installFakeTmux([
    { subcommand: 'display-message', exitCode: 0, stdout: '54321\n' },
  ]);
  try {
    assert.deepEqual(getPanePidAndCommand('/tmp/fake.sock', 'sess:0.1'), { pid: '54321', command: '' });
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

// --- BL-104: readSwarmRoles complexity extraction. parseRoleLine and
//     hasRequiredRoleFields are pure and unit-tested directly through this
//     seam, independent of the file-reading loop. ---

test('hasRequiredRoleFields is true only when role, session, and displayName are all present', () => {
  assert.equal(hasRequiredRoleFields('coder', 'swarmforge-coder', 'Coder'), true);
  assert.equal(hasRequiredRoleFields('', 'swarmforge-coder', 'Coder'), false);
  assert.equal(hasRequiredRoleFields('coder', '', 'Coder'), false);
  assert.equal(hasRequiredRoleFields('coder', 'swarmforge-coder', ''), false);
  assert.equal(hasRequiredRoleFields(undefined, undefined, undefined), false);
});

test('parseRoleLine returns undefined for a blank line', () => {
  assert.equal(parseRoleLine('', 1), undefined);
  assert.equal(parseRoleLine('   ', 1), undefined);
});

test('parseRoleLine returns undefined when required fields are missing', () => {
  assert.equal(parseRoleLine('2\t\t\t\t\n', 1), undefined);
});

test('parseRoleLine parses a well-formed line', () => {
  const role = parseRoleLine('1\tcoder\tswarmforge-coder\tCoder\tclaude', 99);
  assert.deepEqual(role, {
    index: 1,
    role: 'coder',
    session: 'swarmforge-coder',
    displayName: 'Coder',
    agent: 'claude',
  });
});

test('parseRoleLine falls back to the given index when indexStr does not parse', () => {
  const role = parseRoleLine('not-a-number\tcoder\tswarmforge-coder\tCoder\tclaude', 42);
  assert.equal(role.index, 42);
});

test('parseRoleLine defaults agent to "unknown" when the field is missing', () => {
  const role = parseRoleLine('1\tcoder\tswarmforge-coder\tCoder', 1);
  assert.equal(role.agent, 'unknown');
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
  // BL-207: orchestration/UI can branch on the stable category instead of
  // parsing this message text.
  assert.equal(result.category, 'launch-failed');
});

test('respawnAgent fails when no tmux socket is recorded', () => {
  const tmp = mkTmp();
  const launchDir = path.join(tmp, '.swarmforge', 'launch');
  fs.mkdirSync(launchDir, { recursive: true });
  installExecutable(path.join(launchDir, 'coder.sh'), '#!/bin/bash\nexit 0\n');

  const result = respawnAgent(tmp, 'coder');
  assert.equal(result.success, false);
  assert.match(result.message, /no tmux socket/i);
  assert.equal(result.category, 'launch-failed');
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

// --- BL-137 live repro: a chaser that misjudges a genuinely busy agent as
//     stuck must never have its forced-respawn command typed into that
//     agent's live pane. "esc to interrupt" is Claude Code's own busy/
//     generating footer - a reliable positive signal the agent is mid-turn,
//     as distinct from its idle "shift+tab to cycle" footer. A fresh capture
//     showing it means the pane is not stuck, no matter what the caller's
//     (possibly stale) liveness signal claimed. ---

test('respawnAgent refuses to type into a pane that is actively processing a turn (BL-137 misfire guard)', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp);
  const fake = installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: '  auto mode on · esc to interrupt' },
  ]);
  try {
    const result = respawnAgent(tmp, 'coder');
    assert.equal(result.success, false);
    // BL-147: callers that bound automatic respawn attempts (wedgedRespawn's
    // maxRecoveryAttempts) key off this flag to tell "never touched, not
    // stuck" apart from a real failed attempt - without it a busy pane would
    // wrongly consume the bound and could escalate to needs-human.
    assert.equal(result.skippedBusy, true);
    assert.match(result.message, /actively processing|esc to interrupt/i);
    // BL-207: a deliberate safety skip is not a backend failure to
    // categorize - no category assigned.
    assert.equal(result.category, undefined);
    const sendCalls = fake.calls().filter((args) => args.includes('send-keys'));
    assert.equal(sendCalls.length, 0, 'must never type into a pane that is actively processing a turn');
    const respawnCalls = fake.calls().filter((args) => args.includes('respawn-pane'));
    assert.equal(respawnCalls.length, 0, 'must never force-kill a pane that is actively processing a turn');
  } finally {
    fake.restore();
  }
});

test('respawnAgent types the launch command in literal mode, not tmux key-name mode', () => {
  const tmp = mkTmp();
  const { script } = writeRespawnState(tmp);
  const fake = installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
  ]);
  try {
    respawnAgent(tmp, 'coder');
    const sendCalls = fake.calls().filter((args) => args.includes('send-keys'));
    const literalCall = sendCalls.find((args) => args.some((a) => a.includes(`bash ${script}`)));
    assert.ok(
      literalCall.includes('-l'),
      'the launch command must be typed literally (-l), not interpreted as tmux key names'
    );
  } finally {
    fake.restore();
  }
});

test('respawnAgent never sends a follow-up Enter after send-keys itself fails at the transport level', () => {
  // respawnAgent's own typeFailure tracking already reports the right
  // result even if the sendLiteral closure's return value were wrong (it is
  // set as a side effect before returning), so this specifically pins down
  // the closure's return value by checking the retry loop was never
  // entered at all - no second send-keys ("Enter") call after the failed
  // literal-text one.
  const tmp = mkTmp();
  writeRespawnState(tmp);
  const fake = installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'send-keys', exitCode: 1, stderr: 'no such session' },
  ]);
  try {
    respawnAgent(tmp, 'coder');
    const sendKeysCalls = fake.calls().filter((args) => args.includes('send-keys'));
    assert.equal(sendKeysCalls.length, 1, 'a transport-level send failure must abort before any Enter/retry is attempted');
  } finally {
    fake.restore();
  }
});

test('respawnAgent falls back to reporting the exit code when send-keys fails with no stderr/stdout', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp);
  const fake = installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'send-keys', exitCode: 17 },
  ]);
  try {
    const result = respawnAgent(tmp, 'coder');
    assert.equal(result.success, false);
    assert.match(result.message, /exit 17/);
  } finally {
    fake.restore();
  }
});

test('respawnAgent discards capture-pane output when the capture itself failed, never mistaking it for real pending text', () => {
  // A failed capture-pane call can still write stray text to stdout (e.g.
  // tmux error banners). If that text were used anyway, it could be
  // misread as an already-pending instruction, and respawnAgent would skip
  // typing the launch command entirely, believing it just needs to recover
  // something already there.
  const tmp = mkTmp();
  const { script } = writeRespawnState(tmp);
  const fake = installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
    { subcommand: 'capture-pane', exitCode: 1, stdout: `❯ bash ${script}`, stderr: 'no such pane' },
  ]);
  try {
    respawnAgent(tmp, 'coder');
    const sendCalls = fake.calls().filter((args) => args.includes('send-keys'));
    assert.ok(
      sendCalls.some((args) => args.join(' ').includes(`bash ${script}`)),
      'must still type the launch command - a failed capture must never be read as already-pending text'
    );
  } finally {
    fake.restore();
  }
});

test('respawnAgent falls back to reporting the exit code when the forced pane respawn fails with no stderr/stdout', () => {
  const tmp = mkTmp();
  const { script } = writeRespawnState(tmp);
  const fake = installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: `❯ bash ${script}` },
    { subcommand: 'respawn-pane', exitCode: 23 },
  ]);
  try {
    const result = respawnAgent(tmp, 'coder');
    assert.equal(result.success, false);
    assert.match(result.message, /exit 23/);
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
  assert.match(result.stderr, /150ms/, 'must report the timeout actually given to runCommand, not the default');
});

test('runCommand applies a bounded default timeout', () => {
  assert.ok(Number.isFinite(DEFAULT_RUN_COMMAND_TIMEOUT_MS));
  assert.ok(DEFAULT_RUN_COMMAND_TIMEOUT_MS >= 1_000, 'must not starve slow-but-fine tmux calls');
  assert.ok(DEFAULT_RUN_COMMAND_TIMEOUT_MS <= 15_000, 'must be far below "forever"');
});

// --- BL-104: runCommand complexity extraction. isTimedOut and
//     shapeRunResult are pure and unit-tested directly through this seam,
//     independent of an actual spawnSync call. ---

test('isTimedOut is false when there is no spawn error', () => {
  assert.equal(isTimedOut(undefined), false);
});

test('isTimedOut is true only for an ETIMEDOUT error code', () => {
  assert.equal(isTimedOut({ code: 'ETIMEDOUT' }), true);
  assert.equal(isTimedOut({ code: 'ENOENT' }), false);
});

test('shapeRunResult appends the timeout message and forces exitCode 1 when timed out', () => {
  const shaped = shapeRunResult(
    { error: { code: 'ETIMEDOUT' }, stdout: '', stderr: 'partial output', status: null },
    'sleep',
    150
  );
  assert.match(shaped.stderr, /partial output/);
  assert.match(shaped.stderr, /sleep timed out after 150ms/);
  assert.equal(shaped.exitCode, 1);
});

test('shapeRunResult trims stdout/stderr and passes through the exit code when not timed out', () => {
  const shaped = shapeRunResult(
    { error: undefined, stdout: 'ok\n', stderr: '  \n', status: 3 },
    'tmux',
    5000
  );
  assert.equal(shaped.stdout, 'ok');
  assert.equal(shaped.stderr, '');
  assert.equal(shaped.exitCode, 3);
});

test('shapeRunResult defaults exitCode to 1 when status is null and not timed out', () => {
  const shaped = shapeRunResult({ error: undefined, stdout: '', stderr: '', status: null }, 'tmux', 5000);
  assert.equal(shaped.exitCode, 1);
});

test('shapeRunResult trims only trailing whitespace, not leading', () => {
  const shaped = shapeRunResult({ error: undefined, stdout: '  ok  ', stderr: '  oops  ', status: 0 }, 'tmux', 5000);
  assert.equal(shaped.stdout, '  ok');
  assert.equal(shaped.stderr, '  oops');
});

test('shapeRunResult treats a null stdout/stderr as empty, not a placeholder string', () => {
  const shaped = shapeRunResult({ error: undefined, stdout: null, stderr: null, status: 0 }, 'tmux', 5000);
  assert.equal(shaped.stdout, '');
  assert.equal(shaped.stderr, '');
});

test('shapeRunResult appends the timeout message with no leading separator when stderr was empty', () => {
  const shaped = shapeRunResult({ error: { code: 'ETIMEDOUT' }, stdout: '', stderr: '', status: null }, 'sleep', 150);
  assert.equal(shaped.stderr, 'sleep timed out after 150ms');
});

test('shapeRunResult joins pre-existing stderr and the timeout message with a newline', () => {
  const shaped = shapeRunResult({ error: { code: 'ETIMEDOUT' }, stdout: '', stderr: 'partial output', status: null }, 'sleep', 150);
  assert.equal(shaped.stderr, 'partial output\nsleep timed out after 150ms');
});
