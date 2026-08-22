const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildSampledRoles,
  resolvePanePid,
  selectAgentDescendant,
  listProcessTree,
  resolveAgentPid,
  DEFAULT_AGENT_COMMAND_NAME,
} = require('../out/swarm/resourceSamplerActivation');
const { installInProcessTmux } = require('./helpers/fakeTmux');

function mkTmp() {
  return mkTmpDir('sfvc-resource-sampler-activation-');
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

test('getPid threads each role\'s OWN configured agent command name through, not a hardcoded default', () => {
  // BL-847: a role's agent (aider/claude/codex/copilot/grok - see
  // agentPaneState.ts) is per-role, not fleet-wide. Hardcoding 'claude'
  // here would silently zero out every non-claude role's samples.
  const calls = [];
  const resolvePid = (targetPath, session, agentCommandName) => {
    calls.push(agentCommandName);
    return 42;
  };
  const roles = [
    swarmRole({ role: 'coder', session: 'swarmforge-coder', agent: 'claude' }),
    swarmRole({ role: 'aider-role', session: 'swarmforge-aider-role', agent: 'aider' }),
  ];

  const sampled = buildSampledRoles('/target', roles, resolvePid);
  sampled.forEach((s) => s.getPid());

  assert.deepEqual(calls, ['claude', 'aider']);
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
  const fake = installInProcessTmux([
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
  const fake = installInProcessTmux([
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

// ── selectAgentDescendant (pure): BL-847 — the pane_pid is the pane's ROOT
// SHELL, not the agent; the agent is a descendant. Given a flat process
// list, picks the first descendant (by BFS from panePid, panePid itself
// excluded) whose command matches agentCommandName, or null when none does.

function proc(pid, ppid, command) {
  return { pid, ppid, command };
}

test('selectAgentDescendant finds a direct child matching the agent command name', () => {
  const tree = [proc(200, 100, 'claude'), proc(201, 100, 'bash')];
  assert.equal(selectAgentDescendant(tree, 100, 'claude'), 200);
});

test('selectAgentDescendant descends past a non-matching direct child to find a matching grandchild', () => {
  // 100 (pane shell) -> 200 (claude) -> 300 (bash tool subshell): the
  // ticket's own live-data shape (claude direct child, bash its child).
  const tree = [proc(200, 100, 'claude'), proc(300, 200, 'bash')];
  assert.equal(selectAgentDescendant(tree, 100, 'claude'), 200);
});

test('selectAgentDescendant returns null when no descendant matches the configured command name', () => {
  const tree = [proc(200, 100, 'bash'), proc(300, 200, 'sh')];
  assert.equal(selectAgentDescendant(tree, 100, 'claude'), null);
});

test('selectAgentDescendant never matches the root pid itself, only its descendants', () => {
  // The pane shell's own entry (pid 100) happens to be named "claude" -
  // still excluded; only pid 100's DESCENDANTS are candidates.
  const tree = [proc(100, 1, 'claude'), proc(200, 100, 'bash')];
  assert.equal(selectAgentDescendant(tree, 100, 'claude'), null);
});

test('selectAgentDescendant ignores processes outside the root pid\'s subtree', () => {
  const tree = [proc(200, 100, 'bash'), proc(999, 1, 'claude')]; // 999 is unrelated (child of pid 1)
  assert.equal(selectAgentDescendant(tree, 100, 'claude'), null);
});

test('selectAgentDescendant prefers the shallower of two matching descendants', () => {
  const tree = [proc(200, 100, 'claude'), proc(300, 200, 'claude')];
  assert.equal(selectAgentDescendant(tree, 100, 'claude'), 200);
});

test('selectAgentDescendant returns null against an empty process tree', () => {
  assert.equal(selectAgentDescendant([], 100, 'claude'), null);
});

// ── listProcessTree (thin OS adapter, real ps) ──────────────────────────

test('listProcessTree finds the current process among the real OS process list', () => {
  const tree = listProcessTree();
  const self = tree.find((p) => p.pid === process.pid);
  assert.ok(self, 'expected the current process to appear in the real process tree');
  assert.equal(self.ppid, process.ppid);
});

// ── resolveAgentPid (composes resolvePanePid + listProcessTree) ─────────

test('resolveAgentPid resolves the agent descendant beneath the discovered pane pid', () => {
  const targetPath = mkTmp();
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'tmux-socket'), '/tmp/fake.sock\n');
  const fake = installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'display-message', exitCode: 0, stdout: '100\n' },
  ]);
  const fakeTree = () => [proc(200, 100, 'claude'), proc(201, 100, 'bash')];
  try {
    assert.equal(
      resolveAgentPid(targetPath, 'swarmforge-coder', DEFAULT_AGENT_COMMAND_NAME, fakeTree),
      200
    );
  } finally {
    fake.restore();
  }
});

test('resolveAgentPid returns null when the pane pid itself cannot be resolved (never falls back to a shell pid)', () => {
  const targetPath = mkTmp();
  assert.equal(resolveAgentPid(targetPath, 'swarmforge-coder', DEFAULT_AGENT_COMMAND_NAME, () => []), null);
});

test('resolveAgentPid returns null (never the shell pid) when no descendant matches the agent command name', () => {
  const targetPath = mkTmp();
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'tmux-socket'), '/tmp/fake.sock\n');
  const fake = installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'display-message', exitCode: 0, stdout: '100\n' },
  ]);
  const fakeTree = () => [proc(200, 100, 'bash')]; // no "claude" anywhere
  try {
    assert.equal(resolveAgentPid(targetPath, 'swarmforge-coder', DEFAULT_AGENT_COMMAND_NAME, fakeTree), null);
  } finally {
    fake.restore();
  }
});

// ── buildSampledRoles now defaults to the agent-descending resolver ─────

test('buildSampledRoles defaults to resolveAgentPid, not the raw pane shell pid, when resolvePid is not overridden', () => {
  const targetPath = mkTmp();
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'tmux-socket'), '/tmp/fake.sock\n');
  const fake = installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'display-message', exitCode: 0, stdout: '54321\n' },
  ]);
  try {
    const sampled = buildSampledRoles(targetPath, [swarmRole()]);
    // The real listProcessTree() almost certainly has no pid 54321 with a
    // "claude" descendant in this test process's tree, so the default path
    // must report null rather than the shell pid 54321 itself.
    assert.notEqual(sampled[0].getPid(), 54321);
  } finally {
    fake.restore();
  }
});
