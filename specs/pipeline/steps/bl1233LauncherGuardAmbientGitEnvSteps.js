'use strict';

// BL-1233: an ambient GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE must not blind
// sync_worktree_scripts.bb's tracked-path guard (BL-373) into clobbering a
// role worktree's own git-tracked scripts. Drives the REAL
// sync_worktree_scripts.bb CLI against real throwaway git fixtures - never
// a JS reimplementation of the tracked-path query or the trust check.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'sync_worktree_scripts.bb');

const FEATURE_NAME = "the launcher's tracked-path guard cannot be blinded by an ambient git environment";

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function gitC(root, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-C', root, ...args], {
    encoding: 'utf8',
  });
}

const FIXTURE_PREFIX = 'bl1233-';

// BL-971: sweep stale fixture dirs by prefix BEFORE the run too - a killed
// prior run traps nothing in its own finally.
function sweepStaleFixtures() {
  const tmp = os.tmpdir();
  for (const name of fs.readdirSync(tmp)) {
    if (name.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(tmp, name), { recursive: true, force: true });
    }
  }
}

// A minimal master fixture: a git repo tracking one script under
// swarmforge/scripts/, with a linked worktree for the role branch. Kept
// deliberately small (unlike the shell suite's mk_master_fixture, which
// copies this real repo's full scripts dir) - this feature's own scope is
// the tracked-path guard's trust decision, not swarmforge.sh's own
// parse-time dependencies.
function buildFixtureRoot(prefix) {
  sweepStaleFixtures();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'scripts', 'foo.bb'), "master's foo body\n");
  git(root, 'init', '-q');
  gitC(root, 'add', '-A');
  gitC(root, 'commit', '-q', '-m', 'init');
  gitC(root, 'worktree', 'add', '-q', '-b', 'coder', '.worktrees/coder');
  return root;
}

function runSync(ctx, { worktreeRootArg, env } = {}) {
  const destDir = path.join(ctx.root, '.worktrees', 'coder', 'swarmforge', 'scripts');
  const res = spawnSync(
    'bb',
    [
      CLI,
      path.join(ctx.root, 'swarmforge', 'scripts'),
      destDir,
      worktreeRootArg || path.join(ctx.root, '.worktrees', 'coder'),
      'swarmforge/scripts',
    ],
    { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 30_000 },
  );
  return res;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  scoped(/^a swarm launch that syncs the swarm scripts into a role worktree$/, (ctx) => {
    ctx.root = buildFixtureRoot('bl1233-sync-');
  });

  scoped(/^an ambient git directory and work tree pointing at a different checkout$/, (ctx) => {
    ctx.ambientEnv = { GIT_DIR: path.join(ctx.root, '.git'), GIT_WORK_TREE: ctx.root };
  });

  scoped(/^a script change on the role branch that main does not have$/, (ctx) => {
    const coderFoo = path.join(ctx.root, '.worktrees', 'coder', 'swarmforge', 'scripts', 'foo.bb');
    fs.writeFileSync(coderFoo, "coder branch's MERGED fix, not yet on main\n");
    gitC(path.join(ctx.root, '.worktrees', 'coder'), 'add', '-A');
    gitC(path.join(ctx.root, '.worktrees', 'coder'), 'commit', '-q', '-m', 'coder: merge a script fix');
    ctx.beforeFoo = fs.readFileSync(coderFoo, 'utf8');
  });

  scoped(/^the tracked-path question resolves against a checkout other than the destination worktree$/, (ctx) => {
    // Pass a SUBDIRECTORY of the coder worktree as worktree-root: git -C on
    // a subdirectory still correctly climbs to the real top-level, which
    // is then a real, resolvable, but DIFFERENT path than the one asked
    // about - the same shape as an ambient-env leak, reached without one.
    ctx.worktreeRootArg = path.join(ctx.root, '.worktrees', 'coder', 'swarmforge');
    const coderFoo = path.join(ctx.root, '.worktrees', 'coder', 'swarmforge', 'scripts', 'foo.bb');
    ctx.beforeFoo = fs.readFileSync(coderFoo, 'utf8');
  });

  scoped(/^a target repository that does not git-track the swarm scripts$/, (ctx) => {
    // Built fresh, never tracking swarmforge/: .gitignore lands in the
    // FIRST commit, and only IT is ever `git add`ed - unlike buildFixtureRoot,
    // which tracks foo.bb from its own first commit (a later .gitignore or
    // `rm -rf` would not retroactively untrack an already-tracked path).
    sweepStaleFixtures();
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bl1233-foreign-')));
    fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'swarmforge', 'scripts', 'foo.bb'), "master's foo body\n");
    git(root, 'init', '-q');
    fs.writeFileSync(path.join(root, '.gitignore'), 'swarmforge/\n');
    gitC(root, 'add', '-A', '--', '.gitignore');
    gitC(root, 'commit', '-q', '-m', 'init (tracks only .gitignore)');
    gitC(root, 'worktree', 'add', '-q', '-b', 'coder', '.worktrees/coder');
    ctx.root = root;
  });

  scoped(/^the tracked-path question resolves against that repository itself$/, () => {
    // No ambient env needed - this is the baseline (correctly-resolving)
    // case; naming the step keeps the scenario's own vocabulary explicit.
  });

  scoped(/^the swarm is launched$/, (ctx) => {
    ctx.result = runSync(ctx, { worktreeRootArg: ctx.worktreeRootArg, env: ctx.ambientEnv });
  });

  scoped(/^the role worktree's tracked script paths are left to git$/, (ctx) => {
    const out = `${ctx.result.stdout || ''}${ctx.result.stderr || ''}`;
    if (ctx.result.status !== 0) {
      throw new Error(`expected the sync to succeed, got exit ${ctx.result.status}:\n${out}`);
    }
    if (!out.includes('left to git (tracked): swarmforge/scripts/foo.bb')) {
      throw new Error(`expected the sync to report leaving foo.bb to git, got:\n${out}`);
    }
  });

  scoped(/^the role branch's script change survives the launch$/, (ctx) => {
    try {
      const coderFoo = path.join(ctx.root, '.worktrees', 'coder', 'swarmforge', 'scripts', 'foo.bb');
      const after = fs.readFileSync(coderFoo, 'utf8');
      if (after !== ctx.beforeFoo) {
        throw new Error(`expected foo.bb to survive unchanged; before=[${ctx.beforeFoo}] after=[${after}]`);
      }
    } finally {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  });

  scoped(/^no file is copied into that worktree$/, (ctx) => {
    if (ctx.result.status === 0) {
      throw new Error(`expected the sync to REFUSE (non-zero exit), got 0:\n${ctx.result.stdout}${ctx.result.stderr}`);
    }
    const coderFoo = path.join(ctx.root, '.worktrees', 'coder', 'swarmforge', 'scripts', 'foo.bb');
    const after = fs.readFileSync(coderFoo, 'utf8');
    if (after !== ctx.beforeFoo) {
      throw new Error(`expected NOTHING to be copied on refusal; foo.bb changed to [${after}]`);
    }
  });

  scoped(
    /^the launcher refuses loudly, naming the destination it asked about and the checkout git answered for$/,
    (ctx) => {
      try {
        const out = `${ctx.result.stdout || ''}${ctx.result.stderr || ''}`;
        if (!out.includes('REFUSE')) {
          throw new Error(`expected a loud REFUSE, got:\n${out}`);
        }
        if (!out.includes(ctx.worktreeRootArg)) {
          throw new Error(`expected the refusal to name the destination asked about (${ctx.worktreeRootArg}), got:\n${out}`);
        }
      } finally {
        fs.rmSync(ctx.root, { recursive: true, force: true });
      }
    },
  );

  scoped(/^that worktree receives every swarm script$/, (ctx) => {
    try {
      const out = `${ctx.result.stdout || ''}${ctx.result.stderr || ''}`;
      if (ctx.result.status !== 0) {
        throw new Error(`expected the sync to succeed for a foreign target, got exit ${ctx.result.status}:\n${out}`);
      }
      const dest = path.join(ctx.root, '.worktrees', 'coder', 'swarmforge', 'scripts', 'foo.bb');
      if (!fs.existsSync(dest)) {
        throw new Error(`expected a target repo that does not track swarmforge/ to still receive the scripts`);
      }
    } finally {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  });
}

module.exports = { registerSteps };
