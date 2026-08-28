'use strict';

// BL-1196: step handlers for "test-suite git fixtures never let an
// inherited GIT_DIR/GIT_WORK_TREE redirect them onto a live repo". Drives
// the REAL stripAmbientGitDirRedirect (extension/test/helpers/gitEnvGuard.js,
// via extension/out is not applicable here - this is a test-helper module,
// required directly since it has no compiled src/ counterpart) and a real
// plain unguarded git() spawn against real fixture repos.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'test-suite git fixtures never let an inherited GIT_DIR/GIT_WORK_TREE redirect them onto a live repo';

const GUARD = path.join(__dirname, '..', '..', '..', 'extension', 'test', 'helpers', 'gitEnvGuard.js');

function git(cwd, args, env) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env }).trim();
}

function loadGuard() {
  delete require.cache[require.resolve(GUARD)];
  return require(GUARD);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the shared git-env guard module is loaded$/, (ctx) => {
    ctx.bl1196 = { stripAmbientGitDirRedirect: loadGuard().stripAmbientGitDirRedirect };
  });

  // ── scenario 01: the strip itself ────────────────────────────────────────

  scoped(/^the process environment has GIT_DIR and GIT_WORK_TREE set to some other repository's paths$/, (ctx) => {
    ctx.bl1196.savedGitDir = process.env.GIT_DIR;
    ctx.bl1196.savedGitWorkTree = process.env.GIT_WORK_TREE;
    process.env.GIT_DIR = '/some/other/repo/.git';
    process.env.GIT_WORK_TREE = '/some/other/repo';
  });

  scoped(/^the git-env guard runs$/, (ctx) => {
    ctx.bl1196.stripAmbientGitDirRedirect();
  });

  scoped(/^GIT_DIR is no longer set in the process environment$/, (ctx) => {
    assert.equal('GIT_DIR' in process.env, false, `expected GIT_DIR to be stripped, got: ${process.env.GIT_DIR}`);
  });

  scoped(/^GIT_WORK_TREE is no longer set in the process environment$/, (ctx) => {
    const st = ctx.bl1196;
    try {
      assert.equal('GIT_WORK_TREE' in process.env, false, `expected GIT_WORK_TREE to be stripped, got: ${process.env.GIT_WORK_TREE}`);
    } finally {
      if (st.savedGitDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = st.savedGitDir;
      if (st.savedGitWorkTree === undefined) delete process.env.GIT_WORK_TREE; else process.env.GIT_WORK_TREE = st.savedGitWorkTree;
      ctx.bl1196 = null;
    }
  });

  // ── scenario 02: a real spawn honors cwd once stripped ───────────────────

  scoped(/^a decoy git repository seeded at one temp path$/, (ctx) => {
    ctx.bl1196.decoy = fs.realpathSync(mkSocketFixtureRoot('bl1196-decoy-'));
    git(ctx.bl1196.decoy, ['init', '-q']);
  });

  scoped(/^a target git repository seeded at a different temp path$/, (ctx) => {
    ctx.bl1196.target = fs.realpathSync(mkSocketFixtureRoot('bl1196-target-'));
    git(ctx.bl1196.target, ['init', '-q']);
  });

  scoped(/^the process environment's GIT_DIR points at the decoy repository$/, (ctx) => {
    const st = ctx.bl1196;
    st.savedGitDir = process.env.GIT_DIR;
    st.savedGitWorkTree = process.env.GIT_WORK_TREE;
    process.env.GIT_DIR = path.join(st.decoy, '.git');
    process.env.GIT_WORK_TREE = st.decoy;
    st.stripAmbientGitDirRedirect();
  });

  scoped(/^a test spawns "git rev-parse --show-toplevel" with cwd set to the target repository and no explicit env override$/, (ctx) => {
    const st = ctx.bl1196;
    // A plain, unguarded spawn with no explicit env - inherits process.env
    // exactly as every one of the ~60 local git() helpers in extension/test/
    // does. Must be called AFTER the strip above (scenario order), so this
    // exercises the fixed, not the ambient-vulnerable, environment.
    st.toplevel = git(st.target, ['rev-parse', '--show-toplevel']);
    git(st.target, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'target-only commit']);
  });

  scoped(/^the reported toplevel is the target repository$/, (ctx) => {
    const st = ctx.bl1196;
    assert.equal(fs.realpathSync(st.toplevel), fs.realpathSync(st.target));
  });

  scoped(/^the decoy repository gains no new commits$/, (ctx) => {
    const st = ctx.bl1196;
    try {
      const decoyLog = git(st.decoy, ['log', '--oneline', '--all']);
      assert.equal(decoyLog, '', `expected the decoy to gain no commits, got: ${decoyLog}`);
    } finally {
      if (st.savedGitDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = st.savedGitDir;
      if (st.savedGitWorkTree === undefined) delete process.env.GIT_WORK_TREE; else process.env.GIT_WORK_TREE = st.savedGitWorkTree;
      releaseSocketFixtureRoot(st.decoy);
      releaseSocketFixtureRoot(st.target);
      fs.rmSync(st.decoy, { recursive: true, force: true });
      fs.rmSync(st.target, { recursive: true, force: true });
      ctx.bl1196 = null;
    }
  });

  // ── scenario 03: GIT_INDEX_FILE joins the stripped set ──────────────────

  scoped(/^the process environment has GIT_INDEX_FILE set to another repository's index path$/, (ctx) => {
    ctx.bl1196.savedGitIndexFile = process.env.GIT_INDEX_FILE;
    process.env.GIT_INDEX_FILE = '/some/other/repo/.git/index';
  });

  scoped(/^GIT_INDEX_FILE is no longer set in the process environment$/, (ctx) => {
    const st = ctx.bl1196;
    try {
      assert.equal('GIT_INDEX_FILE' in process.env, false, `expected GIT_INDEX_FILE to be stripped, got: ${process.env.GIT_INDEX_FILE}`);
    } finally {
      if (st.savedGitIndexFile === undefined) delete process.env.GIT_INDEX_FILE; else process.env.GIT_INDEX_FILE = st.savedGitIndexFile;
      ctx.bl1196 = null;
    }
  });

  // ── scenario 04: the worktree hook environment does not reach fixture
  //    writes - drives the REAL check_property_suite_drift.sh end to end,
  //    as the actual pre-commit hook for a real commit made from a real
  //    linked worktree, so the ambient GIT_DIR/GIT_INDEX_FILE the hook
  //    receives is git's own, not manually exported. This is the exact
  //    methodology the specifier measured in an isolated scratch repo -
  //    never run against this repo itself.

  const DRIFT_SCRIPT = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'check_property_suite_drift.sh');

  scoped(/^a git repository with a linked worktree checked out on its own branch$/, (ctx) => {
    const root = fs.realpathSync(mkSocketFixtureRoot('bl1196-hook-main-'));
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', 'user.email', 't@t']);
    git(root, ['config', 'user.name', 't']);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'seed']);
    const wtPath = `${root}-wt`;
    git(root, ['worktree', 'add', '-q', '-b', 'bl1196-hook-branch', wtPath]);

    const fixtureScript = path.join(root, 'rogue-fixture.sh');
    fs.writeFileSync(
      fixtureScript,
      '#!/usr/bin/env bash\nset -e\nD="$(mktemp -d)"\ngit -C "$D" init -q\n' +
        'git -C "$D" -c user.email=t@t -c user.name=t commit -q --allow-empty -m rogue\nexit 0\n',
      { mode: 0o755 },
    );

    const hooksDir = path.join(root, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(
      hookPath,
      `#!/usr/bin/env bash\nset -e\nbash "${DRIFT_SCRIPT}" "${fixtureScript}"\n`,
      { mode: 0o755 },
    );

    ctx.bl1196 = { root, wtPath: fs.realpathSync(wtPath), fixtureScript, hookPath };
  });

  scoped(/^the environment a pre-commit hook receives from a commit in that worktree$/, (ctx) => {
    const st = ctx.bl1196;
    fs.writeFileSync(path.join(st.wtPath, 'extension_src_marker.ts'), 'export const x = 1;\n');
    fs.mkdirSync(path.join(st.wtPath, 'extension', 'src'), { recursive: true });
    fs.writeFileSync(path.join(st.wtPath, 'extension', 'src', 'bl1196fixture.ts'), 'export const x = 1;\n');
    git(st.wtPath, ['add', '-A']);
    st.beforeHead = git(st.wtPath, ['rev-parse', 'HEAD']);
  });

  scoped(/^a fixture creates a temporary directory under that environment and runs "git init" and "git commit" in it$/, (ctx) => {
    const st = ctx.bl1196;
    // The real commit itself triggers the real pre-commit hook, which
    // shells out to the REAL check_property_suite_drift.sh with the rogue
    // fixture as its injectable suite command (BL-1196's own test-injection
    // seam) - exercising the actual production scrub, not a re-implementation.
    git(st.wtPath, ['commit', '-q', '-m', 'real commit that triggers the hook']);
  });

  scoped(/^the linked worktree's branch still points at the commit it pointed at before$/, (ctx) => {
    const st = ctx.bl1196;
    const afterHead = git(st.wtPath, ['rev-parse', 'HEAD']);
    const afterParent = git(st.wtPath, ['rev-parse', 'HEAD^']);
    assert.notEqual(afterHead, st.beforeHead, 'the real commit itself must have gone through');
    assert.equal(afterParent, st.beforeHead, `expected exactly one commit past ${st.beforeHead}, got HEAD^=${afterParent} (a rogue fixture commit would land as an extra ancestor)`);
    st.afterHead = afterHead;
  });

  scoped(/^the linked worktree's index is unchanged$/, (ctx) => {
    const st = ctx.bl1196;
    try {
      const status = git(st.wtPath, ['status', '--short']);
      assert.equal(status, '', `expected a clean tree after the real commit, got: ${status}`);
      const treeFile = git(st.wtPath, ['show', `${st.afterHead}:extension/src/bl1196fixture.ts`]);
      assert.match(treeFile, /export const x = 1;/, 'the real commit tree must contain the file actually staged, not a fixture-clobbered index');
    } finally {
      fs.rmSync(st.wtPath, { recursive: true, force: true });
      releaseSocketFixtureRoot(st.root);
      fs.rmSync(st.root, { recursive: true, force: true });
      ctx.bl1196 = null;
    }
  });
}

module.exports = { registerSteps };
