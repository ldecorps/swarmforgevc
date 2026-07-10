const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFleetNode } = require('../out/swarm/fleetNode');
const { createSwarmNode } = require('../out/swarm/compositeNode');
const { mailboxDir } = require('../out/swarm/swarmState');

// BL-246 (Baton fleet epic, BL-242 child): the fleet is a composite of
// swarms - a fleet node composes several swarm CompositeNode instances
// (BL-244) the SAME way a swarm composes agent nodes, through the
// identical identity/status/health/children interface (kind: 'fleet').
// PoC transport is POLL: each call reads whatever state the caller's
// swarm nodes currently report, no push/subscribe machinery here.

function fakeSwarmNode(name, project, status, health, children = []) {
  return {
    identity: () => ({ name, project, kind: 'swarm', coordinatorAddress: `${name}/coordinator` }),
    status: () => status,
    health: () => health ?? { expected_panes: 1, live_panes: 1, coordinator_alive: true },
    children: () => children,
  };
}

// ── fleet-console-01: children lists every swarm ────────────────────────

test('children returns one node per registered swarm, each still answering the composite interface', () => {
  const alpha = fakeSwarmNode('alpha', 'proj-a', 'active');
  const beta = fakeSwarmNode('beta', 'proj-b', 'blocked');
  const fleet = createFleetNode({ fleetName: 'fleet', swarms: [alpha, beta] });

  const names = fleet.children().map((c) => c.identity().name);
  assert.deepEqual(names.sort(), ['alpha', 'beta']);
  for (const child of fleet.children()) {
    assert.equal(child.identity().kind, 'swarm');
    assert.equal(typeof child.status(), 'string');
    assert.equal(typeof child.health(), 'object');
    assert.ok(Array.isArray(child.children()));
  }
});

test('fleet children() never reaches into a swarm\'s own children - it returns the swarm nodes unchanged', () => {
  const agents = [fakeSwarmNode('coder', 'proj-a', 'active')];
  const alpha = fakeSwarmNode('alpha', 'proj-a', 'active', undefined, agents);
  const fleet = createFleetNode({ fleetName: 'fleet', swarms: [alpha] });

  assert.equal(fleet.children()[0].children(), agents);
});

// ── fleet-console-02: status is the rollup of its swarms ─────────────────

test('fleet status rolls up to blocked when any swarm member is blocked, even over an active sibling', () => {
  const alpha = fakeSwarmNode('alpha', 'proj-a', 'active');
  const beta = fakeSwarmNode('beta', 'proj-b', 'blocked');
  const fleet = createFleetNode({ fleetName: 'fleet', swarms: [alpha, beta] });

  assert.equal(fleet.status(), 'blocked');
});

test('fleet status is idle when every swarm is idle', () => {
  const alpha = fakeSwarmNode('alpha', 'proj-a', 'idle');
  const beta = fakeSwarmNode('beta', 'proj-b', 'idle');
  const fleet = createFleetNode({ fleetName: 'fleet', swarms: [alpha, beta] });

  assert.equal(fleet.status(), 'idle');
});

test('fleet status is done only when every swarm is done', () => {
  const alpha = fakeSwarmNode('alpha', 'proj-a', 'done');
  const beta = fakeSwarmNode('beta', 'proj-b', 'done');
  const fleet = createFleetNode({ fleetName: 'fleet', swarms: [alpha, beta] });

  assert.equal(fleet.status(), 'done');
});

// ── fleet-console-03: composite uniformity ────────────────────────────────

test('a single-swarm fleet renders through the SAME interface as a multi-swarm fleet - status is that swarm\'s own status, not a special case', () => {
  const alpha = fakeSwarmNode('alpha', 'proj-a', 'active');
  const fleet = createFleetNode({ fleetName: 'fleet', swarms: [alpha] });

  assert.equal(fleet.identity().kind, 'fleet');
  assert.deepEqual(fleet.children().map((c) => c.identity().name), ['alpha']);
  assert.equal(fleet.status(), 'active');
});

test('a single-swarm fleet and a multi-swarm fleet expose identical shapes from identity/status/health/children', () => {
  const alpha = fakeSwarmNode('alpha', 'proj-a', 'idle');
  const beta = fakeSwarmNode('beta', 'proj-b', 'idle');
  const solo = createFleetNode({ fleetName: 'fleet', swarms: [alpha] });
  const multi = createFleetNode({ fleetName: 'fleet', swarms: [alpha, beta] });

  for (const fleet of [solo, multi]) {
    assert.equal(fleet.identity().kind, 'fleet');
    assert.equal(typeof fleet.status(), 'string');
    assert.deepEqual(Object.keys(fleet.health()).sort(), ['coordinator_alive', 'expected_panes', 'live_panes']);
    assert.ok(Array.isArray(fleet.children()));
  }
});

// ── fleet-console-04: children() traverses fleet -> swarm -> agent ───────

test('children() on a swarm returned by the fleet still returns that swarm\'s own agents', () => {
  const agents = [fakeSwarmNode('coder', 'proj-a', 'active'), fakeSwarmNode('cleaner', 'proj-a', 'idle')];
  const alpha = fakeSwarmNode('alpha', 'proj-a', 'active', undefined, agents);
  const beta = fakeSwarmNode('beta', 'proj-b', 'idle');
  const fleet = createFleetNode({ fleetName: 'fleet', swarms: [alpha, beta] });

  const byName = Object.fromEntries(fleet.children().map((c) => [c.identity().name, c]));
  assert.deepEqual(
    byName.alpha.children().map((c) => c.identity().name),
    ['coder', 'cleaner']
  );
});

// ── identity/health ───────────────────────────────────────────────────────

test('fleet identity carries the fleet name and kind: fleet', () => {
  const fleet = createFleetNode({ fleetName: 'baton-fleet', swarms: [] });

  assert.deepEqual(fleet.identity(), {
    name: 'baton-fleet',
    project: '',
    kind: 'fleet',
    coordinatorAddress: '',
  });
});

test('fleet health sums expected_panes and live_panes across every swarm', () => {
  const alpha = fakeSwarmNode('alpha', 'proj-a', 'active', { expected_panes: 4, live_panes: 4, coordinator_alive: true });
  const beta = fakeSwarmNode('beta', 'proj-b', 'idle', { expected_panes: 4, live_panes: 3, coordinator_alive: true });
  const fleet = createFleetNode({ fleetName: 'fleet', swarms: [alpha, beta] });

  assert.deepEqual(fleet.health(), { expected_panes: 8, live_panes: 7, coordinator_alive: true });
});

test('fleet health coordinator_alive is false when any one swarm\'s coordinator is down', () => {
  const alpha = fakeSwarmNode('alpha', 'proj-a', 'active', { expected_panes: 4, live_panes: 4, coordinator_alive: true });
  const beta = fakeSwarmNode('beta', 'proj-b', 'degraded', { expected_panes: 4, live_panes: 3, coordinator_alive: false });
  const fleet = createFleetNode({ fleetName: 'fleet', swarms: [alpha, beta] });

  assert.equal(fleet.health().coordinator_alive, false);
});

test('an empty fleet (no swarms registered) reports idle status and zeroed health, never a crash', () => {
  const fleet = createFleetNode({ fleetName: 'fleet', swarms: [] });

  assert.equal(fleet.status(), 'idle');
  assert.deepEqual(fleet.health(), { expected_panes: 0, live_panes: 0, coordinator_alive: true });
  assert.deepEqual(fleet.children(), []);
});

// ── real integration: composes with the REAL createSwarmNode (BL-244), not just fakes ──

function mkTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-fleet-node-'));
}

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

function mkRealSwarm(name, project, isSessionAlive = () => true) {
  const targetPath = mkTarget();
  const roles = {
    coordinator: role(targetPath, 'coordinator', 'master'),
    specifier: role(targetPath, 'specifier'),
    coder: role(targetPath, 'coder'),
  };
  markBacklogActive(targetPath, true);
  const swarm = createSwarmNode({
    targetPath,
    swarmName: name,
    project,
    coordinatorAddress: `${name}/coordinator`,
    roles: [roles.coordinator, roles.specifier, roles.coder],
    isSessionAlive,
  });
  return { targetPath, roles, swarm };
}

test('a fleet of two REAL swarm nodes rolls up status/health correctly - not just fakes', () => {
  const alpha = mkRealSwarm('alpha', 'proj-a');
  const beta = mkRealSwarm('beta', 'proj-b');
  dropHandoff(beta.roles.coder, 'in_process', '00_task.handoff', 'type: git_handoff\n');

  const fleet = createFleetNode({ fleetName: 'fleet', swarms: [alpha.swarm, beta.swarm] });

  assert.deepEqual(
    fleet.children().map((c) => c.identity().name),
    ['alpha', 'beta']
  );
  assert.equal(fleet.status(), 'active');
  assert.deepEqual(fleet.health(), { expected_panes: 6, live_panes: 6, coordinator_alive: true });
});
