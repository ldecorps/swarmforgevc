const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AVAILABLE_CLAUDE_MODELS, readCurrentModel, readRoleModelId, switchRoleModel } = require('../out/swarm/backendSwitch');
const { installExecutable } = require('./helpers/sharedBin');
const { installInProcessTmux } = require('./helpers/fakeTmux');

// BL-235 (M5, narrow slice): switching a claude-backed tile's model rewrites
// only that role's settings-file "model" field (preserving every other
// field) and respawns only that role's pane via the existing respawnAgent -
// swarmforge.conf and the launch script itself are never touched.

function mkTmp() {
  return mkTmpDir('sfvc-backend-switch-');
}

function settingsPath(tmp, role) {
  return path.join(tmp, '.swarmforge', 'launch', `${role}.claude-settings.json`);
}

// Mirrors tmuxClient.test.js's own writeRespawnState fixture - a minimal
// live-swarm state respawnAgent needs to actually respawn a role's pane.
function writeRespawnState(tmp, role, settings) {
  const stateDir = path.join(tmp, '.swarmforge');
  const launchDir = path.join(stateDir, 'launch');
  fs.mkdirSync(launchDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), `1\t${role}\tswarmforge-${role}\tCoder\tclaude\n`);
  installExecutable(path.join(launchDir, `${role}.sh`), '#!/bin/bash\ntrue\n');
  if (settings !== undefined) {
    fs.writeFileSync(settingsPath(tmp, role), JSON.stringify(settings));
  }
}

function successfulRespawnRules() {
  return [
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
  ];
}

test('AVAILABLE_CLAUDE_MODELS reuses the same catalog pricingTable.ts already carries', () => {
  const { PRICING_TABLE } = require('../out/metrics/pricingTable');
  assert.deepEqual([...AVAILABLE_CLAUDE_MODELS], Object.keys(PRICING_TABLE));
});

test('readCurrentModel reads the model field from the role\'s own settings file', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'coder', { model: 'claude-sonnet-5', effortLevel: 'high' });
  assert.equal(readCurrentModel(tmp, 'coder'), 'claude-sonnet-5');
});

test('readCurrentModel returns undefined when no settings file exists yet', () => {
  const tmp = mkTmp();
  assert.equal(readCurrentModel(tmp, 'coder'), undefined);
});

test('readRoleModelId falls back to swarmforge.conf when settings file is absent', () => {
  const tmp = mkTmp();
  fs.mkdirSync(path.join(tmp, 'swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'swarmforge', 'swarmforge.conf'),
    'window coder claude coder --model claude-sonnet-5\n'
  );
  assert.equal(readRoleModelId(tmp, 'coder'), 'claude-sonnet-5');
});

test('readRoleModelId reads --model from an unrecognized-agent launch script via the whole-script fallback (BL-1858 D1)', () => {
  const tmp = mkTmp();
  fs.mkdirSync(path.join(tmp, '.swarmforge', 'launch'), { recursive: true });
  // No known agent token (cursor-agent/copilot/codex/aider/gemini/vibe/grok/
  // qwen/claude) anywhere in this script, so detectLaunchScriptAgent finds
  // none and findAgentCommandLine has no agent line to search for -
  // readLaunchScriptModel must still fall back to matching --model over the
  // whole script rather than losing the value.
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'launch', 'coder.sh'),
    '#!/bin/bash\nsome-future-cli --model future-model-x --flag value\n'
  );
  assert.equal(readRoleModelId(tmp, 'coder'), 'future-model-x');
});

test('readRoleModelId prefers launch script --model over swarmforge.conf for aider roles', () => {
  const tmp = mkTmp();
  const launchDir = path.join(tmp, '.swarmforge', 'launch');
  fs.mkdirSync(launchDir, { recursive: true });
  fs.writeFileSync(
    path.join(launchDir, 'coder.sh'),
  '#!/bin/bash\naider --model openai/qwen3.7-plus --openai-api-base https://example/v1\n'
  );
  fs.mkdirSync(path.join(tmp, 'swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'swarmforge', 'swarmforge.conf'),
    'window coder claude coder --model claude-sonnet-5\n'
  );
  assert.equal(readRoleModelId(tmp, 'coder'), 'openai/qwen3.7-plus');
});

test('readRoleModelId reads the qwen model from the agent line, not the snapshot CLI line (BL-1858 D1)', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'coder', { model: 'claude-sonnet-5' });
  // Real two-line launch shape since BL-1850: the local-seat settings
  // snapshot CLI line (quoted --model tag) precedes the qwen command line.
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'launch', 'coder.sh'),
    [
      '#!/bin/bash',
      "bb '/tmp/scripts/local_seat_settings_snapshot_cli.bb' '/tmp/wt' --seat 'coder' --model 'qwen2.5-coder-14b-q5km' --endpoint-url 'http://127.0.0.1:8080/v1' --card '/tmp/card.md' --worktree '/tmp/wt' >/dev/null 2>>'/tmp/state/launch/coder.seat-settings.log' || true",
      'qwen --auth-type openai -y --model qwen2.5-coder-14b-q5km -i "Use read_file now to read \'/tmp/card.md\' - it is your card, and obey every instruction in it. Its loop starts by running ./swarmforge/scripts/ready_for_next.sh (it is NOT at the worktree root)."',
      '',
    ].join('\n')
  );
  assert.equal(readRoleModelId(tmp, 'coder'), 'qwen2.5-coder-14b-q5km');
});

test('readRoleModelId shows no model when a non-Claude launch script names no --model (BL-1858 D3)', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'coder', { model: 'claude-sonnet-5' });
  // Real launch shape: the snapshot CLI line carries a quoted --model tag,
  // the qwen agent line carries none. The stale claude settings file must
  // not win the tile label - the seat runs its agent's default model.
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'launch', 'coder.sh'),
    [
      '#!/bin/bash',
      "bb '/tmp/scripts/local_seat_settings_snapshot_cli.bb' '/tmp/wt' --seat 'coder' --model 'qwen2.5-coder-14b-q5km' --endpoint-url 'http://127.0.0.1:8080/v1' --card '/tmp/card.md' --worktree '/tmp/wt' >/dev/null 2>>'/tmp/state/launch/coder.seat-settings.log' || true",
      'qwen --auth-type openai -y -i "Use read_file now to read \'/tmp/card.md\' - it is your card, and obey every instruction in it. Its loop starts by running ./swarmforge/scripts/ready_for_next.sh (it is NOT at the worktree root)."',
      '',
    ].join('\n')
  );
  assert.equal(readRoleModelId(tmp, 'coder'), undefined);
});

test('readRoleModelId falls back to swarmforge.conf when a non-Claude launch script names no --model (BL-1858 D3)', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'coder', { model: 'claude-sonnet-5' });
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'launch', 'coder.sh'),
    '#!/bin/bash\nqwen --auth-type openai -y -i "go"\n'
  );
  fs.mkdirSync(path.join(tmp, 'swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'swarmforge', 'swarmforge.conf'),
    'window coder claude coder --model conf-fallback-model\n'
  );
  // The stale claude settings file (claude-sonnet-5) must still lose to the
  // conf fallback - prefersLaunchOverClaudeSettings skips it even when the
  // launch script itself names no model.
  assert.equal(readRoleModelId(tmp, 'coder'), 'conf-fallback-model');
});

test('readRoleModelId reads a double-quoted --model tag from the agent line (BL-1858 D1)', () => {
  const tmp = mkTmp();
  fs.mkdirSync(path.join(tmp, '.swarmforge', 'launch'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'launch', 'coder.sh'),
    '#!/bin/bash\naider --model "openai/qwen3.7-plus" --openai-api-base https://example/v1\n'
  );
  assert.equal(readRoleModelId(tmp, 'coder'), 'openai/qwen3.7-plus');
});

test('readRoleModelId takes the FIRST agent-line --model when the agent pattern matches more than one line (BL-1858 D1)', () => {
  const tmp = mkTmp();
  fs.mkdirSync(path.join(tmp, '.swarmforge', 'launch'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'launch', 'coder.sh'),
    [
      '#!/bin/bash',
      'aider --model first-model --openai-api-base https://example/v1',
      'aider --model second-model --openai-api-base https://example/v1',
      '',
    ].join('\n')
  );
  assert.equal(readRoleModelId(tmp, 'coder'), 'first-model');
});

test('readRoleModelId prefers aider launch script over stale claude settings file', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'coder', { model: 'claude-sonnet-5' });
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'launch', 'coder.sh'),
    '#!/bin/bash\naider --model openai/qwen3.7-plus --openai-api-base https://example/v1\n'
  );
  assert.equal(readRoleModelId(tmp, 'coder'), 'openai/qwen3.7-plus');
});

test('readRoleModelId prefers cursor-agent launch script over stale claude settings file', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'coder', { model: 'claude-opus-5' });
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'launch', 'coder.sh'),
    "#!/bin/bash\ncursor-agent --model auto --force --trust --workspace '/tmp/wt'\n"
  );
  assert.equal(readRoleModelId(tmp, 'coder'), 'cursor/auto');
});

test('readRoleModelId namespaces a copilot launch script\'s bare auto model to copilot/auto', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'coder', { model: 'claude-opus-5' });
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'launch', 'coder.sh'),
    '#!/bin/bash\ncopilot --model auto\n'
  );
  assert.equal(readRoleModelId(tmp, 'coder'), 'copilot/auto');
});

test('readRoleModelId leaves a bare auto model unnamespaced for an agent outside the auto-alias set', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'coder', { model: 'claude-opus-5' });
  fs.writeFileSync(
    path.join(tmp, '.swarmforge', 'launch', 'coder.sh'),
    '#!/bin/bash\ngemini --model auto\n'
  );
  assert.equal(readRoleModelId(tmp, 'coder'), 'auto');
});

test('switchRoleModel rewrites the model field, preserving every other field unchanged', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'coder', { model: 'claude-sonnet-5', effortLevel: 'high', permissions: { defaultMode: 'bypassPermissions' } });
  const fake = installInProcessTmux(successfulRespawnRules());
  try {
    const result = switchRoleModel(tmp, 'coder', 'claude-opus-4-8');
    assert.equal(result.success, true);
    const written = JSON.parse(fs.readFileSync(settingsPath(tmp, 'coder'), 'utf8'));
    assert.deepEqual(written, { model: 'claude-opus-4-8', effortLevel: 'high', permissions: { defaultMode: 'bypassPermissions' } });
  } finally {
    fake.restore();
  }
});

test('switchRoleModel respawns only the requested role\'s pane, never any other role', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'coder', { model: 'claude-sonnet-5' });
  // A second role's own state must remain untouched by a switch on "coder".
  fs.mkdirSync(path.join(tmp, '.swarmforge', 'launch'), { recursive: true });
  fs.writeFileSync(settingsPath(tmp, 'cleaner'), JSON.stringify({ model: 'claude-sonnet-5' }));
  fs.appendFileSync(
    path.join(tmp, '.swarmforge', 'sessions.tsv'),
    '2\tcleaner\tswarmforge-cleaner\tCleaner\tclaude\n'
  );
  const fake = installInProcessTmux(successfulRespawnRules());
  try {
    switchRoleModel(tmp, 'coder', 'claude-opus-4-8');
    const cleanerSettings = JSON.parse(fs.readFileSync(settingsPath(tmp, 'cleaner'), 'utf8'));
    assert.deepEqual(cleanerSettings, { model: 'claude-sonnet-5' }, 'switching coder must not touch cleaner\'s settings file');
    const sendCalls = fake.calls().filter((args) => args.includes('send-keys'));
    assert.ok(
      sendCalls.every((args) => args[args.indexOf('-t') + 1] === 'swarmforge-coder:2.1'),
      'must only target the switched role\'s pane'
    );
  } finally {
    fake.restore();
  }
});

test('switchRoleModel never writes to swarmforge.conf', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'coder', { model: 'claude-sonnet-5' });
  const confPath = path.join(tmp, 'swarmforge', 'swarmforge.conf');
  fs.mkdirSync(path.dirname(confPath), { recursive: true });
  const confBefore = 'window coder claude coder --model claude-sonnet-5\n';
  fs.writeFileSync(confPath, confBefore);
  const fake = installInProcessTmux(successfulRespawnRules());
  try {
    switchRoleModel(tmp, 'coder', 'claude-opus-4-8');
    assert.equal(fs.readFileSync(confPath, 'utf8'), confBefore, 'swarmforge.conf must be byte-for-byte unchanged');
  } finally {
    fake.restore();
  }
});

test('switchRoleModel rejects an unknown model without touching the settings file or tmux', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'coder', { model: 'claude-sonnet-5' });
  const fake = installInProcessTmux(successfulRespawnRules());
  try {
    const result = switchRoleModel(tmp, 'coder', 'gpt-nope');
    assert.equal(result.success, false);
    assert.match(result.message, /Unknown model/);
    const stillOriginal = JSON.parse(fs.readFileSync(settingsPath(tmp, 'coder'), 'utf8'));
    assert.deepEqual(stillOriginal, { model: 'claude-sonnet-5' });
    assert.deepEqual(fake.calls(), [], 'an invalid model must never reach tmux at all');
  } finally {
    fake.restore();
  }
});

test('switchRoleModel fails cleanly when the role has no settings file yet (not a claude-backed/launched role)', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'coder', undefined);
  const result = switchRoleModel(tmp, 'coder', 'claude-opus-4-8');
  assert.equal(result.success, false);
  assert.match(result.message, /No claude settings file found/);
});
