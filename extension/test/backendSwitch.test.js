const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AVAILABLE_CLAUDE_MODELS, readCurrentModel, switchRoleModel } = require('../out/swarm/backendSwitch');
const { installExecutable } = require('./helpers/sharedBin');
const { installFakeTmux } = require('./helpers/fakeTmux');

// BL-235 (M5, narrow slice): switching a claude-backed tile's model rewrites
// only that role's settings-file "model" field (preserving every other
// field) and respawns only that role's pane via the existing respawnAgent -
// swarmforge.conf and the launch script itself are never touched.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-backend-switch-'));
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

test('switchRoleModel rewrites the model field, preserving every other field unchanged', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'coder', { model: 'claude-sonnet-5', effortLevel: 'high', permissions: { defaultMode: 'bypassPermissions' } });
  const fake = installFakeTmux(successfulRespawnRules());
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
  const fake = installFakeTmux(successfulRespawnRules());
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
  const fake = installFakeTmux(successfulRespawnRules());
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
  const fake = installFakeTmux(successfulRespawnRules());
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
