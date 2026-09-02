'use strict';

// BL-1310: step handlers for "The master-main reconcile never discards
// local-ahead commits". Human ruling: never discard local-ahead commits -
// refuse and surface, a human resolves it.
//
// Scenarios 01/02/04 drive specs/pipeline/steps/lib/
// bl1310ReconcileRefusesLocalAheadCli.bb, which reproduces handoffd.bb's
// master-main-reconcile entry point end to end (real ahead/behind, real
// tip-contains-origin?/merge-head-present?, real git merge/reset commands)
// with the BL-1310 fix applied: the raw reset adapter is gated by
// master_main_reconcile_lib.bb's reset-authorized-by-ahead-count?, the SAME
// gate handoffd.bb's own refuse-reset-if-local-ahead! applies (:3188).
// Scenario 03 drives bl1310RematchPathCli.bb, which exercises the ahead=0
// path directly through rematch-with-push-first! (the "rematch path" the
// feature's own When text names, distinct from "the reconcile runs").
//
// Only two inputs are ever forced rather than driven for real, both
// documented test-only levers already established by this project's other
// CLI drivers: the merge verdict (scenario 04, mirroring
// bl1236ReconcileSweepCli.bb's --force-verdict) and the ahead-count read
// that gates the reset (scenario 04 only - there is no portable way to make
// `git rev-list --left-right --count` itself fail against a healthy ref).
// Scenarios 01/02 build a REAL same-path conflicting edit so the merge
// verdict is genuinely :conflict, never forced.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'The master-main reconcile never discards local-ahead commits';

const RECONCILE_CLI = path.join(__dirname, 'lib', 'bl1310ReconcileRefusesLocalAheadCli.bb');
const REMATCH_CLI = path.join(__dirname, 'lib', 'bl1310RematchPathCli.bb');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initBareRemote(root) {
  git(root, ['init', '-q', '--bare', '.']);
  git(root, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
}

function initClone(root, remoteRoot) {
  git(root, ['init', '-q', '-b', 'main', '.']);
  git(root, ['config', 'user.email', 'bl1310@example.com']);
  git(root, ['config', 'user.name', 'bl1310']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
  git(root, ['remote', 'add', 'origin', remoteRoot]);
  git(root, ['push', '-q', 'origin', 'main']);
}

function cloneOf(root, remoteRoot) {
  git(root, ['clone', '-q', remoteRoot, '.']);
  git(root, ['config', 'user.email', 'bl1310@example.com']);
  git(root, ['config', 'user.name', 'bl1310']);
  git(root, ['config', 'commit.gpgsign', 'false']);
}

function commitFile(root, name, content, message) {
  fs.writeFileSync(path.join(root, name), `${content}\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function cleanupFixture(ctx) {
  const st = ctx.bl1310;
  if (!st) return;
  for (const root of [st.root, st.remoteRoot, st.otherRoot]) {
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
      releaseSocketFixtureRoot(root);
    }
  }
  ctx.bl1310 = null;
}

function runReconcileCli(root, { forceVerdict, forceAheadUndeterminable } = {}) {
  const args = [RECONCILE_CLI, root];
  if (forceVerdict) args.push(`--force-verdict=${forceVerdict}`);
  if (forceAheadUndeterminable) args.push('--force-ahead-undeterminable');
  const result = spawnSync('bb', args, { encoding: 'utf8' });
  assert.equal(result.status, 0, `bl1310ReconcileRefusesLocalAheadCli.bb exited ${result.status}: ${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').pop());
}

function runRematchCli(root) {
  const result = spawnSync('bb', [REMATCH_CLI, root], { encoding: 'utf8' });
  assert.equal(result.status, 0, `bl1310RematchPathCli.bb exited ${result.status}: ${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').pop());
}

// Builds a REAL, same-path incompatible edit on both sides so the merge
// verdict is genuinely :conflict - never forced. Mirrors bl1236's own
// "git reports the merge as conflicted" step.
function buildRealConflict(st) {
  git(st.otherRoot, ['checkout', 'main']);
  fs.appendFileSync(path.join(st.otherRoot, 'seed.txt'), 'origin-conflict-line\n');
  git(st.otherRoot, ['add', '-A']);
  git(st.otherRoot, ['commit', '-q', '-m', 'origin conflicting edit (BL-1310 acceptance)']);
  git(st.otherRoot, ['push', '-q', 'origin', 'main']);
  fs.appendFileSync(path.join(st.root, 'seed.txt'), 'local-conflict-line\n');
  git(st.root, ['add', '-A']);
  git(st.root, ['commit', '-q', '-m', 'local conflicting edit (BL-1310 acceptance)']);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────

  scoped(/^a master checkout on main$/, (ctx) => {
    const remoteRoot = fs.realpathSync(mkSocketFixtureRoot('bl1310-remote-'));
    const root = fs.realpathSync(mkSocketFixtureRoot('bl1310-root-'));
    initBareRemote(remoteRoot);
    initClone(root, remoteRoot);
    ctx.bl1310 = { root, remoteRoot };
  });

  scoped(/^origin\/main has advanced with commits local main does not have$/, (ctx) => {
    const st = ctx.bl1310;
    const otherRoot = fs.realpathSync(mkSocketFixtureRoot('bl1310-other-'));
    cloneOf(otherRoot, st.remoteRoot);
    commitFile(otherRoot, 'origin-base.txt', 'origin-base', 'origin-base commit (BL-1310 acceptance)');
    git(otherRoot, ['push', '-q', 'origin', 'main']);
    st.otherRoot = otherRoot;
  });

  // ── scenarios 01/02: local-ahead + predicted conflict ───────────────────

  scoped(/^local main is ahead by (\d+) commits$/, (ctx, countStr) => {
    const st = ctx.bl1310;
    const count = Number(countStr);
    st.aheadShas = [];
    for (let i = 0; i < count; i += 1) {
      st.aheadShas.push(commitFile(st.root, `ahead-${i}.txt`, `ahead-${i}`, `local-ahead commit ${i} (BL-1310 acceptance)`));
    }
  });

  scoped(/^the reconcile predicts a content conflict$/, (ctx) => {
    buildRealConflict(ctx.bl1310);
  });

  scoped(/^the reconcile runs$/, (ctx) => {
    const st = ctx.bl1310;
    git(st.root, ['fetch', '-q', 'origin', 'main']);
    st.headBefore = git(st.root, ['rev-parse', 'HEAD']);
    st.result = runReconcileCli(st.root, { forceAheadUndeterminable: st.forceAheadUndeterminable });
  });

  scoped(/^local main is left exactly as it was found$/, (ctx) => {
    const st = ctx.bl1310;
    assert.equal(st.result.headAfter, st.result.headBefore, `expected HEAD unmoved, got: ${JSON.stringify(st.result)}`);
    assert.equal(st.result.headAfter, st.headBefore, `expected HEAD to still be ${st.headBefore}, got: ${JSON.stringify(st.result)}`);
  });

  scoped(/^no reset is attempted$/, (ctx) => {
    const st = ctx.bl1310;
    try {
      assert.equal(st.result.resetPerformed, false, `reset was performed: ${JSON.stringify(st.result)}`);
      if (st.aheadShas) {
        for (const sha of st.aheadShas) {
          assert.ok(
            (() => {
              try {
                git(st.root, ['cat-file', '-e', sha]);
                return true;
              } catch {
                return false;
              }
            })(),
            `local-ahead commit ${sha} is no longer reachable`
          );
        }
      }
    } finally {
      cleanupFixture(ctx);
    }
  });

  // ── scenario 02: the report ──────────────────────────────────────────────

  scoped(/^the reconcile reports local-ahead refusal$/, (ctx) => {
    const st = ctx.bl1310;
    assert.equal(st.result.resetRefused, true, `expected the reset to be refused, got: ${JSON.stringify(st.result)}`);
    assert.equal(st.result.outcome, 'local-ahead-refused', `expected outcome local-ahead-refused, got: ${JSON.stringify(st.result)}`);
  });

  scoped(/^the report names BL-1310$/, (ctx) => {
    const st = ctx.bl1310;
    try {
      assert.ok(st.result.message, `expected a report message, got: ${JSON.stringify(st.result)}`);
      assert.ok(st.result.message.includes('BL-1310'), `expected the report to name BL-1310, got: ${JSON.stringify(st.result.message)}`);
    } finally {
      cleanupFixture(ctx);
    }
  });

  // ── scenario 03: ahead=0 is unaffected ──────────────────────────────────

  scoped(/^local main is not ahead of origin\/main$/, () => {
    // Background already leaves local main exactly at what it pushed, with
    // no local-only commit of its own - nothing further to arrange here.
  });

  scoped(/^the push to origin is rejected$/, () => {
    // Background already made origin/main diverge ahead of local main
    // (the otherRoot commit), so a plain `git push` from local is rejected
    // non-fast-forward by construction - nothing further to arrange here.
  });

  scoped(/^the rematch path runs$/, (ctx) => {
    const st = ctx.bl1310;
    st.result = runRematchCli(st.root);
  });

  scoped(/^local main has been reset to origin\/main$/, (ctx) => {
    const st = ctx.bl1310;
    try {
      assert.equal(st.result.resetAttempted, true, `expected the reset to run, got: ${JSON.stringify(st.result)}`);
      assert.equal(st.result.resetRefused, false, `expected the reset NOT to be refused, got: ${JSON.stringify(st.result)}`);
      const localHead = git(st.root, ['rev-parse', 'HEAD']);
      const originHead = git(st.remoteRoot, ['rev-parse', 'main']);
      assert.equal(localHead, originHead, `expected local main reset onto origin/main (${originHead}), got ${localHead}`);
    } finally {
      cleanupFixture(ctx);
    }
  });

  // ── scenario 04: undeterminable ahead-count refuses rather than guesses ─

  scoped(/^local main's ahead-count against origin\/main cannot be determined$/, (ctx) => {
    const st = ctx.bl1310;
    // Reaching the reset gate at all requires a predicted conflict (the
    // only situation that reaches a reset today, per this ticket's own
    // description) - reuse the same real-conflict fixture scenarios
    // 01/02 build. The "cannot be determined" premise itself is realised
    // by the CLI's own documented test-only lever (--force-ahead-
    // undeterminable): there is no portable way to make a real `git
    // rev-list --left-right --count` fail against a healthy ref on cue.
    buildRealConflict(st);
    st.forceAheadUndeterminable = true;
  });

  scoped(/^the reconcile reports why it did not reconcile$/, (ctx) => {
    const st = ctx.bl1310;
    try {
      assert.equal(st.result.resetPerformed, false, `reset was performed: ${JSON.stringify(st.result)}`);
      assert.equal(st.result.resetRefused, true, `expected the reset to be refused, got: ${JSON.stringify(st.result)}`);
      assert.ok(st.result.message, `expected a report explaining why nothing reconciled, got: ${JSON.stringify(st.result)}`);
    } finally {
      cleanupFixture(ctx);
    }
  });
}

module.exports = { registerSteps };
