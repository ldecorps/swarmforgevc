'use strict';

// BL-310: step handlers for "A freshly (re)started runtime never
// auto-hibernates before the coordinator can triage queued work". Drives
// the REAL operator_runtime.bb --tick-once, same posture as
// operatorAutoHibernateSteps.js (BL-307) - this file only adds the NEW
// Given/Then vocabulary the ticket introduces (a seeded runtime.pid mtime
// standing in for "the runtime's own process start", and coordinator-inbox
// freshness); every shared Given/When/Then text ("no promotable backlog
// work remains", "the runtime evaluates the closing pass", "the swarm is
// hibernated", "the runtime relaunches the swarm", ...) resolves to
// operatorAutoHibernateSteps.js's own already-registered handlers (see the
// Gherkin step registry shared-Background rule: first-registered wins, so
// this file designs against that fixture rather than redefining it).
//
// mkRosterFixture/opPath/rolesTsvPath are deliberately duplicated from
// operatorAutoHibernateSteps.js rather than imported - the same "small
// live-glue duplicated across independent step files, no shared lifecycle
// worth coupling" posture operator_lib.bb's own operator-channel-name
// comment documents; neither file exports its fixture helpers.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

function opPath(root, ...rest) {
  return path.join(root, '.swarmforge', 'operator', ...rest);
}

function rolesTsvPath(root) {
  return path.join(root, '.swarmforge', 'roles.tsv');
}

function mkRosterFixture(roles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-operator-seed-race-'));
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(opPath(root), { recursive: true });
  fs.writeFileSync(opPath(root, 'last-swarm-check'), String(Date.now()));
  const rows = roles.map((role) => {
    const worktree = path.join(root, '.worktrees', role);
    fs.mkdirSync(path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
    fs.mkdirSync(path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
    return [role, role, worktree, `swarmforge-${role}`, role, 'claude', 'task'].join('\t');
  });
  fs.mkdirSync(path.dirname(rolesTsvPath(root)), { recursive: true });
  fs.writeFileSync(rolesTsvPath(root), rows.length ? rows.join('\n') + '\n' : '');
  return root;
}

// runtime-started-at-ms (operator_runtime.bb) reads runtime.pid's own mtime
// - only the real -main while-loop ever writes that file, never
// --tick-once, so these fixtures seed it by hand and backdate its mtime to
// simulate "the runtime started N ago" without a real long-running process.
function seedRuntimeStart(root, agoMs) {
  const pidFile = opPath(root, 'runtime.pid');
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, '1');
  const startedAt = new Date(Date.now() - agoMs);
  fs.utimesSync(pidFile, startedAt, startedAt);
}

const GRACE_MS = 2 * 60 * 1000;

function coordinatorInboxNewDir(root) {
  return path.join(root, '.swarmforge', 'handoffs', 'coordinator', 'inbox', 'new');
}

function seedFreshCoordinatorMail(root) {
  const dir = coordinatorInboxNewDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '00_x_from_specifier_to_coordinator.handoff'),
    'from: specifier\nto: coordinator\npriority: 00\ntype: note\n\nbody\n'
  );
}

function registerSteps(registry) {
  registry.define(/^the runtime started less than 2 minutes ago$/, (ctx) => {
    ctx.root = ctx.root || mkRosterFixture(['coder']);
    seedRuntimeStart(ctx.root, GRACE_MS / 2);
  });

  registry.define(/^the runtime started more than 2 minutes ago$/, (ctx) => {
    ctx.root = ctx.root || mkRosterFixture(['coder']);
    seedRuntimeStart(ctx.root, GRACE_MS * 3);
  });

  registry.define(/^fresh coordinator mail has arrived$/, (ctx) => {
    seedFreshCoordinatorMail(ctx.root);
  });

  registry.define(/^no fresh coordinator mail has arrived$/, () => {
    // No mailbox setup at all - mkRosterFixture/the hibernated fixture
    // already leaves the coordinator's inbox absent/empty.
  });

  registry.define(/^the swarm remains hibernated$/, (ctx) => {
    const state = JSON.parse(fs.readFileSync(opPath(ctx.root, 'hibernation.json'), 'utf8'));
    if (state.hibernated !== true) {
      throw new Error(`expected the swarm to remain hibernated, got: ${JSON.stringify(state)}`);
    }
  });
}

module.exports = { registerSteps };
