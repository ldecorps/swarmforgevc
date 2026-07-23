'use strict';

// BL-244: step handlers for "a swarm is a composite node". Drives the REAL
// createSwarmNode (extension/out/swarm/compositeNode.js) against real
// .swarmforge/handoffs/ and backlog/active/ fixtures built the same way
// extension/test/compositeNode.test.js's own fixtures are (mailboxDir from
// the real swarmState.js, not a reimplementation).
//
// The gherkin-parser IR drops Gherkin data tables entirely (confirmed by
// parsing this feature file directly) - the Background's own pack table
// (specifier/coder/cleaner) never reaches this file's step text, so the
// pack roster below is this handler's own translation of that table's
// intent into fixture code, not something read out of the parsed step.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { createSwarmNode } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'swarm', 'compositeNode'));
const { mailboxDir } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'swarm', 'swarmState'));

function mkTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-composite-node-'));
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

const CONVERGENCE_NOTE =
  "type: note\nfrom: QA\n\nBL-042 QA-approved a1b2c3d4e5 - merge your branch up to QA's\n";

// One fixture-builder per Examples-table `agent_states` value (a closed,
// known set from the feature file's own table - not open text).
const AGENT_STATES_FIXTURES = {
  'all idle': (ctx) => {
    markBacklogActive(ctx.targetPath, true);
  },
  'coder active, others idle': (ctx) => {
    markBacklogActive(ctx.targetPath, true);
    dropHandoff(ctx.roles.coder, 'in_process', '00_task.handoff', 'type: git_handoff\n');
  },
  'cleaner blocked, others idle': (ctx) => {
    markBacklogActive(ctx.targetPath, true);
    ctx.deps.isBlocked = (r) => r.role === 'cleaner';
  },
  'convergence merging branches': (ctx) => {
    markBacklogActive(ctx.targetPath, true);
    dropHandoff(ctx.roles.cleaner, 'in_process', '00_qa.handoff', CONVERGENCE_NOTE);
  },
  'all done, convergence complete': (ctx) => {
    markBacklogActive(ctx.targetPath, false);
  },
};

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a running swarm "([^"]+)" with a coordinator and a pack of$/, (ctx, swarmName) => {
    ctx.targetPath = mkTarget();
    ctx.roles = {
      coordinator: role(ctx.targetPath, 'coordinator', 'master'),
      specifier: role(ctx.targetPath, 'specifier'),
      coder: role(ctx.targetPath, 'coder'),
      cleaner: role(ctx.targetPath, 'cleaner'),
    };
    ctx.deps = {
      targetPath: ctx.targetPath,
      swarmName,
      project: ctx.targetPath,
      coordinatorAddress: `${swarmName}/coordinator`,
      roles: [ctx.roles.coordinator, ctx.roles.specifier, ctx.roles.coder, ctx.roles.cleaner],
      isSessionAlive: () => true,
      isBlocked: () => false,
    };
  });

  // ── swarm-composite-01 ───────────────────────────────────────────────
  registry.define(/^the pack agents are in states "([^"]+)"$/, (ctx, agentStates) => {
    const buildFixture = AGENT_STATES_FIXTURES[agentStates];
    if (!buildFixture) {
      throw new Error(`unrecognized agent_states fixture: "${agentStates}"`);
    }
    buildFixture(ctx);
  });

  registry.define(/^the console reads status\(\) for the swarm$/, (ctx) => {
    ctx.swarm = createSwarmNode(ctx.deps);
    ctx.swarmStatus = ctx.swarm.status();
  });

  registry.define(/^the swarm status is "([^"]+)"$/, (ctx, expected) => {
    if (ctx.swarmStatus !== expected) {
      throw new Error(`expected swarm status "${expected}", got "${ctx.swarmStatus}"`);
    }
  });

  // ── swarm-composite-02 ───────────────────────────────────────────────
  registry.define(/^the console reads identity\(\) for the swarm$/, (ctx) => {
    ctx.swarm = createSwarmNode(ctx.deps);
    ctx.identity = ctx.swarm.identity();
  });

  registry.define(/^it returns name "([^"]+)"$/, (ctx, expected) => {
    if (ctx.identity.name !== expected) {
      throw new Error(`expected identity name "${expected}", got "${ctx.identity.name}"`);
    }
  });

  registry.define(/^it returns the project the swarm is working$/, (ctx) => {
    if (!ctx.identity.project || ctx.identity.project !== ctx.targetPath) {
      throw new Error(`expected identity to carry the project path, got: ${JSON.stringify(ctx.identity)}`);
    }
  });

  registry.define(/^it returns the coordinator address to subscribe to$/, (ctx) => {
    if (!ctx.identity.coordinatorAddress) {
      throw new Error(`expected identity to carry a coordinator address, got: ${JSON.stringify(ctx.identity)}`);
    }
  });

  // ── swarm-composite-03 ───────────────────────────────────────────────
  registry.define(/^the swarm expects 4 panes$/, (ctx) => {
    if (ctx.deps.roles.length !== 4) {
      throw new Error(`expected the Background pack to already total 4 roles (coordinator + 3 pack), got ${ctx.deps.roles.length}`);
    }
  });

  registry.define(/^4 panes are live$/, (ctx) => {
    ctx.deps.isSessionAlive = () => true;
  });

  registry.define(/^the console reads health\(\) for the swarm$/, (ctx) => {
    ctx.swarm = createSwarmNode(ctx.deps);
    ctx.health = ctx.swarm.health();
  });

  registry.define(/^expected_panes is (\d+)$/, (ctx, expected) => {
    if (ctx.health.expected_panes !== Number(expected)) {
      throw new Error(`expected expected_panes ${expected}, got ${ctx.health.expected_panes}`);
    }
  });

  registry.define(/^live_panes is (\d+)$/, (ctx, expected) => {
    if (ctx.health.live_panes !== Number(expected)) {
      throw new Error(`expected live_panes ${expected}, got ${ctx.health.live_panes}`);
    }
  });

  registry.define(/^coordinator_alive is (true|false)$/, (ctx, expected) => {
    if (ctx.health.coordinator_alive !== (expected === 'true')) {
      throw new Error(`expected coordinator_alive ${expected}, got ${ctx.health.coordinator_alive}`);
    }
  });

  // ── swarm-composite-04 ───────────────────────────────────────────────
  registry.define(/^the console reads children\(\) for the swarm$/, (ctx) => {
    ctx.swarm = createSwarmNode(ctx.deps);
    ctx.children = ctx.swarm.children();
  });

  registry.define(/^it returns one node per pack agent$/, (ctx) => {
    const names = ctx.children.map((c) => c.identity().name).sort();
    const expected = ['cleaner', 'coder', 'specifier'];
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      throw new Error(`expected one child per pack agent ${JSON.stringify(expected)}, got ${JSON.stringify(names)}`);
    }
  });

  registry.define(/^each child answers the same composite interface$/, (ctx) => {
    for (const child of ctx.children) {
      const identity = child.identity();
      if (identity.kind !== 'agent' || typeof identity.name !== 'string') {
        throw new Error(`expected each child's identity() to be a well-shaped agent node, got: ${JSON.stringify(identity)}`);
      }
      if (typeof child.status() !== 'string') {
        throw new Error(`expected each child's status() to return a string`);
      }
      const health = child.health();
      if (typeof health.expected_panes !== 'number' || typeof health.live_panes !== 'number' || typeof health.coordinator_alive !== 'boolean') {
        throw new Error(`expected each child's health() to be well-shaped, got: ${JSON.stringify(health)}`);
      }
      if (!Array.isArray(child.children())) {
        throw new Error('expected each child\'s children() to return an array');
      }
    }
  });
}

module.exports = { registerSteps };
