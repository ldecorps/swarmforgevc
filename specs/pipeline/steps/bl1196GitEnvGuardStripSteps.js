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
}

module.exports = { registerSteps };
