'use strict';

// BL-985: step handlers for "a role's command never runs in another role's
// worktree". Every scenario composes the REAL wrapper (safe-wrapper-command
// via bb, loading the real tool_miss_heal_lib.bb) and EXECUTES it with bash
// from the drawn working directory over a real master-checkout +
// .worktrees/<role> fixture (git worktree add - the live layout's shape).
//
// Invariant 1 (BL-968) applies: module load is requires and pure constants
// only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = "BL-985 a role's command never runs in another role's worktree";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HEAL_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'tool_miss_heal_lib.bb');

// KNOWN_VALUES: scenario 01's <drifted_cwd> tokens.
const KNOWN_DRIFTS = new Set(['.worktrees/documenter', '.worktrees/architect']);

function mkFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl985-acc-'));
  ctx.root = root;
  const master = path.join(root, 'master');
  fs.mkdirSync(master, { recursive: true });
  const git = (args, cwd = master) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  git(['init', '-q', '.']);
  fs.mkdirSync(path.join(master, 'extension'), { recursive: true });
  fs.writeFileSync(path.join(master, 'f.txt'), 'x\n');
  git(['add', '-A']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init']);
  git(['branch', '-M', 'master']);
  for (const w of ['documenter', 'architect']) {
    git(['worktree', 'add', '-q', path.join(master, '.worktrees', w), '-b', `swarm/${w}`]);
  }
  ctx.master = master;
  ctx.masterResolved = execFileSync('pwd', ['-P'], { cwd: master, encoding: 'utf8' }).trim();
  ctx.outside = path.join(root, 'nowhere');
  fs.mkdirSync(ctx.outside, { recursive: true });
}

function composeWrapper(ctx, command) {
  const res = spawnSync(
    'bb',
    ['-e', `(load-file ${JSON.stringify(HEAL_LIB)}) (print (tool-miss-heal-lib/safe-wrapper-command ${JSON.stringify(command)} ${JSON.stringify(ctx.master)}))`],
    { encoding: 'utf8', timeout: 60000 }
  );
  assert.equal(res.status, 0, `wrapper composition failed: ${res.stderr}`);
  assert.ok(res.stdout.length > 0, 'composition fail-opened unexpectedly');
  return res.stdout;
}

function runWrapper(wrapper, cwd) {
  return spawnSync('bash', ['-c', wrapper], { cwd, encoding: 'utf8', timeout: 60000 });
}

function cleanup(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = null;
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a role whose pinned worktree is the repository master checkout$/, (ctx) => {
    mkFixture(ctx);
  });

  scoped(/^the shell's working directory has drifted to "([^"]+)"$/, (ctx, token) => {
    if (!KNOWN_DRIFTS.has(token)) {
      throw new Error(`unknown <drifted_cwd> token: ${token}`);
    }
    ctx.cwd = path.join(ctx.master, token);
    ctx.driftBranch = `swarm/${path.basename(token)}`;
  });
  scoped(/^the command would succeed unchanged in that directory$/, (ctx) => {
    // Precondition, proven not assumed: unwrapped, the probe command
    // SUCCEEDS at the drifted cwd - and reports the DRIFTED branch, the
    // exact silent-wrong-worktree shape the old output-matching guard
    // could never see.
    const probe = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ctx.cwd, encoding: 'utf8' });
    assert.equal(probe.status, 0, 'the probe command must succeed at the drifted cwd');
    assert.equal(probe.stdout.trim(), ctx.driftBranch, 'the drifted cwd must report its own branch unwrapped');
  });

  scoped(/^the role runs a command through the heal wrapper$/, (ctx) => {
    ctx.original = 'pwd -P; git rev-parse --abbrev-ref HEAD';
    ctx.wrapper = composeWrapper(ctx, ctx.original);
    ctx.run = runWrapper(ctx.wrapper, ctx.cwd || ctx.master);
  });

  // Shared by scenarios 01 and 03. It is scenario 03's TERMINAL step (03
  // has no further Then), so on the outside-any-repo path it owns the
  // fixture cleanup; scenario 01 continues and cleans in its own last step.
  scoped(/^the command executes with the pinned worktree as its working directory$/, (ctx) => {
    const terminal = ctx.cwd === ctx.outside;
    try {
      const lines = ctx.run.stdout.trim().split('\n');
      assert.equal(lines[0], ctx.masterResolved, `expected the pinned worktree as cwd, got: ${ctx.run.stdout}`);
    } finally {
      if (terminal) {
        cleanup(ctx);
      }
    }
  });
  scoped(/^the drifted directory contributes nothing to what the command reads or writes$/, (ctx) => {
    try {
      const lines = ctx.run.stdout.trim().split('\n');
      assert.equal(lines[1], 'master', `the command must see master's branch, not ${ctx.driftBranch}: ${ctx.run.stdout}`);
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the shell's working directory is the pinned worktree$/, (ctx) => {
    ctx.cwd = ctx.master;
  });
  scoped(/^the command reaches the shell byte-untouched$/, (ctx) => {
    try {
      // Byte-untouched: the wrapper embeds the original text byte-identical
      // (never rewritten), and with no drift the shell is left exactly
      // where it was - the command's own pwd proves it.
      assert.ok(ctx.wrapper.includes(ctx.original), 'the original must appear byte-identical inside the wrapper');
      const lines = ctx.run.stdout.trim().split('\n');
      assert.equal(lines[0], ctx.masterResolved, `no-drift run must stay put: ${ctx.run.stdout}`);
      assert.equal(ctx.run.status, 0, `no-drift run must succeed: ${ctx.run.stderr}`);
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the shell's working directory is outside any git repository$/, (ctx) => {
    ctx.cwd = ctx.outside;
  });

  scoped(/^the role runs a multi-segment command through the heal wrapper$/, (ctx) => {
    ctx.original = 'pwd -P; cd extension && pwd -P';
    ctx.wrapper = composeWrapper(ctx, ctx.original);
    ctx.run = runWrapper(ctx.wrapper, ctx.cwd);
  });
  scoped(/^every segment executes with the pinned worktree as its working directory$/, (ctx) => {
    try {
      const lines = ctx.run.stdout.trim().split('\n');
      assert.deepEqual(
        lines,
        [ctx.masterResolved, path.join(ctx.masterResolved, 'extension')],
        `every segment must run from the pinned worktree: ${ctx.run.stdout}`
      );
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
