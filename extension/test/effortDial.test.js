const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  EFFORT_LEVELS,
  EFFORT_ORDINAL,
  suggestRoleEffort,
  suggestEffortForRoles,
  hasEffortSetting,
  readCurrentEffort,
  switchRoleEffort,
} = require('../out/swarm/effortDial');
const { installExecutable } = require('./helpers/sharedBin');
const { installFakeTmux } = require('./helpers/fakeTmux');

// BL-236 ("Suggest" tier only): a per-role effort suggestion (advisory,
// side-effect-free) plus a manual dial reusing BL-235's exact settings-file
// rewrite + respawn mechanism (effortLevel instead of model).

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-effort-dial-'));
}

function settingsPath(tmp, role) {
  return path.join(tmp, '.swarmforge', 'launch', `${role}.claude-settings.json`);
}

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

// ── suggest-effort-per-role-01 ─────────────────────────────────────────

test('suggestRoleEffort suggests higher effort for a design-heavy role than a mechanical one', () => {
  const architect = suggestRoleEffort('architect');
  const cleaner = suggestRoleEffort('cleaner');
  assert.ok(
    EFFORT_ORDINAL[architect.suggestedEffort] > EFFORT_ORDINAL[cleaner.suggestedEffort],
    `expected architect's suggestion (${architect.suggestedEffort}) to outrank cleaner's (${cleaner.suggestedEffort})`
  );
});

test('suggestRoleEffort suggests higher effort for specifier than documenter, with a one-line rationale each', () => {
  const specifier = suggestRoleEffort('specifier');
  const documenter = suggestRoleEffort('documenter');
  assert.ok(EFFORT_ORDINAL[specifier.suggestedEffort] > EFFORT_ORDINAL[documenter.suggestedEffort]);
  assert.ok(specifier.rationale.length > 0 && !specifier.rationale.includes('\n'), 'rationale must be a single line');
  assert.ok(documenter.rationale.length > 0 && !documenter.rationale.includes('\n'), 'rationale must be a single line');
});

test('suggestEffortForRoles returns one suggestion per role, in order', () => {
  const suggestions = suggestEffortForRoles(['architect', 'cleaner', 'documenter']);
  assert.deepEqual(suggestions.map((s) => s.role), ['architect', 'cleaner', 'documenter']);
});

test('an unrecognized role name still gets a suggestion (neutral tier), never throws', () => {
  const suggestion = suggestRoleEffort('some-custom-role');
  assert.ok(EFFORT_LEVELS.includes(suggestion.suggestedEffort));
});

// ── advisory-not-applied-02 ─────────────────────────────────────────────

test('suggestRoleEffort has no side effects - it never touches disk or respawns anything', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'architect', { model: 'claude-sonnet-5', effortLevel: 'high' });
  const before = fs.readFileSync(settingsPath(tmp, 'architect'), 'utf8');

  suggestRoleEffort('architect');

  assert.equal(fs.readFileSync(settingsPath(tmp, 'architect'), 'utf8'), before, 'a suggestion must never rewrite the settings file');
});

// ── manual-effort-dial-03 ────────────────────────────────────────────────

test('switchRoleEffort rewrites effortLevel, preserving every other field, and respawns the role', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'coder', { model: 'claude-sonnet-5', effortLevel: 'low', permissions: { defaultMode: 'bypassPermissions' } });
  const fake = installFakeTmux(successfulRespawnRules());
  try {
    const result = switchRoleEffort(tmp, 'coder', 'xhigh');
    assert.equal(result.success, true);
    const written = JSON.parse(fs.readFileSync(settingsPath(tmp, 'coder'), 'utf8'));
    assert.deepEqual(written, { model: 'claude-sonnet-5', effortLevel: 'xhigh', permissions: { defaultMode: 'bypassPermissions' } });
  } finally {
    fake.restore();
  }
});

test('switchRoleEffort never writes to swarmforge.conf', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'coder', { effortLevel: 'low' });
  const confPath = path.join(tmp, 'swarmforge', 'swarmforge.conf');
  fs.mkdirSync(path.dirname(confPath), { recursive: true });
  const confBefore = 'window coder claude coder --effort low\n';
  fs.writeFileSync(confPath, confBefore);
  const fake = installFakeTmux(successfulRespawnRules());
  try {
    switchRoleEffort(tmp, 'coder', 'xhigh');
    assert.equal(fs.readFileSync(confPath, 'utf8'), confBefore, 'swarmforge.conf must be byte-for-byte unchanged');
  } finally {
    fake.restore();
  }
});

test('switchRoleEffort rejects an unknown effort level without touching the settings file or tmux', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'coder', { effortLevel: 'low' });
  const fake = installFakeTmux(successfulRespawnRules());
  try {
    const result = switchRoleEffort(tmp, 'coder', 'ludicrous');
    assert.equal(result.success, false);
    assert.match(result.message, /Unknown effort/);
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath(tmp, 'coder'), 'utf8')), { effortLevel: 'low' });
    assert.deepEqual(fake.calls(), [], 'an invalid effort must never reach tmux at all');
  } finally {
    fake.restore();
  }
});

// ── effort-unsupported-04 ─────────────────────────────────────────────────

test('hasEffortSetting is true only for the claude backend', () => {
  assert.equal(hasEffortSetting('claude'), true);
  assert.equal(hasEffortSetting('codex'), false);
  assert.equal(hasEffortSetting('copilot'), false);
  assert.equal(hasEffortSetting('aider'), false);
  assert.equal(hasEffortSetting('grok'), false);
});

test('readCurrentEffort returns undefined when the role has no settings file yet (non-claude backend)', () => {
  const tmp = mkTmp();
  assert.equal(readCurrentEffort(tmp, 'coder'), undefined);
});

test('switchRoleEffort fails cleanly for a role with no settings file, sending no unsupported argument', () => {
  const tmp = mkTmp();
  writeRespawnState(tmp, 'coder', undefined);
  const result = switchRoleEffort(tmp, 'coder', 'high');
  assert.equal(result.success, false);
  assert.match(result.message, /No claude settings file found/);
});
