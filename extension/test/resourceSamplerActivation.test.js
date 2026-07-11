const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildSampledRoles, resolvePanePid } = require('../out/swarm/resourceSamplerActivation');
const { installFakeTmux } = require('./helpers/fakeTmux');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-resource-sampler-activation-'));
}

function swarmRole(overrides = {}) {
  return { index: 1, role: 'coder', session: 'swarmforge-coder', displayName: 'Coder', agent: 'claude', ...overrides };
}

// ── buildSampledRoles (pure, injected resolvePid) ─────────────────────────
// BL-264: "pids resolved via the existing swarm-discovery layer, not a new
// one" is proven here by injecting a fake resolvePid and asserting it is
// called with exactly the (targetPath, session) the discovery layer would
// have been given - never a second, independent lookup mechanism.

test('maps each SwarmRole to a SampledRole carrying the same role name', () => {
  const roles = [swarmRole({ role: 'coder' }), swarmRole({ role: 'cleaner', session: 'swarmforge-cleaner' })];

  const sampled = buildSampledRoles('/target', roles, () => 111);

  assert.deepEqual(sampled.map((r) => r.role), ['coder', 'cleaner']);
});

test('getPid calls the injected resolvePid with the target path and that role\'s session, lazily', () => {
  const calls = [];
  const resolvePid = (targetPath, session) => {
    calls.push([targetPath, session]);
    return 42;
  };
  const roles = [swarmRole({ role: 'coder', session: 'swarmforge-coder' })];

  const sampled = buildSampledRoles('/target', roles, resolvePid);
  assert.deepEqual(calls, [], 'resolvePid must not be called until getPid() is invoked');

  const pid = sampled[0].getPid();

  assert.equal(pid, 42);
  assert.deepEqual(calls, [['/target', 'swarmforge-coder']]);
});

test('getPid re-resolves on every call, picking up a respawned pane\'s new pid', () => {
  let currentPid = 100;
  const roles = [swarmRole()];
  const sampled = buildSampledRoles('/target', roles, () => currentPid);

  assert.equal(sampled[0].getPid(), 100);
  currentPid = 200; // simulates a respawn between sampler ticks
  assert.equal(sampled[0].getPid(), 200);
});

test('a role whose pid cannot be resolved reports null, not a throw', () => {
  const sampled = buildSampledRoles('/target', [swarmRole()], () => null);

  assert.equal(sampled[0].getPid(), null);
});

test('an empty role list produces an empty SampledRole list', () => {
  assert.deepEqual(buildSampledRoles('/target', [], () => 1), []);
});

// ── resolvePanePid (composes the existing tmux discovery chain) ──────────

test('resolvePanePid resolves the live pid through readTmuxSocket -> getPaneBaseIndex -> resolveAgentPaneTarget -> getPanePid', () => {
  const targetPath = mkTmp();
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'tmux-socket'), '/tmp/fake.sock\n');
  const fake = installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'display-message', exitCode: 0, stdout: '54321\n' },
  ]);
  try {
    assert.equal(resolvePanePid(targetPath, 'swarmforge-coder'), 54321);
  } finally {
    fake.restore();
  }
});

test('resolvePanePid returns null when no tmux socket has been recorded for the target', () => {
  const targetPath = mkTmp();
  assert.equal(resolvePanePid(targetPath, 'swarmforge-coder'), null);
});

test('resolvePanePid returns null when the tmux pane pid lookup fails', () => {
  const targetPath = mkTmp();
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'tmux-socket'), '/tmp/fake.sock\n');
  const fake = installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'display-message', exitCode: 1, stdout: '' },
  ]);
  try {
    assert.equal(resolvePanePid(targetPath, 'swarmforge-coder'), null);
  } finally {
    fake.restore();
  }
});
