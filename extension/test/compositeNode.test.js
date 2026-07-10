const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSwarmNode } = require('../out/swarm/compositeNode');
const { mailboxDir } = require('../out/swarm/swarmState');

// BL-244: a swarm is a composite node, rolling up its pack agents. Reads
// REAL on-disk state (.swarmforge/handoffs/, backlog/active/) via
// swarmState.ts's own mailboxDir resolver (used directly below, so a
// fixture-path bug here can never silently diverge from what the module
// under test actually reads) - no new authoritative store.
// isSessionAlive/isBlocked are injectable: pane liveness and "needs human"
// have no pure on-disk representation today (the latter is live-pane-text
// only, fed by PaneTailer/needsHumanReconciler), so production wiring
// supplies them from that same live state; tests supply fakes directly.

function mkTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-composite-node-'));
}

// Mirrors this project's own real layout: master-resident roles
// (coordinator, specifier) share the single targetPath checkout;
// every other role gets its OWN dedicated worktree path
// (.worktrees/<role>, matching mailboxBaseDir's own master-vs-dedicated
// split) - never a second role's shared path, or their mailboxes collapse
// into the same directory.
function role(targetPath, name, worktreeName = name) {
  const worktreePath = worktreeName === 'master' ? targetPath : path.join(targetPath, '.worktrees', name);
  return { role: name, worktreeName, worktreePath, displayName: name };
}

function dropHandoff(roleEntry, subdir, filename, content) {
  const dir = mailboxDir(roleEntry, 'inbox', subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content);
}

function markBacklogActive(targetPath, has) {
  const dir = path.join(targetPath, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  if (has) {
    fs.writeFileSync(path.join(dir, 'BL-999-fixture.yaml'), 'id: BL-999\n');
  }
}

// Builds a fresh { targetPath, roles: {coordinator, specifier, coder, cleaner}, deps }
// fixture for one test - baseDeps below composes deps.roles from it.
function mkFixture() {
  const targetPath = mkTarget();
  const roles = {
    coordinator: role(targetPath, 'coordinator', 'master'),
    specifier: role(targetPath, 'specifier'),
    coder: role(targetPath, 'coder'),
    cleaner: role(targetPath, 'cleaner'),
  };
  return { targetPath, roles };
}

function baseDeps(fixture, overrides = {}) {
  return {
    targetPath: fixture.targetPath,
    swarmName: 'second',
    project: '/path/to/target-project',
    coordinatorAddress: 'second/coordinator',
    roles: [fixture.roles.coordinator, fixture.roles.specifier, fixture.roles.coder, fixture.roles.cleaner],
    isSessionAlive: () => true,
    isBlocked: () => false,
    ...overrides,
  };
}

// ── swarm-composite-01: status rollup ───────────────────────────────────

test('all agents idle (with an active backlog item still open) rolls up to swarm idle', () => {
  const fixture = mkFixture();
  markBacklogActive(fixture.targetPath, true);
  const swarm = createSwarmNode(baseDeps(fixture));

  assert.equal(swarm.status(), 'idle');
});

test('one agent active (in_process handoff) rolls up to swarm active', () => {
  const fixture = mkFixture();
  markBacklogActive(fixture.targetPath, true);
  dropHandoff(fixture.roles.coder, 'in_process', '00_task.handoff', 'type: git_handoff\n');
  const swarm = createSwarmNode(baseDeps(fixture));

  assert.equal(swarm.status(), 'active');
});

test('one agent blocked (injected needs-human signal) rolls up to swarm blocked, even over an active agent', () => {
  const fixture = mkFixture();
  markBacklogActive(fixture.targetPath, true);
  dropHandoff(fixture.roles.coder, 'in_process', '00_task.handoff', 'type: git_handoff\n');
  const swarm = createSwarmNode(baseDeps(fixture, { isBlocked: (r) => r.role === 'cleaner' }));

  assert.equal(swarm.status(), 'blocked');
});

test('a pending QA merge-up note in any worktree role rolls up to swarm converging', () => {
  const fixture = mkFixture();
  markBacklogActive(fixture.targetPath, true);
  dropHandoff(
    fixture.roles.cleaner,
    'in_process',
    '00_qa.handoff',
    'type: note\nfrom: QA\n\nBL-042 QA-approved a1b2c3d4e5 - merge your branch up to QA\'s\n'
  );
  const swarm = createSwarmNode(baseDeps(fixture));

  assert.equal(swarm.status(), 'converging');
});

test('every agent idle with NO active backlog item rolls up to swarm done', () => {
  const fixture = mkFixture();
  markBacklogActive(fixture.targetPath, false);
  const swarm = createSwarmNode(baseDeps(fixture));

  assert.equal(swarm.status(), 'done');
});

test('a queued (new/, not yet in_process) handoff rolls up to swarm queued', () => {
  const fixture = mkFixture();
  markBacklogActive(fixture.targetPath, true);
  dropHandoff(fixture.roles.specifier, 'new', '00_task.handoff', 'type: git_handoff\n');
  const swarm = createSwarmNode(baseDeps(fixture));

  assert.equal(swarm.status(), 'queued');
});

test('a dead agent session rolls up to swarm degraded', () => {
  const fixture = mkFixture();
  markBacklogActive(fixture.targetPath, true);
  const swarm = createSwarmNode(baseDeps(fixture, { isSessionAlive: (r) => r.role !== 'cleaner' }));

  assert.equal(swarm.status(), 'degraded');
});

// ── swarm-composite-02: identity ────────────────────────────────────────

test('swarm identity carries name, project, kind, and the coordinator address', () => {
  const fixture = mkFixture();
  const swarm = createSwarmNode(baseDeps(fixture));

  assert.deepEqual(swarm.identity(), {
    name: 'second',
    project: '/path/to/target-project',
    kind: 'swarm',
    coordinatorAddress: 'second/coordinator',
  });
});

// ── swarm-composite-03: health ──────────────────────────────────────────

test('health reports expected vs live panes across the WHOLE roles list, including the coordinator', () => {
  const fixture = mkFixture();
  const swarm = createSwarmNode(baseDeps(fixture));

  assert.deepEqual(swarm.health(), { expected_panes: 4, live_panes: 4, coordinator_alive: true });
});

test('a dead pane lowers live_panes without lowering expected_panes', () => {
  const fixture = mkFixture();
  const swarm = createSwarmNode(baseDeps(fixture, { isSessionAlive: (r) => r.role !== 'coder' }));

  assert.deepEqual(swarm.health(), { expected_panes: 4, live_panes: 3, coordinator_alive: true });
});

test('coordinator_alive reflects the coordinator role specifically, not the pack', () => {
  const fixture = mkFixture();
  const swarm = createSwarmNode(baseDeps(fixture, { isSessionAlive: (r) => r.role !== 'coordinator' }));

  assert.equal(swarm.health().coordinator_alive, false);
});

// ── swarm-composite-04: children ────────────────────────────────────────

test('children returns one node per PACK agent, excluding the coordinator itself', () => {
  const fixture = mkFixture();
  const swarm = createSwarmNode(baseDeps(fixture));

  const names = swarm.children().map((c) => c.identity().name);
  assert.deepEqual(names.sort(), ['cleaner', 'coder', 'specifier']);
});

test('each child answers the same composite interface (identity/status/health/children)', () => {
  const fixture = mkFixture();
  markBacklogActive(fixture.targetPath, true);
  const swarm = createSwarmNode(baseDeps(fixture));

  for (const child of swarm.children()) {
    const identity = child.identity();
    assert.equal(identity.kind, 'agent');
    assert.equal(typeof child.status(), 'string');
    assert.deepEqual(child.health(), { expected_panes: 1, live_panes: 1, coordinator_alive: true });
    assert.deepEqual(child.children(), []);
  }
});

test('an active agent child reports its own active status, distinct from an idle sibling', () => {
  const fixture = mkFixture();
  markBacklogActive(fixture.targetPath, true);
  dropHandoff(fixture.roles.coder, 'in_process', '00_task.handoff', 'type: git_handoff\n');
  const swarm = createSwarmNode(baseDeps(fixture));

  const byName = Object.fromEntries(swarm.children().map((c) => [c.identity().name, c]));
  assert.equal(byName.coder.status(), 'active');
  assert.equal(byName.specifier.status(), 'idle');
});
