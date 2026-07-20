const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installInProcessTmux } = require('./helpers/fakeTmux');
const { captureResidentPaneLive } = require('../out/bridge/residentPaneLive');

function seedResidentPaneFixture(tmp, { role = 'coder', paneText, model = 'claude-sonnet-5' } = {}) {
  const stateDir = path.join(tmp, '.swarmforge');
  const launchDir = path.join(stateDir, 'launch');
  fs.mkdirSync(launchDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  fs.writeFileSync(
    path.join(stateDir, 'sessions.tsv'),
    `1\t${role}\tswarmforge-${role}\tCoder\tclaude\n`
  );
  if (model) {
    fs.writeFileSync(path.join(launchDir, `${role}.claude-settings.json`), JSON.stringify({ model }));
  }
  return paneText ?? `SwarmForge Coder\n> working`;
}

test('captureResidentPaneLive includes modelLabel from the role settings file', () => {
  const tmp = mkTmpDir('sfvc-resident-pane-live-');
  const paneText = seedResidentPaneFixture(tmp, { role: 'coder', model: 'claude-sonnet-5' });
  const fake = installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: paneText },
  ]);
  try {
    const snap = captureResidentPaneLive(tmp);
    assert.ok(snap);
    assert.equal(snap.roleLabel, 'Coder');
    assert.equal(snap.modelLabel, 'Sonnet 4.6');
    assert.match(snap.sessionTarget, /^swarmforge-coder:/);
  } finally {
    fake.restore();
  }
});

test('captureResidentPaneLive omits modelLabel when settings file is absent', () => {
  const tmp = mkTmpDir('sfvc-resident-pane-live-');
  const paneText = seedResidentPaneFixture(tmp, { role: 'coder', model: null });
  const fake = installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: paneText },
  ]);
  try {
    const snap = captureResidentPaneLive(tmp);
    assert.ok(snap);
    assert.equal(snap.modelLabel, undefined);
  } finally {
    fake.restore();
  }
});
