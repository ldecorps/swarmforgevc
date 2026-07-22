const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installInProcessTmux } = require('./helpers/fakeTmux');
const {
  captureResidentPaneLive,
  captureMonoRouterLiveScreen,
  captureLiveScreenPanes,
  orderLiveScreenRoles,
  liveScreenPaneId,
  liveScreenPaneLabel,
} = require('../out/bridge/residentPaneLive');

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

test('captureResidentPaneLive falls back to roster role when pane banner scrolled away', () => {
  const tmp = mkTmpDir('sfvc-resident-pane-live-');
  const paneText = seedResidentPaneFixture(tmp, {
    role: 'coder',
    model: 'claude-sonnet-5',
    paneText: 'Running command...\n$ git merge origin/main',
  });
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
  } finally {
    fake.restore();
  }
});

test('captureResidentPaneLive reads model from launch script when claude settings are absent', () => {
  const tmp = mkTmpDir('sfvc-resident-pane-live-');
  const stateDir = path.join(tmp, '.swarmforge');
  const launchDir = path.join(stateDir, 'launch');
  fs.mkdirSync(launchDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), '1\tcoder\tswarmforge-coder\tCoder\tclaude\n');
  fs.writeFileSync(
    path.join(launchDir, 'coder.sh'),
    '#!/bin/bash\naider --model openai/qwen3.7-plus --openai-api-base https://example/v1\n'
  );
  const paneText = 'SwarmForge Coder\n> working';
  const fake = installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: paneText },
  ]);
  try {
    const snap = captureResidentPaneLive(tmp);
    assert.ok(snap);
    assert.equal(snap.modelLabel, 'Qwen 3.7 Plus');
  } finally {
    fake.restore();
  }
});

test('captureResidentPaneLive includes held ticket metadata when the role has an in_process claim', () => {
  const tmp = mkTmpDir('sfvc-resident-pane-live-');
  const worktree = path.join(tmp, 'coder-wt');
  const stateDir = path.join(tmp, '.swarmforge');
  const launchDir = path.join(stateDir, 'launch');
  fs.mkdirSync(path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(launchDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), `1\tcoder\tswarmforge-coder\tCoder\tclaude\n`);
  fs.writeFileSync(
    path.join(stateDir, 'roles.tsv'),
    `coder\tcoder-wt\t${worktree}\tswarmforge-coder\tCoder\tclaude\n`
  );
  fs.writeFileSync(path.join(launchDir, 'coder.claude-settings.json'), JSON.stringify({ model: 'claude-sonnet-5' }));
  fs.writeFileSync(
    path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process', '00_test.handoff'),
    'task: BL-529-ticket-branch-mismatch-guard\ndequeued_at: 2026-07-21T00:00:00Z\n\nbody\n'
  );
  fs.writeFileSync(
    path.join(tmp, 'backlog', 'active', 'BL-529-ticket-branch-mismatch-guard.yaml'),
    'id: BL-529\ntitle: "Pre-turn guard: worktree branch must match claimed ticket"\n'
  );
  const paneText = 'SwarmForge Architect\n> working';
  const fake = installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: paneText },
  ]);
  try {
    const snap = captureResidentPaneLive(tmp);
    assert.ok(snap);
    assert.equal(snap.ticketId, 'BL-529');
    assert.equal(snap.ticketTitle, 'Pre-turn guard: worktree branch must match claimed ticket');
  } finally {
    fake.restore();
  }
});

test('captureMonoRouterLiveScreen returns resident and coordinator panes', () => {
  const tmp = mkTmpDir('sfvc-mono-live-screen-');
  const worktree = path.join(tmp, 'coder-wt');
  const stateDir = path.join(tmp, '.swarmforge');
  const launchDir = path.join(stateDir, 'launch');
  fs.mkdirSync(path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(launchDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), `1\tcoder\tswarmforge-coder\tCoder\tclaude\n`);
  fs.writeFileSync(
    path.join(stateDir, 'roles.tsv'),
    `coder\tcoder-wt\t${worktree}\tswarmforge-coder\tCoder\tclaude\n`
  );
  fs.writeFileSync(path.join(launchDir, 'coder.claude-settings.json'), JSON.stringify({ model: 'claude-sonnet-5' }));
  fs.writeFileSync(
    path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process', '00_test.handoff'),
    'task: BL-529-ticket-branch-mismatch-guard\ndequeued_at: 2026-07-21T10:00:00Z\n\nbody\n'
  );
  fs.writeFileSync(
    path.join(tmp, 'backlog', 'active', 'BL-529-ticket-branch-mismatch-guard.yaml'),
    'id: BL-529\ntitle: "Pre-turn guard: worktree branch must match claimed ticket"\n'
  );
  const paneText = seedResidentPaneFixture(tmp, { role: 'coder', model: 'claude-sonnet-5' });
  const fake = installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: paneText },
  ]);
  try {
    const screen = captureMonoRouterLiveScreen(tmp);
    assert.equal(screen.available, true);
    assert.equal(screen.resident.available, true);
    assert.match(screen.resident.header ?? '', /^Resident:/);
    assert.doesNotMatch(screen.resident.header ?? '', /swarmforge-coder/);
    assert.ok(screen.resident.claimEnteredAgo?.startsWith('entered '));
    assert.ok(screen.resident.claimEnteredAtMs);
    assert.equal(typeof screen.coordinator.available, 'boolean');
    assert.ok(screen.coordinator);
    assert.ok(Array.isArray(screen.panes));
    assert.ok(screen.panes.length >= 1);
    assert.equal(screen.panes[0].id, 'resident');
    assert.equal(screen.panes[0].label, 'Resident');
  } finally {
    fake.restore();
  }
});

test('orderLiveScreenRoles sorts coordinator first then pipeline chain', () => {
  const roles = orderLiveScreenRoles([
    { role: 'QA', session: 's', displayName: 'QA', index: 1, agent: 'claude' },
    { role: 'coder', session: 's', displayName: 'Coder', index: 2, agent: 'claude' },
    { role: 'coordinator', session: 's', displayName: 'Coordinator', index: 3, agent: 'claude' },
    { role: 'specifier', session: 's', displayName: 'Specifier', index: 4, agent: 'claude' },
  ]);
  assert.deepEqual(
    roles.map((r) => r.role),
    ['coordinator', 'specifier', 'coder', 'QA']
  );
});

test('liveScreenPaneId labels mono-router coder pane as resident', () => {
  const coder = { role: 'coder', session: 's', displayName: 'Coder', index: 1, agent: 'claude' };
  assert.equal(liveScreenPaneId(coder, true), 'resident');
  assert.equal(liveScreenPaneLabel(coder, true), 'Resident');
  assert.equal(liveScreenPaneId(coder, false), 'coder');
  assert.equal(liveScreenPaneLabel(coder, false), 'Coder');
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
