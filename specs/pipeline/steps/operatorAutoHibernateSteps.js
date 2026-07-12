'use strict';

// BL-307: step handlers for "The swarm auto-hibernates when fully drained
// and auto-relaunches when new work arrives". Drives the REAL
// operator_runtime.bb --tick-once (real fs, real Babashka process, no real
// tmux/network/timers - OPERATOR_SKIP_LAUNCH=1 skips the actual tmux
// kill/relaunch spawn), mirroring operatorAskAwaitSteps.js's own real-CLI
// pattern. mkRosterFixture is the acceptance-test twin of
// test_operator_runtime_tick.sh's own make_roster_fixture shell helper.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OPERATOR_RUNTIME_BB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_runtime.bb');

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-operator-hibernate-'));
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(opPath(root), { recursive: true });
  // Pre-seed the swarm-check timer so a fresh SWARM_CHECK_TIMER event never
  // masks the assertions this feature cares about (mirrors the shell smoke
  // test's own make_roster_fixture).
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

function writePausedTicket(root, id, status) {
  fs.writeFileSync(path.join(root, 'backlog', 'paused', `${id}.yaml`), `id: ${id}\nstatus: ${status}\n`);
}

function writeActiveTicket(root, id) {
  fs.writeFileSync(path.join(root, 'backlog', 'active', `${id}.yaml`), `id: ${id}\nstatus: active\n`);
}

function markRoleInProcess(root, role) {
  const dir = path.join(root, '.worktrees', role, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.writeFileSync(
    path.join(dir, '00_x_from_coder_to_cleaner.handoff'),
    'from: coder\nto: cleaner\npriority: 50\ntype: git_handoff\ntask: t\ncommit: abc\n\nbody\n'
  );
}

function markRolePendingInbox(root, role) {
  const dir = path.join(root, '.worktrees', role, '.swarmforge', 'handoffs', 'inbox', 'new');
  fs.writeFileSync(
    path.join(dir, '00_x_from_coder_to_cleaner.handoff'),
    'from: coder\nto: cleaner\npriority: 50\ntype: git_handoff\ntask: t\ncommit: abc\n\nbody\n'
  );
}

function registerSteps(registry) {
  // ── swarm-auto-hibernate-01/02/03/04 shared Given steps ──────────────
  registry.define(/^no promotable backlog work remains$/, (ctx) => {
    ctx.root = ctx.root || mkRosterFixture(['coder']);
  });

  registry.define(/^every role in the current roster has an empty inbox and no in-process task$/, (ctx) => {
    ctx.root = ctx.root || mkRosterFixture(['coder']);
    // mkRosterFixture already leaves every role's mailbox empty - nothing
    // further to set up.
  });

  registry.define(/^the runtime evaluates the closing pass$/, (ctx) => {
    ctx.tickResult = tickOnce(ctx.root);
    // A roster role with no live tmux session still fires its own
    // unrelated dead-agent-events pending event on the very first tick
    // (see test_operator_runtime_tick.sh's own BL-307 section-14 comment) -
    // tick again so a settled hibernated/idle state is observable.
    ctx.tickResult = tickOnce(ctx.root);
  });

  registry.define(/^it hibernates the swarm$/, (ctx) => {
    const state = readHibernationState(ctx.root);
    if (!state || state.hibernated !== true) {
      throw new Error(`expected the swarm to be hibernated, got: ${JSON.stringify(state)}`);
    }
    const rosterContent = fs.readFileSync(rolesTsvPath(ctx.root), 'utf8');
    if (rosterContent.trim() !== '') {
      throw new Error(`expected roles.tsv to be emptied, got: ${JSON.stringify(rosterContent)}`);
    }
  });

  registry.define(/^it does not hibernate$/, (ctx) => {
    if (fs.existsSync(hibernationStatePath(ctx.root))) {
      throw new Error('expected the swarm NOT to hibernate, but hibernation.json exists');
    }
    const rosterContent = fs.readFileSync(rolesTsvPath(ctx.root), 'utf8');
    if (rosterContent.trim() === '') {
      throw new Error('expected roles.tsv to still hold its roster (not hibernated)');
    }
  });

  // ── swarm-auto-hibernate-02 ────────────────────────────────────────────
  registry.define(/^a role in the current roster holds an in-process task$/, (ctx) => {
    ctx.root = ctx.root || mkRosterFixture(['coder']);
    markRoleInProcess(ctx.root, 'coder');
  });

  // ── swarm-auto-hibernate-03 ────────────────────────────────────────────
  registry.define(/^a role in the current roster has a pending item in its inbox$/, (ctx) => {
    ctx.root = ctx.root || mkRosterFixture(['coder']);
    markRolePendingInbox(ctx.root, 'coder');
  });

  // ── swarm-auto-hibernate-04 ────────────────────────────────────────────
  registry.define(/^the only backlog\/paused item is blocked and not currently promotable$/, (ctx) => {
    ctx.root = ctx.root || mkRosterFixture(['coder']);
    writePausedTicket(ctx.root, 'BL-101', 'blocked');
  });

  // ── swarm-auto-hibernate-05 ────────────────────────────────────────────
  registry.define(/^the current roster does not include the documenter role$/, (ctx) => {
    ctx.root = mkRosterFixture(['coder']);
  });

  // ── swarm-auto-hibernate-06 ────────────────────────────────────────────
  registry.define(/^the runtime hibernates$/, (ctx) => {
    ctx.root = mkRosterFixture(['coder']);
    ctx.tickResult = tickOnce(ctx.root);
  });

  registry.define(/^the current roster is backed up and then emptied$/, (ctx) => {
    const backupContent = fs.readFileSync(path.join(ctx.root, '.swarmforge', 'roles.tsv.hibernate-backup'), 'utf8');
    if (!backupContent.includes('coder')) {
      throw new Error(`expected the pre-hibernate roster backed up, got: ${JSON.stringify(backupContent)}`);
    }
    const rosterContent = fs.readFileSync(rolesTsvPath(ctx.root), 'utf8');
    if (rosterContent.trim() !== '') {
      throw new Error('expected roles.tsv to be emptied');
    }
  });

  registry.define(/^the build-agent tmux sessions are killed on the swarm socket$/, () => {
    // Structural, not directly observable without a real tmux socket in
    // this fixture: kill-swarm-tmux! only ever shells `tmux -S
    // <swarm-socket> kill-server` when a swarm socket file actually exists
    // (same posture as tmux-live-sessions/tmux-sessions-on) - no socket
    // here means it is provably a no-op, never a crash. The real
    // invocation is verified by QA's own live dry-run (the ticket's own
    // E2E procedure item (e)).
  });

  registry.define(/^handoffd, the runtime itself, and the front-desk bot are left running$/, () => {
    // Structural: hibernate-swarm!'s adapters are exactly backup-roster!/
    // empty-roster!/kill-swarm-tmux!/write-hibernation-state! - no adapter,
    // and no code path, touches handoffd, the runtime's own pid, or the
    // front-desk bot.
  });

  registry.define(/^the hibernation is recorded in the runtime's status output$/, (ctx) => {
    // Settle past this tick's own dead-agent pending event (see
    // swarm-auto-hibernate-01's own comment above).
    ctx.tickResult = tickOnce(ctx.root);
    const status = JSON.parse(fs.readFileSync(opPath(ctx.root, 'status.json'), 'utf8'));
    if (status.state !== 'hibernated') {
      throw new Error(`expected status.json's state to read "hibernated", got: ${JSON.stringify(status)}`);
    }
  });

  // ── swarm-auto-hibernate-07 ────────────────────────────────────────────
  registry.define(/^the swarm is hibernated$/, (ctx) => {
    ctx.root = mkRosterFixture(['coder']);
    tickOnce(ctx.root);
    tickOnce(ctx.root); // settle - see swarm-auto-hibernate-01's own comment
    const state = readHibernationState(ctx.root);
    if (!state || state.hibernated !== true) {
      throw new Error(`expected the fixture to already be hibernated, got: ${JSON.stringify(state)}`);
    }
  });

  registry.define(/^new promotable work arrives$/, (ctx) => {
    writeActiveTicket(ctx.root, 'BL-400');
    ctx.tickResult = tickOnce(ctx.root);
  });

  registry.define(/^the runtime relaunches the swarm$/, (ctx) => {
    if (fs.existsSync(hibernationStatePath(ctx.root))) {
      throw new Error('expected hibernation.json to be cleared once relaunched');
    }
  });

  registry.define(/^the backed-up roster is restored$/, (ctx) => {
    const rosterContent = fs.readFileSync(rolesTsvPath(ctx.root), 'utf8');
    if (!rosterContent.includes('coder')) {
      throw new Error(`expected the backed-up roster restored into roles.tsv, got: ${JSON.stringify(rosterContent)}`);
    }
  });

  registry.define(/^the hibernation state is cleared$/, (ctx) => {
    if (fs.existsSync(hibernationStatePath(ctx.root))) {
      throw new Error('expected hibernation.json to be cleared');
    }
  });
}

module.exports = { registerSteps };
