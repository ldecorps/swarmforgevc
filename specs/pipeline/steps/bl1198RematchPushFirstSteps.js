'use strict';

// BL-1198: step handlers for "rematching local main onto origin/main
// attempts a push before discarding any local-ahead commit".
//
// Drives master_main_reconcile_lib.bb's REAL rematch-with-push-first!
// (already unit/property-tested with fake adapters) against REAL git
// fixtures - a bare "origin" and a local clone - via
// specs/pipeline/steps/lib/bl1198RematchPushFirstCli.bb, which wires the
// SAME real :push!/:reset! adapter shape swarm_heal.bb wires (`git push
// origin main` / `git reset --hard origin/main`). Deliberately bypasses
// the higher-level heal!/handoffd :should-reconcile decision layer - see
// the CLI driver's own header comment for why that layer cannot
// discriminate this fix and is out of this ticket's scope.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'rematching local main onto origin/main attempts a push before discarding any local-ahead commit';

const CLI = path.join(__dirname, 'lib', 'bl1198RematchPushFirstCli.bb');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initBareRemote(root) {
  git(root, ['init', '-q', '--bare', '.']);
  git(root, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
}

function initClone(root, remoteRoot) {
  git(root, ['init', '-q', '-b', 'main', '.']);
  git(root, ['config', 'user.email', 'bl1198@example.com']);
  git(root, ['config', 'user.name', 'bl1198']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
  git(root, ['remote', 'add', 'origin', remoteRoot]);
  git(root, ['push', '-q', 'origin', 'main']);
}

function commitFile(root, name, content, message) {
  fs.writeFileSync(path.join(root, name), `${content}\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function runRematch(root) {
  const result = spawnSync('bb', [CLI, root], { encoding: 'utf8' });
  assert.equal(result.status, 0, `bl1198RematchPushFirstCli.bb exited ${result.status}: ${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').pop());
}

function cleanupFixtureState(ctx) {
  const st = ctx.bl1198;
  if (!st) return;
  for (const root of [st.root, st.remoteRoot, st.divergentCloneRoot]) {
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
      releaseSocketFixtureRoot(root);
    }
  }
  ctx.bl1198 = null;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^local main holds one or more commits not yet present on origin\/main$/, (ctx) => {
    const remoteRoot = fs.realpathSync(mkSocketFixtureRoot('bl1198-remote-'));
    const root = fs.realpathSync(mkSocketFixtureRoot('bl1198-root-'));
    initBareRemote(remoteRoot);
    initClone(root, remoteRoot);
    const aheadSha = commitFile(root, 'ahead.txt', 'ahead', 'local-ahead commit (BL-1198 acceptance)');
    ctx.bl1198 = { root, remoteRoot, aheadSha };
  });

  // ── scenario 01: not diverged - push, not discarded ─────────────────────

  scoped(/^origin\/main has not diverged from local main's history$/, () => {
    // Background already leaves origin/main exactly at local main's parent
    // with no other writer - nothing further to arrange here.
  });

  scoped(/^origin\/main has diverged such that pushing local main is rejected$/, (ctx) => {
    const st = ctx.bl1198;
    const divergentCloneRoot = fs.realpathSync(mkSocketFixtureRoot('bl1198-divergent-'));
    git(divergentCloneRoot, ['clone', '-q', st.remoteRoot, '.']);
    git(divergentCloneRoot, ['config', 'user.email', 'bl1198@example.com']);
    git(divergentCloneRoot, ['config', 'user.name', 'bl1198']);
    git(divergentCloneRoot, ['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(divergentCloneRoot, 'origin-only.txt'), 'origin-side\n');
    git(divergentCloneRoot, ['add', '-A']);
    git(divergentCloneRoot, ['commit', '-q', '-m', 'origin-side commit (unrelated file)']);
    git(divergentCloneRoot, ['push', '-q', 'origin', 'main']);
    st.divergentCloneRoot = divergentCloneRoot;
    st.originTipSha = git(divergentCloneRoot, ['rev-parse', 'HEAD']);
  });

  scoped(/^the rematch path runs$/, (ctx) => {
    const st = ctx.bl1198;
    st.result = runRematch(st.root);
  });

  scoped(/^it pushes local main to origin\/main before any reset is attempted$/, (ctx) => {
    const st = ctx.bl1198;
    assert.equal(st.result.pushed, true, `expected the push alone to resolve rematch, got: ${JSON.stringify(st.result)}`);
    assert.equal(st.result.resetAttempted, false, `reset! was invoked despite a successful push: ${JSON.stringify(st.result)}`);
  });

  scoped(/^the local-ahead commit is present on origin\/main afterward$/, (ctx) => {
    const st = ctx.bl1198;
    try {
      git(st.remoteRoot, ['cat-file', '-e', st.aheadSha]);
    } catch {
      assert.fail(`local-ahead commit ${st.aheadSha} never reached origin/main`);
    }
  });

  scoped(/^no reset --hard is performed$/, (ctx) => {
    const st = ctx.bl1198;
    try {
      assert.equal(st.result.resetAttempted, false, `reset! was invoked: ${JSON.stringify(st.result)}`);
    } finally {
      cleanupFixtureState(ctx);
    }
  });

  scoped(/^it attempts the push first$/, (ctx) => {
    const st = ctx.bl1198;
    assert.equal(st.result.pushAttempted, true, `push! was never invoked: ${JSON.stringify(st.result)}`);
    assert.equal(st.result.pushed, false, `expected the push to be rejected, got: ${JSON.stringify(st.result)}`);
  });

  scoped(/^local main is left with the local-ahead commit intact$/, (ctx) => {
    const st = ctx.bl1198;
    const currentSha = git(st.root, ['rev-parse', 'HEAD']);
    assert.equal(
      currentSha,
      st.aheadSha,
      `local-ahead commit was discarded: HEAD moved from ${st.aheadSha} to ${currentSha}`
    );
    assert.equal(
      st.result.outcome,
      'local-ahead-refused',
      `expected BL-1310 refusal after rejected push with local-ahead commits: ${JSON.stringify(st.result)}`
    );
  });
}

module.exports = { registerSteps };
