'use strict';

// BL-318: step handlers for "Auto-hibernate fires when backlog is drained
// and coordinator is not self-generating". Scenarios 01/03 drive the REAL
// operator_runtime.bb --tick-once (mirrors operatorAutoHibernateSteps.js's
// own mkRosterFixture/tickOnce pattern). Scenarios 02/04 call operator_lib.bb's
// pure BL-318 functions directly via `bb -e`, the same "load-file + println"
// pattern backlogDepthSteps.js uses for backlog_depth_lib.bb.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const OPERATOR_RUNTIME_BB = path.join(SWARMFORGE_SCRIPTS, 'operator_runtime.bb');
const OPERATOR_LIB = path.join(SWARMFORGE_SCRIPTS, 'operator_lib.bb');

function opPath(root, ...rest) {
  return path.join(root, '.swarmforge', 'operator', ...rest);
}

function rolesTsvPath(root) {
  return path.join(root, '.swarmforge', 'roles.tsv');
}

function hibernationStatePath(root) {
  return opPath(root, 'hibernation.json');
}

function mkRosterFixture(roles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-operator-selfgen-'));
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

function readHibernationState(root) {
  try {
    return JSON.parse(fs.readFileSync(hibernationStatePath(root), 'utf8'));
  } catch {
    return null;
  }
}

function tickOnce(root, env = {}) {
  const out = execFileSync('bb', [OPERATOR_RUNTIME_BB, root, '--tick-once'], {
    encoding: 'utf8',
    env: { ...process.env, OPERATOR_SKIP_LAUNCH: '1', ...env },
  });
  return JSON.parse(out);
}

function writeActiveTicket(root, id) {
  fs.writeFileSync(path.join(root, 'backlog', 'active', `${id}.yaml`), `id: ${id}\nstatus: active\n`);
}

// Evaluates a pure operator-lib EDN form against the real operator_lib.bb
// and returns its printed result (a bb-formatted EDN/boolean/string).
function evalOperatorLib(form) {
  return execFileSync('bb', ['-e', `(load-file "${OPERATOR_LIB}") (println ${form})`], {
    encoding: 'utf8',
  }).trim();
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────────
  registry.define(/^the swarm is running with auto-hibernate enabled$/, (ctx) => {
    ctx.root = ctx.root || mkRosterFixture(['coder']);
  });

  registry.define(/^the backlog is currently drained \(no active items\)$/, (ctx) => {
    ctx.root = ctx.root || mkRosterFixture(['coder']);
    // mkRosterFixture already leaves backlog/active empty.
  });

  registry.define(/^all pipeline roles are quiescent \(empty inbox\/new, no in_process\)$/, (ctx) => {
    ctx.root = ctx.root || mkRosterFixture(['coder']);
    // mkRosterFixture already leaves every role's mailbox empty.
  });

  // ── autopark-coordinator-self-generates-01 ───────────────────────────────
  registry.define(/^the coordinator has no self-generated tickets to promote$/, (ctx) => {
    ctx.root = ctx.root || mkRosterFixture(['coder']);
    // No paused/ items at all - nothing to promote, self-generated or not.
  });

  registry.define(/^the backlog is drained and all roles are quiescent$/, (ctx) => {
    ctx.root = ctx.root || mkRosterFixture(['coder']);
  });

  registry.define(/^the hibernation threshold is reached$/, (ctx) => {
    ctx.tickResult = tickOnce(ctx.root);
    // Settle past this tick's own dead-agent pending event, exactly as
    // operatorAutoHibernateSteps.js's swarm-auto-hibernate-01 case does.
    ctx.tickResult = tickOnce(ctx.root);
  });

  registry.define(/^the swarm should hibernate$/, (ctx) => {
    const state = readHibernationState(ctx.root);
    if (!state || state.hibernated !== true) {
      throw new Error(`expected the swarm to be hibernated, got: ${JSON.stringify(state)}`);
    }
    const rosterContent = fs.readFileSync(rolesTsvPath(ctx.root), 'utf8');
    if (rosterContent.trim() !== '') {
      throw new Error(`expected roles.tsv to be emptied, got: ${JSON.stringify(rosterContent)}`);
    }
  });

  // ── autopark-coordinator-self-generates-02 ───────────────────────────────
  registry.define(/^a ticket is created by the coordinator itself$/, (ctx) => {
    ctx.selfGenReason = 'cost review flagged idle quota';
  });

  registry.define(/^the ticket is written to the backlog$/, (ctx) => {
    ctx.sourceLine = evalOperatorLib(
      `(operator-lib/format-self-generated-source "${ctx.selfGenReason}")`
    );
  });

  registry.define(/^the ticket's source field should identify the coordinator as the origin$/, (ctx) => {
    if (!ctx.sourceLine.includes('coordinator itself')) {
      throw new Error(`expected the source field to name the coordinator, got: ${JSON.stringify(ctx.sourceLine)}`);
    }
    const isSelfGenerated = evalOperatorLib(
      `(operator-lib/self-generated-item? {:source "${ctx.sourceLine}"})`
    );
    if (isSelfGenerated !== 'true') {
      throw new Error(`expected self-generated-item? to recognize its own written source, got: ${isSelfGenerated}`);
    }
  });

  registry.define(/^the source field should not falsely claim human origin$/, (ctx) => {
    if (ctx.sourceLine.toLowerCase().includes('raised by the human')) {
      throw new Error(`self-generated source field falsely claims human origin: ${JSON.stringify(ctx.sourceLine)}`);
    }
    const honest = evalOperatorLib(`(operator-lib/honest-source? "${ctx.sourceLine}" true)`);
    if (honest !== 'true') {
      throw new Error(`expected honest-source? to hold for the tool-written source line, got: ${honest}`);
    }
  });

  // ── autopark-coordinator-self-generates-03 ───────────────────────────────
  registry.define(/^the swarm is hibernated due to drained backlog$/, (ctx) => {
    ctx.root = mkRosterFixture(['coder']);
    tickOnce(ctx.root);
    tickOnce(ctx.root); // settle
    const state = readHibernationState(ctx.root);
    if (!state || state.hibernated !== true) {
      throw new Error(`expected the fixture to already be hibernated, got: ${JSON.stringify(state)}`);
    }
  });

  registry.define(/^a human-raised ticket arrives$/, (ctx) => {
    writeActiveTicket(ctx.root, 'BL-600');
    ctx.tickResult = tickOnce(ctx.root);
  });

  registry.define(/^the swarm should wake and process the ticket$/, (ctx) => {
    if (fs.existsSync(hibernationStatePath(ctx.root))) {
      throw new Error('expected hibernation.json to be cleared once relaunched for a human-raised ticket');
    }
    const rosterContent = fs.readFileSync(rolesTsvPath(ctx.root), 'utf8');
    if (!rosterContent.includes('coder')) {
      throw new Error(`expected the roster restored on relaunch, got: ${JSON.stringify(rosterContent)}`);
    }
  });

  // ── autopark-coordinator-self-generates-04 ───────────────────────────────
  registry.define(/^the coordinator has a self-generated ticket in paused$/, (ctx) => {
    ctx.candidateSource = evalOperatorLib(
      '(operator-lib/format-self-generated-source "cost review flagged idle quota")'
    );
  });

  registry.define(/^evaluating promotion eligibility$/, (ctx) => {
    ctx.promotionBlocked = evalOperatorLib(
      `(operator-lib/promotion-blocked-by-quiet-period? {:source "${ctx.candidateSource}"} {:backlog-drained? true :roster-idle? true})`
    );
  });

  registry.define(/^the self-generated ticket should not be promoted while the hibernation condition holds$/, (ctx) => {
    if (ctx.promotionBlocked !== 'true') {
      throw new Error(`expected promotion-blocked-by-quiet-period? to block the self-generated candidate, got: ${ctx.promotionBlocked}`);
    }
  });
}

module.exports = { registerSteps };
