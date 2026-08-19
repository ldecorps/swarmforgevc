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
  clearResidentPaneLiveCache,
  RESIDENT_PANE_CACHE_TTL_MS,
} = require('../out/bridge/residentPaneLive');

// BL-929: isMonoRouterLayout resolves its config-based signal via
// resolveSwarmConfigPath(), which under `node --test`/Vitest (no `vscode`
// module) reduces to reading process.env.SWARMFORGE_CONFIG. A test that
// depends on isMonoRouterLayout's outcome must control that var explicitly
// rather than letting it inherit whatever the host shell happens to have
// set (same hazard the engineering article's shell tests already guard
// with `env -u SWARMFORGE_CONFIG` - see this project's Test Speed and
// Isolation rule). Vitest's own envRestoreGuardSetup.js still fails the
// test if this leaves the var different from how it found it, so restore
// is not optional even here.
function withSwarmforgeConfig(configPath, fn) {
  const saved = process.env.SWARMFORGE_CONFIG;
  if (configPath === undefined) {
    delete process.env.SWARMFORGE_CONFIG;
  } else {
    process.env.SWARMFORGE_CONFIG = configPath;
  }
  try {
    fn();
  } finally {
    if (saved === undefined) {
      delete process.env.SWARMFORGE_CONFIG;
    } else {
      process.env.SWARMFORGE_CONFIG = saved;
    }
  }
}

const FULL_PACK_ROLES = ['coordinator', 'specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

// BL-929: a standing full pack - 8 live sessions, the mono-router marker
// present and pointed at 'coder' (the exact 2026-08-18 incident shape: the
// marker is actively rewritten under a full pack, not merely stale). Pane
// text carries no `SwarmForge <Role>` banner, so resolveResidentRoleIdentity
// falls through to each pane's OWN roster displayName rather than a banner
// match - the fixture must not accidentally supply the very evidence
// (a role name in the text) the fix is supposed to make unnecessary.
function seedFullPackFixture(tmp, { withMarker = true } = {}) {
  const stateDir = path.join(tmp, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  const lines = FULL_PACK_ROLES.map(
    (role, i) => `${i + 1}\t${role}\tswarmforge-${role}\t${role === 'QA' ? 'QA' : role[0].toUpperCase() + role.slice(1)}\tclaude\n`
  ).join('');
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), lines);
  if (withMarker) {
    fs.writeFileSync(path.join(stateDir, 'mono-router-active-role'), 'coder');
  }
  return '$ some command\n> plain output, no role banner';
}

function seedFullPackFakeTmux(paneText) {
  return installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'has-session', exitCode: 0 },
    { subcommand: 'capture-pane', exitCode: 0, stdout: paneText },
  ]);
}

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
    assert.equal(snap.modelLabel, 'Sonnet 5');
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
    assert.equal(snap.modelLabel, 'Sonnet 5');
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
    withSwarmforgeConfig(undefined, () => {
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
      assert.equal(screen.monoRouterLayout, true);
    });
  } finally {
    fake.restore();
  }
});

// BL-929 invariant 1 (headline regression, the exact 2026-08-18 incident
// shape): the mono-router marker is present and actively points at 'coder',
// but 8 sessions are live - a standing full pack, not a rotation pack. No
// tile may be labelled Resident, and monoRouterLayout must read false.
test('BL-929: a live marker never turns a standing full pack into mono-router layout', () => {
  const tmp = mkTmpDir('sfvc-full-pack-marker-');
  const paneText = seedFullPackFixture(tmp, { withMarker: true });
  const fake = seedFullPackFakeTmux(paneText);
  try {
    withSwarmforgeConfig(undefined, () => {
      const panes = captureLiveScreenPanes(tmp);
      assert.equal(panes.length, FULL_PACK_ROLES.length);
      assert.ok(!panes.some((p) => p.id === 'resident'), 'no tile may be labelled Resident under a full pack');
      assert.ok(!panes.some((p) => p.label === 'Resident'));

      const screen = captureMonoRouterLiveScreen(tmp);
      assert.equal(screen.monoRouterLayout, false);
    });
  } finally {
    fake.restore();
  }
});

// BL-929 invariant 2 (headline regression): under the same full-pack +
// live-marker fixture, no tile other than the coder's own pane may carry
// the coder's identity - the exact 2026-08-18 reading was "SPECIFIER
// subtitled Coder on Sonnet 5".
test('BL-929: a live marker never leaks the coder role identity onto another tile', () => {
  const tmp = mkTmpDir('sfvc-full-pack-identity-leak-');
  const paneText = seedFullPackFixture(tmp, { withMarker: true });
  const fake = seedFullPackFakeTmux(paneText);
  try {
    withSwarmforgeConfig(undefined, () => {
      const panes = captureLiveScreenPanes(tmp);
      const specifierPane = panes.find((p) => p.id === 'specifier');
      assert.ok(specifierPane, 'expected a specifier tile in a full pack');
      assert.notEqual(specifierPane.pane.roleLabel, 'Coder');

      const coderPane = panes.find((p) => p.id === 'coder');
      assert.ok(coderPane);
      assert.equal(coderPane.pane.roleLabel, 'Coder');
    });
  } finally {
    fake.restore();
  }
});

// BL-929: the config signal must survive a full pack's launch window, when
// only 1-2 sessions have come up so far and the live-count fallback alone
// would misread this as mono-router (the documented flicker).
test('BL-929: the config signal keeps a full pack out of mono-router layout during its own launch flicker', () => {
  const tmp = mkTmpDir('sfvc-full-pack-launch-flicker-');
  const stateDir = path.join(tmp, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  // Only the coordinator + coder sessions are up so far - liveRoles.length
  // is 2, which the live-count fallback alone would read as mono-router.
  fs.writeFileSync(
    path.join(stateDir, 'sessions.tsv'),
    '1\tcoordinator\tswarmforge-coordinator\tCoordinator\tclaude\n2\tcoder\tswarmforge-coder\tCoder\tclaude\n'
  );
  const configPath = path.join(tmp, 'full-forge.conf');
  fs.writeFileSync(
    configPath,
    'config active_backlog_max_depth 3\nwindow specifier claude master\nwindow coder claude coder\n'
  );
  const fake = seedFullPackFakeTmux('$ some command\n> plain output, no role banner');
  try {
    withSwarmforgeConfig(configPath, () => {
      const panes = captureLiveScreenPanes(tmp);
      assert.ok(!panes.some((p) => p.id === 'resident'), 'the config signal must override the transient low session count');

      const screen = captureMonoRouterLiveScreen(tmp);
      assert.equal(screen.monoRouterLayout, false);
    });
  } finally {
    fake.restore();
  }
});

// BL-929: sanity check that the config signal correctly recognizes an
// actual rotation pack too (not just the standing-pack negative above).
test('BL-929: the config signal recognizes a real rotation (mono-router) pack', () => {
  const tmp = mkTmpDir('sfvc-mono-router-config-');
  const paneText = seedResidentPaneFixture(tmp, { role: 'coder', model: 'claude-sonnet-5' });
  const configPath = path.join(tmp, 'mono-router.conf');
  fs.writeFileSync(configPath, 'config active_backlog_max_depth 2\nconfig rotation router\nwindow coder claude coder\n');
  const fake = installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: paneText },
  ]);
  try {
    withSwarmforgeConfig(configPath, () => {
      const screen = captureMonoRouterLiveScreen(tmp);
      assert.equal(screen.monoRouterLayout, true);
      assert.equal(screen.panes[0]?.id, 'resident');
    });
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

function countCapturePaneCalls(fake) {
  return fake.calls().filter((args) => args.includes('capture-pane')).length;
}

// BL-881: overlapping /resident-pane polls within the TTL must share one
// synchronous walk rather than each paying a fresh tmux+filesystem capture.
test('captureMonoRouterLiveScreen shares one walk for repeated polls within the TTL', () => {
  const tmp = mkTmpDir('sfvc-mono-live-cache-');
  const paneText = seedResidentPaneFixture(tmp, { role: 'coder', model: 'claude-sonnet-5' });
  const fake = installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: paneText },
  ]);
  try {
    clearResidentPaneLiveCache();
    const t0 = 1_700_000_000_000;
    captureMonoRouterLiveScreen(tmp, t0);
    const callsAfterFirst = countCapturePaneCalls(fake);
    assert.ok(callsAfterFirst > 0);

    captureMonoRouterLiveScreen(tmp, t0 + 1000);
    assert.equal(countCapturePaneCalls(fake), callsAfterFirst, 'second poll inside the TTL must not re-walk');

    captureMonoRouterLiveScreen(tmp, t0 + RESIDENT_PANE_CACHE_TTL_MS - 1);
    assert.equal(countCapturePaneCalls(fake), callsAfterFirst, 'poll just under the TTL boundary must not re-walk');
  } finally {
    fake.restore();
    clearResidentPaneLiveCache();
  }
});

// BL-881: once the TTL has elapsed, or the cache is explicitly cleared, the
// next capture must perform a fresh walk (not return the stale snapshot).
test('captureMonoRouterLiveScreen performs a fresh walk once the TTL expires', () => {
  const tmp = mkTmpDir('sfvc-mono-live-cache-');
  const paneText = seedResidentPaneFixture(tmp, { role: 'coder', model: 'claude-sonnet-5' });
  const fake = installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: paneText },
  ]);
  try {
    clearResidentPaneLiveCache();
    const t0 = 1_700_000_000_000;
    captureMonoRouterLiveScreen(tmp, t0);
    const callsAfterFirst = countCapturePaneCalls(fake);

    captureMonoRouterLiveScreen(tmp, t0 + RESIDENT_PANE_CACHE_TTL_MS);
    assert.ok(countCapturePaneCalls(fake) > callsAfterFirst, 'poll at/after the TTL boundary must re-walk');
  } finally {
    fake.restore();
    clearResidentPaneLiveCache();
  }
});

test('clearResidentPaneLiveCache forces the next capture to re-walk immediately', () => {
  const tmp = mkTmpDir('sfvc-mono-live-cache-');
  const paneText = seedResidentPaneFixture(tmp, { role: 'coder', model: 'claude-sonnet-5' });
  const fake = installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: paneText },
  ]);
  try {
    clearResidentPaneLiveCache();
    const t0 = 1_700_000_000_000;
    captureMonoRouterLiveScreen(tmp, t0);
    const callsAfterFirst = countCapturePaneCalls(fake);

    clearResidentPaneLiveCache();
    captureMonoRouterLiveScreen(tmp, t0);
    assert.ok(countCapturePaneCalls(fake) > callsAfterFirst, 'a cleared cache must re-walk even at the same instant');
  } finally {
    fake.restore();
    clearResidentPaneLiveCache();
  }
});

// BL-881 constraint: cache key includes targetPath so two roots never share
// a cached snapshot.
test('captureMonoRouterLiveScreen keys the cache by targetPath', () => {
  const tmpA = mkTmpDir('sfvc-mono-live-cache-a-');
  const tmpB = mkTmpDir('sfvc-mono-live-cache-b-');
  seedResidentPaneFixture(tmpA, { role: 'coder', model: 'claude-sonnet-5' });
  seedResidentPaneFixture(tmpB, { role: 'coder', model: 'claude-sonnet-5' });
  const fake = installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'capture-pane', exitCode: 0, stdout: 'SwarmForge Coder\n> working' },
  ]);
  try {
    clearResidentPaneLiveCache();
    const t0 = 1_700_000_000_000;
    captureMonoRouterLiveScreen(tmpA, t0);
    const callsAfterA = countCapturePaneCalls(fake);

    captureMonoRouterLiveScreen(tmpB, t0);
    assert.ok(countCapturePaneCalls(fake) > callsAfterA, 'a different targetPath must not reuse tmpA\'s cached snapshot');
  } finally {
    fake.restore();
    clearResidentPaneLiveCache();
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
