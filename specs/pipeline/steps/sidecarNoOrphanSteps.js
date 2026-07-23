'use strict';

// BL-232: step handlers for the chase/nudge-sidecars-never-orphan feature.
// Drives the REAL ready_for_next_task.bb/ready_for_next_batch.bb (dequeue)
// and chase_sweep_lib.bb's run-sweep! via chase_sweep_test_runner.bb (sweep
// reaping), mirroring readyForNextPromotionSteps.js's own git-worktree
// fixture pattern and test_chase_sweep.sh's fixed-clock sweep pattern - no
// live tmux/daemon needed.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const READY_TASK = path.join(SCRIPTS_DIR, 'ready_for_next_task.bb');
const READY_BATCH = path.join(SCRIPTS_DIR, 'ready_for_next_batch.bb');
const SWEEP_RUNNER = path.join(SCRIPTS_DIR, 'test', 'chase_sweep_test_runner.bb');

// A fixed clock (matching test_chase_sweep.sh's own NOW_MS) - file mtimes
// are stamped against it explicitly rather than real wall-clock time, so
// "freshly queued, well under any chase/dead-letter timeout" is
// deterministic regardless of when the test actually runs.
const NOW_MS = 1751500000 * 1000;

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

// Builds a real git worktree fixture for one role (roles.tsv's own receive
// mode is unused for dispatch here - the dequeue step below picks the
// task/batch script itself from ctx.mode - but a value is still required
// for a well-formed roles.tsv row).
function mkWorktreeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-sidecar-orphan-'));
  git(root, ['init', '-q']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);

  const worktree = path.join(root, '.worktrees', 'fixturerole');
  git(root, ['worktree', 'add', '-q', '-b', 'fixturerole', worktree]);

  const rolesTsv = `fixturerole\tfixturerole\t${worktree}\tswarmforge-fixturerole\tFixturerole\tclaude\ttask\n`;
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), rolesTsv);
  fs.mkdirSync(path.join(worktree, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(worktree, '.swarmforge', 'roles.tsv'), rolesTsv);

  const inboxNewDir = path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'new');
  const inProcessDir = path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(inboxNewDir, { recursive: true });
  fs.mkdirSync(inProcessDir, { recursive: true });

  return { worktree, inboxNewDir };
}

function writeQueuedHandoff(inboxNewDir, name) {
  const handoffPath = path.join(inboxNewDir, name);
  fs.writeFileSync(
    handoffPath,
    'id: t\nfrom: specifier\nto: fixturerole\nrecipient: fixturerole\npriority: 50\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n'
  );
  const stamp = new Date(NOW_MS);
  fs.utimesSync(handoffPath, stamp, stamp);
  return handoffPath;
}

function dequeue(worktree, mode) {
  // Strict, not a `=== 'batch' ? ... : task-default` fallthrough: a
  // fallthrough treats any unrecognized mode string as "task", so a
  // mutated/typo'd "batch" example silently runs the task-mode script
  // and the sidecar-cleanup assertions below can't tell the difference
  // (both scripts carry the BL-232 fix) - the mode value itself would
  // never be load-bearing to this scenario.
  if (mode !== 'task' && mode !== 'batch') {
    throw new Error(`dequeue() got an unrecognized receive mode "${mode}" - expected "task" or "batch"`);
  }
  const script = mode === 'batch' ? READY_BATCH : READY_TASK;
  return execFileSync('bb', [script], {
    cwd: worktree,
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ROLE: 'fixturerole' },
  });
}

// fixtureRoot must contain inbox/new/ + inbox/in_process/ - both a
// worktree's .swarmforge/handoffs dir and a standalone sweep-only fixture
// dir (mkStandaloneSweepFixture below) satisfy that shape.
function runSweep(fixtureRoot) {
  execFileSync('bb', [SWEEP_RUNNER, fixtureRoot, String(NOW_MS), 'alive', String(NOW_MS)], { encoding: 'utf8' });
}

function mkStandaloneSweepFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-sidecar-orphan-sweep-'));
  fs.mkdirSync(path.join(root, 'inbox', 'new'), { recursive: true });
  fs.mkdirSync(path.join(root, 'inbox', 'in_process'), { recursive: true });
  return root;
}

function registerSteps(registry) {
  registry.define(/^a role mailbox with an inbox\/new\/ directory$/, () => {
    // Documents the shared precondition - each scenario's own Given below
    // builds the specific fixture (worktree or standalone) it needs.
  });

  // ── sidecar-not-orphaned-on-dequeue-01 (Scenario Outline) ───────────────
  registry.define(/^a queued handoff H in inbox\/new\/ with a "([^"]+)" sidecar beside it$/, (ctx, suffix) => {
    const { worktree, inboxNewDir } = mkWorktreeFixture();
    ctx.worktree = worktree;
    ctx.handoffPath = writeQueuedHandoff(inboxNewDir, '50_item.handoff');
    ctx.suffix = suffix;
    fs.writeFileSync(ctx.handoffPath + suffix, JSON.stringify({ chaseCount: 1, nudgeCount: 1 }));
  });

  registry.define(/^the role's receive mode is "(\w+)"$/, (ctx, mode) => {
    ctx.mode = mode;
  });

  registry.define(/^the role dequeues its next work$/, (ctx) => {
    ctx.dequeueOutput = dequeue(ctx.worktree, ctx.mode || 'task');
  });

  registry.define(/^H is no longer in inbox\/new\/$/, (ctx) => {
    if (fs.existsSync(ctx.handoffPath)) {
      throw new Error(`expected H to be dequeued out of inbox/new/, but it is still present: ${ctx.handoffPath}`);
    }
  });

  registry.define(/^no "([^"]+)" sidecar for H remains in inbox\/new\/$/, (ctx, suffix) => {
    const sidecar = ctx.handoffPath + suffix;
    if (fs.existsSync(sidecar)) {
      throw new Error(`expected no orphaned sidecar in inbox/new/ after dequeue, but found: ${sidecar}`);
    }
  });

  // ── orphaned-sidecar-reaped-02 (Scenario Outline) ───────────────────────
  registry.define(/^a "([^"]+)" sidecar in inbox\/new\/ with no matching \.handoff present$/, (ctx, suffix) => {
    ctx.sweepRoot = mkStandaloneSweepFixture();
    ctx.sidecarPath = path.join(ctx.sweepRoot, 'inbox', 'new', '00_gone.handoff' + suffix);
    fs.writeFileSync(ctx.sidecarPath, JSON.stringify({ chaseCount: 1, nudgeCount: 1 }));
  });

  registry.define(/^the handoff sweep runs$/, (ctx) => {
    runSweep(ctx.sweepRoot || path.join(ctx.worktree, '.swarmforge', 'handoffs'));
  });

  registry.define(/^the orphaned "([^"]+)" sidecar is removed from inbox\/new\/$/, (ctx, suffix) => {
    if (fs.existsSync(ctx.sidecarPath)) {
      throw new Error(`expected the orphaned ${suffix} sidecar to be reaped by the sweep, but it still exists: ${ctx.sidecarPath}`);
    }
  });

  // ── live-sidecar-preserved-03 ────────────────────────────────────────────
  registry.define(/^H has not yet been dequeued$/, () => {
    // Nothing to do - the earlier Given already queued H in inbox/new/ and
    // this scenario's own When ("the handoff sweep runs") never dequeues it.
  });

  registry.define(/^H and its "\.chase\.json" sidecar both remain in inbox\/new\/$/, (ctx) => {
    if (!fs.existsSync(ctx.handoffPath)) {
      throw new Error(`expected H to still be queued in inbox/new/, but it is gone: ${ctx.handoffPath}`);
    }
    if (!fs.existsSync(ctx.handoffPath + '.chase.json')) {
      throw new Error('expected the live .chase.json sidecar to be preserved, but it was removed');
    }
  });

  // ── non-sidecar-file-untouched-04 ────────────────────────────────────────
  registry.define(/^a file "notes\.txt" that is not a chase\/nudge sidecar in inbox\/new\/$/, (ctx) => {
    const { worktree, inboxNewDir } = mkWorktreeFixture();
    ctx.worktree = worktree;
    ctx.notesPath = path.join(inboxNewDir, 'notes.txt');
    fs.writeFileSync(ctx.notesPath, 'just some notes\n');
  });

  registry.define(/^"notes\.txt" still exists in inbox\/new\/$/, (ctx) => {
    if (!fs.existsSync(ctx.notesPath)) {
      throw new Error('expected notes.txt to still exist in inbox/new/, but it was removed');
    }
  });
}

module.exports = { registerSteps };
