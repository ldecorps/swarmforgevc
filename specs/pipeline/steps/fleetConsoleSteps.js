'use strict';

// BL-246 (Baton fleet epic, BL-242 child): step handlers for "the fleet is
// a composite of swarms". Drives the REAL createFleetNode
// (extension/out/swarm/fleetNode.js) composed over REAL createSwarmNode
// instances (BL-244, extension/out/swarm/compositeNode.js), each backed by
// its own real fixture .swarmforge/handoffs/ + backlog/active/ state - the
// same "drive the real module through real on-disk fixtures" posture
// compositeNodeSteps.js already established, not a fresh reimplementation
// of the rollup. isBlocked is injectable the same way compositeNodeSteps.js
// injects it (no on-disk "needs human" signal exists - PaneTailer/
// needsHumanReconciler-only, per BL-244).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { createSwarmNode } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'swarm', 'compositeNode'));
const { createFleetNode } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'swarm', 'fleetNode'));
const { mailboxDir } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'swarm', 'swarmState'));

function mkTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-fleet-console-'));
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

function registerSwarm(ctx, name, project) {
  const targetPath = mkTarget();
  const roles = {
    coordinator: role(targetPath, 'coordinator', 'master'),
    specifier: role(targetPath, 'specifier'),
    coder: role(targetPath, 'coder'),
    cleaner: role(targetPath, 'cleaner'),
  };
  markBacklogActive(targetPath, true);
  const deps = {
    targetPath,
    swarmName: name,
    project,
    coordinatorAddress: `${name}/coordinator`,
    roles: [roles.coordinator, roles.specifier, roles.coder, roles.cleaner],
    isSessionAlive: () => true,
    isBlocked: () => false,
  };
  ctx.registrations[name] = { targetPath, roles, deps };
  ctx.registrationOrder.push(name);
}

function buildFleet(ctx, names) {
  const swarms = names.map((name) => createSwarmNode(ctx.registrations[name].deps));
  return createFleetNode({ fleetName: 'fleet', swarms });
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a swarm "([^"]+)" working project "([^"]+)" publishing to the fleet console$/, (ctx, name, project) => {
    if (!ctx.registrations) {
      ctx.registrations = {};
      ctx.registrationOrder = [];
    }
    registerSwarm(ctx, name, project);
  });

  // ── fleet-console-01 ─────────────────────────────────────────────────
  registry.define(/^the console refreshes$/, (ctx) => {
    ctx.fleet = buildFleet(ctx, ctx.registrationOrder);
  });

  registry.define(/^it lists swarm "([^"]+)" with its status$/, (ctx, name) => {
    const child = ctx.fleet.children().find((c) => c.identity().name === name);
    if (!child) {
      throw new Error(`expected the fleet to list swarm "${name}", got: ${JSON.stringify(ctx.fleet.children().map((c) => c.identity().name))}`);
    }
    if (typeof child.status() !== 'string') {
      throw new Error(`expected swarm "${name}" to answer status(), got: ${JSON.stringify(child.status())}`);
    }
  });

  // ── fleet-console-02 ─────────────────────────────────────────────────
  registry.define(/^swarm "([^"]+)" status is active$/, (ctx, name) => {
    const { targetPath, roles } = ctx.registrations[name];
    dropHandoff(roles.coder, 'in_process', '00_task.handoff', 'type: git_handoff\n');
    markBacklogActive(targetPath, true);
  });

  registry.define(/^swarm "([^"]+)" status is blocked$/, (ctx, name) => {
    ctx.registrations[name].deps.isBlocked = (r) => r.role === 'cleaner';
  });

  registry.define(/^the console reads status\(\) for the fleet$/, (ctx) => {
    ctx.fleet = buildFleet(ctx, ctx.registrationOrder);
    ctx.fleetStatus = ctx.fleet.status();
  });

  registry.define(/^the fleet status reflects that a member is blocked$/, (ctx) => {
    if (ctx.fleetStatus !== 'blocked') {
      throw new Error(`expected fleet status "blocked", got "${ctx.fleetStatus}"`);
    }
  });

  // ── fleet-console-03 ─────────────────────────────────────────────────
  registry.define(/^only swarm "([^"]+)" is registered$/, (ctx, name) => {
    ctx.soloRegistration = name;
  });

  registry.define(/^the console renders the fleet$/, (ctx) => {
    const names = ctx.soloRegistration ? [ctx.soloRegistration] : ctx.registrationOrder;
    ctx.fleet = buildFleet(ctx, names);
    ctx.comparisonFleet = buildFleet(ctx, ctx.registrationOrder);
  });

  registry.define(/^it uses the same interface it uses for a multi-swarm fleet$/, (ctx) => {
    for (const fleet of [ctx.fleet, ctx.comparisonFleet]) {
      if (fleet.identity().kind !== 'fleet') {
        throw new Error(`expected identity().kind "fleet", got: ${JSON.stringify(fleet.identity())}`);
      }
      if (typeof fleet.status() !== 'string') {
        throw new Error('expected status() to return a string');
      }
      const health = fleet.health();
      if (typeof health.expected_panes !== 'number' || typeof health.live_panes !== 'number' || typeof health.coordinator_alive !== 'boolean') {
        throw new Error(`expected a well-shaped health(), got: ${JSON.stringify(health)}`);
      }
      if (!Array.isArray(fleet.children())) {
        throw new Error('expected children() to return an array');
      }
    }
  });

  registry.define(/^no special-case path exists for a single-swarm fleet$/, (ctx) => {
    // A special-cased implementation would be tempted to unwrap the lone
    // swarm; the composite contract requires it stay wrapped in the same
    // children() array shape a multi-swarm fleet returns.
    const children = ctx.fleet.children();
    if (children.length !== 1) {
      throw new Error(`expected exactly one child for a single-swarm fleet, got ${children.length}`);
    }
    if (typeof children[0].identity !== 'function' || typeof children[0].status !== 'function') {
      throw new Error('expected the sole swarm to still be a full composite node, not unwrapped into a plain value');
    }
  });

  // ── fleet-console-04 ─────────────────────────────────────────────────
  registry.define(/^the console reads children\(\) for the fleet$/, (ctx) => {
    ctx.fleet = buildFleet(ctx, ctx.registrationOrder);
    ctx.fleetChildren = ctx.fleet.children();
  });

  registry.define(/^it returns swarm "([^"]+)" and swarm "([^"]+)"$/, (ctx, first, second) => {
    const names = ctx.fleetChildren.map((c) => c.identity().name).sort();
    const expected = [first, second].sort();
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      throw new Error(`expected fleet children ${JSON.stringify(expected)}, got ${JSON.stringify(names)}`);
    }
  });

  registry.define(/^reading children\(\) on "([^"]+)" returns ([a-z]+)'s agents$/, (ctx, name) => {
    const swarmChild = ctx.fleetChildren.find((c) => c.identity().name === name);
    ctx.agentChildren = swarmChild.children();
    const names = ctx.agentChildren.map((c) => c.identity().name).sort();
    const expected = ['cleaner', 'coder', 'specifier'];
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      throw new Error(`expected swarm "${name}"'s children() to be its pack agents ${JSON.stringify(expected)}, got ${JSON.stringify(names)}`);
    }
  });

  registry.define(/^each agent answers identity\(\), status\(\), health\(\), children\(\)$/, (ctx) => {
    for (const agent of ctx.agentChildren) {
      const identity = agent.identity();
      if (identity.kind !== 'agent' || typeof identity.name !== 'string') {
        throw new Error(`expected each agent's identity() to be well-shaped, got: ${JSON.stringify(identity)}`);
      }
      if (typeof agent.status() !== 'string') {
        throw new Error("expected each agent's status() to return a string");
      }
      const health = agent.health();
      if (typeof health.expected_panes !== 'number' || typeof health.live_panes !== 'number' || typeof health.coordinator_alive !== 'boolean') {
        throw new Error(`expected each agent's health() to be well-shaped, got: ${JSON.stringify(health)}`);
      }
      if (!Array.isArray(agent.children())) {
        throw new Error("expected each agent's children() to return an array");
      }
    }
  });
}

module.exports = { registerSteps };
