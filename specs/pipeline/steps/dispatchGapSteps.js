'use strict';

// BL-222: step handlers for the dispatch-gap-autoroute feature. Drives the
// real chase_sweep_lib.bb + swarm_handoff.bb through
// dispatch_gap_sweep_harness.bb (a thin test-only wrapper mirroring
// handoffd.bb's own dispatch-gap-sweep!/auto-route! exactly) - never a live
// daemon or tmux session. Real delivery (the tmux-dependent half of
// swarm_handoff.bb) is already covered by that script's own test suite;
// these steps scope to what BL-222 adds: detection and the auto-route send.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const SWEEP_HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'dispatch_gap_sweep_harness.bb');

const ITEM_ID = 'BL-217';

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function ensureTargetPath(ctx) {
  if (!ctx.targetPath) {
    ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-dispatch-gap-'));
    git(ctx.targetPath, ['init', '-q']);
    git(ctx.targetPath, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  }
  return ctx.targetPath;
}

function coderWorktree(ctx) {
  return path.join(ctx.targetPath, '.worktrees', 'coder');
}

function cleanerWorktree(ctx) {
  return path.join(ctx.targetPath, '.worktrees', 'cleaner');
}

function writeRolesTsv(ctx) {
  const targetPath = ctx.targetPath;
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  const rows = [
    ['coordinator', 'master', targetPath, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task'],
    ['coder', 'coder', coderWorktree(ctx), 'swarmforge-coder', 'Coder', 'claude', 'task'],
    ['cleaner', 'cleaner', cleanerWorktree(ctx), 'swarmforge-cleaner', 'Cleaner', 'claude', 'batch'],
  ];
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), rows.map((r) => r.join('\t')).join('\n') + '\n');
}

function writeActiveItem(ctx) {
  const activeDir = path.join(ctx.targetPath, 'backlog', 'active');
  fs.mkdirSync(activeDir, { recursive: true });
  fs.writeFileSync(
    path.join(activeDir, `${ITEM_ID}-demo.yaml`),
    `id: ${ITEM_ID}\ntitle: "demo"\nstatus: todo\nassigned_to: coder\n`
  );
}

function writeHandoff(dir, basename, headers) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(path.join(dir, basename), lines.join('\n') + '\n\nbody\n');
}

function coordinatorOutboxDir(ctx) {
  return path.join(ctx.targetPath, '.swarmforge', 'handoffs', 'coordinator', 'outbox');
}

function listQueuedNotesFor(ctx, itemId) {
  const dir = coordinatorOutboxDir(ctx);
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.handoff'));
  } catch {
    files = [];
  }
  return files
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .filter((content) => new RegExp(`^message: ${itemId}`, 'm').test(content));
}

function registerSteps(registry) {
  registry.define(/^an item in backlog\/active\/ assigned to a role$/, (ctx) => {
    ensureTargetPath(ctx);
    writeRolesTsv(ctx);
    writeActiveItem(ctx);
  });

  registry.define(/^the sweep runs at the existing chase interval$/, () => {
    // Non-behavioral gate (no separate dispatch-gap timeout): pin that
    // dispatch-gap-sweep! is wired into the SAME cadence conditional as
    // chase-sweep! in handoffd.bb, not a standalone timer.
    const src = fs.readFileSync(path.join(SWARMFORGE_SCRIPTS, 'handoffd.bb'), 'utf8');
    const cadenceBlock = src.split('chase-sweep-every-cycles))')[1] || '';
    if (!/dispatch-gap-sweep!/.test(cadenceBlock.slice(0, 600))) {
      throw new Error('expected dispatch-gap-sweep! to share chase-sweep!\'s existing cadence, not a separate timeout');
    }
  });

  registry.define(/^the assignee's mailbox holds no routing handoff for the item$/, () => {
    // No-op: the Background's fixture already has zero dispatch trail.
  });

  registry.define(/^the item already has a routing handoff for the assignee$/, (ctx) => {
    writeHandoff(path.join(coderWorktree(ctx), '.swarmforge', 'handoffs', 'inbox', 'new'), '00_a.handoff', {
      from: 'coordinator',
      to: 'coder',
      type: 'note',
      message: `${ITEM_ID} active, spec-complete - pick up next.`,
    });
  });

  registry.define(/^the item has already progressed to a later pipeline role$/, (ctx) => {
    writeHandoff(path.join(cleanerWorktree(ctx), '.swarmforge', 'handoffs', 'inbox', 'new'), '00_a.handoff', {
      from: 'coder',
      to: 'cleaner',
      type: 'git_handoff',
      task: `${ITEM_ID}-demo`,
      commit: '0000000000',
    });
  });

  registry.define(/^the sweep runs$/, (ctx) => {
    const targetPath = ensureTargetPath(ctx);
    ctx.sweepOutput = execFileSync('bb', [SWEEP_HARNESS, targetPath], { encoding: 'utf8' });
  });

  registry.define(/^the assignee receives a routing handoff for the item$/, (ctx) => {
    const queued = listQueuedNotesFor(ctx, ITEM_ID);
    if (queued.length === 0) {
      throw new Error(`expected an auto-routed note for ${ITEM_ID} queued via the real swarm_handoff.bb, got sweep output: ${ctx.sweepOutput}`);
    }
    if (!queued.some((content) => /^to: coder$/m.test(content))) {
      throw new Error(`expected the queued note addressed to the assignee (coder), got: ${queued.join('\n---\n')}`);
    }
  });

  registry.define(/^the sweep sends no further routing handoff for the item$/, (ctx) => {
    const queued = listQueuedNotesFor(ctx, ITEM_ID);
    if (queued.length > 0) {
      throw new Error(`expected no auto-routed note for ${ITEM_ID} (already dispatched or progressed), got: ${queued.join('\n---\n')}`);
    }
  });
}

module.exports = { registerSteps };
