'use strict';

// BL-226: step handlers for the ready-for-next-never-promotes feature.
// Drives the REAL ready_for_next.bb against a real git worktree fixture
// (mirroring backlogDepthSteps.js's own fixture pattern) - no live tmux/
// daemon needed, just a queued inbox task per role's receive mode.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const READY_FOR_NEXT = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'ready_for_next.bb');

const HELPER_MARKER = {
  'ready_for_next_task.sh': /^TASK:/m,
  'ready_for_next_batch.sh': /^BATCH:/m,
};

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function mkFixtureWithRole(mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-ready-for-next-'));
  git(root, ['init', '-q']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  const commit = execFileSync('git', ['-C', root, 'rev-parse', '--short=10', 'HEAD'], { encoding: 'utf8' }).trim();

  const worktree = path.join(root, '.worktrees', 'fixturerole');
  git(root, ['worktree', 'add', '-q', '-b', 'fixturerole', worktree]);

  const rolesTsv = `fixturerole\tfixturerole\t${worktree}\tswarmforge-fixturerole\tFixturerole\tclaude\t${mode}\n`;
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), rolesTsv);
  fs.mkdirSync(path.join(worktree, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(worktree, '.swarmforge', 'roles.tsv'), rolesTsv);

  const inboxNew = path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'new');
  fs.mkdirSync(inboxNew, { recursive: true });
  fs.writeFileSync(
    path.join(inboxNew, '50_item1.handoff'),
    `id: item1\nfrom: specifier\nto: fixturerole\nrecipient: fixturerole\npriority: 50\ntype: git_handoff\ntask: BL-226-dispatch-test\ncommit: ${commit}\n\npayload\n`
  );

  return worktree;
}

function runReadyForNext(worktree) {
  return execFileSync('bb', [READY_FOR_NEXT], {
    cwd: worktree,
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ROLE: 'fixturerole' },
  });
}

function registerSteps(registry) {
  // ── dispatch-unchanged-01 ────────────────────────────────────────────
  registry.define(/^a role whose receive mode is "(\w+)"$/, (ctx, mode) => {
    ctx.mode = mode;
    ctx.worktree = mkFixtureWithRole(mode);
  });

  registry.define(/^ready_for_next runs$/, (ctx) => {
    ctx.output = runReadyForNext(ctx.worktree);
  });

  registry.define(/^it execs "([^"]+)" as before$/, (ctx, helper) => {
    const marker = HELPER_MARKER[helper];
    if (!marker) {
      throw new Error(`unknown helper "${helper}" - no known output marker to check`);
    }
    if (!marker.test(ctx.output)) {
      throw new Error(`expected output matching ${marker} (i.e. routed to ${helper}), got: ${ctx.output}`);
    }
  });

  // ── no-helper-promotion-02 ───────────────────────────────────────────
  registry.define(/^a paused backlog item with backlog\/active\/ below the depth cap$/, (ctx) => {
    ctx.worktree = mkFixtureWithRole('task');
    fs.mkdirSync(path.join(ctx.worktree, 'backlog', 'active'), { recursive: true });
    fs.mkdirSync(path.join(ctx.worktree, 'backlog', 'paused'), { recursive: true });
    fs.mkdirSync(path.join(ctx.worktree, 'swarmforge'), { recursive: true });
    fs.writeFileSync(path.join(ctx.worktree, 'backlog', 'paused', 'BL-9001-demo.yaml'), 'id: BL-9001\ntitle: "demo"\nstatus: paused\n');
    fs.writeFileSync(path.join(ctx.worktree, 'swarmforge', 'swarmforge.conf'), 'config active_backlog_max_depth 10\n');
  });

  registry.define(/^no item is moved from backlog\/paused\/ to backlog\/active\/ by the helper$/, (ctx) => {
    if (!fs.existsSync(path.join(ctx.worktree, 'backlog', 'paused', 'BL-9001-demo.yaml'))) {
      throw new Error('expected the paused item to still be in backlog/paused/, but it is gone');
    }
    if (fs.existsSync(path.join(ctx.worktree, 'backlog', 'active', 'BL-9001-demo.yaml'))) {
      throw new Error('expected no item promoted into backlog/active/, but it appeared there');
    }
  });
}

module.exports = { registerSteps };
