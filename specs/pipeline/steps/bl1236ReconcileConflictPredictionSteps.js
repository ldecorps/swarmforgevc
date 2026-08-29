'use strict';

// BL-1236: step handlers for "master-main reconcile predicts conflicts
// from git's verdict, not from prose". Drives the REAL fix
// (master_main_reconcile_lib.bb's merge-verdict + absorb-dispatch-plan)
// against a REAL git repo via
// specs/pipeline/steps/lib/bl1236ReconcileSweepCli.bb, which reproduces
// handoffd.bb's master-main-reconcile entry point end to end (real ahead/
// behind, real tip-contains-origin?/merge-head-present?, real git
// merge/reset execution). Only scenario 03 ("git cannot produce a merge
// verdict") forces the verdict via a CLI flag - genuinely making `git
// merge-tree --write-tree` fail on cue is not portably reproducible from a
// scripted fixture, the same class of documented test-only lever this
// project's other CLI drivers already use for the one input a real git
// process can't be made to misbehave on demand (e.g.
// bl1198RematchPushFirstCli.bb's push! stub). Every other scenario drives
// the REAL classification of a REAL git merge - content varies, the verdict
// is never forced, which is the whole point of invariant 1.
//
// Several step texts are IDENTICAL across scenarios by design (the
// feature file's own IR-DRY comment explains why they are not collapsed to
// Background) - defineScoped resolves the FIRST registration that matches
// for a given feature, so each such step has exactly ONE handler here that
// covers every scenario reaching it, distinguished at runtime by what is
// already in ctx.bl1236 (e.g. st.isEntryPointScenario for scenario 05).
//
// Scenario 05's second entry point (the post-hotfix merge CLI) runs the
// REAL, unmodified swarmforge/scripts/post_hotfix_merge_origin.bb against
// the same kind of fixture - no forcing, its own predicate is exercised
// directly.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = "master-main reconcile predicts conflicts from git's verdict, not from prose";

const REPO = path.join(__dirname, '..', '..', '..');
const SWEEP_CLI = path.join(__dirname, 'lib', 'bl1236ReconcileSweepCli.bb');
const POST_HOTFIX_CLI = path.join(REPO, 'swarmforge', 'scripts', 'post_hotfix_merge_origin.bb');

// The decoy word bank - every phrase the OLD legacy-diff-text predicate
// (removed by this ticket) case-insensitively grepped for. The "do not
// contain" case uses ordinary prose with none of them.
const CONTAINING_LINE = 'CONFLICT: this line is deliberately decoy prose, changed in both, added in both';
const NOT_CONTAINING_LINE = 'ordinary prose with nothing special about it';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function isAncestor(cwd, ancestor, descendant) {
  const r = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd, encoding: 'utf8' });
  return r.status === 0;
}

function initBareRemote(root) {
  git(root, ['init', '-q', '--bare', '.']);
  git(root, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
}

function initClone(root, remoteRoot) {
  git(root, ['init', '-q', '-b', 'main', '.']);
  git(root, ['config', 'user.email', 'bl1236@example.com']);
  git(root, ['config', 'user.name', 'bl1236']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
  git(root, ['remote', 'add', 'origin', remoteRoot]);
  git(root, ['push', '-q', 'origin', 'main']);
}

function cloneOf(root, remoteRoot) {
  git(root, ['clone', '-q', remoteRoot, '.']);
  git(root, ['config', 'user.email', 'bl1236@example.com']);
  git(root, ['config', 'user.name', 'bl1236']);
  git(root, ['config', 'commit.gpgsign', 'false']);
}

function commitFile(root, name, content, message) {
  fs.writeFileSync(path.join(root, name), `${content}\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function cleanupFixture(ctx) {
  const st = ctx.bl1236;
  if (!st) return;
  for (const root of [st.root, st.remoteRoot, st.otherRoot]) {
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
      releaseSocketFixtureRoot(root);
    }
  }
  ctx.bl1236 = null;
}

function runSweepCli(root, forceVerdict) {
  const args = [SWEEP_CLI, root];
  if (forceVerdict) args.push(`--force-verdict=${forceVerdict}`);
  const result = spawnSync('bb', args, { encoding: 'utf8' });
  assert.equal(result.status, 0, `bl1236ReconcileSweepCli.bb exited ${result.status}: ${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────

  scoped(/^local main has diverged two ways from origin\/main$/, (ctx) => {
    const remoteRoot = fs.realpathSync(mkSocketFixtureRoot('bl1236-remote-'));
    const root = fs.realpathSync(mkSocketFixtureRoot('bl1236-root-'));
    initBareRemote(remoteRoot);
    initClone(root, remoteRoot);

    // "Two ways" means origin also advances with a commit local does not
    // have, not just local getting ahead - otherwise behind stays 0 and
    // every scenario below would trivially noop regardless of verdict.
    const otherRoot = fs.realpathSync(mkSocketFixtureRoot('bl1236-other-'));
    cloneOf(otherRoot, remoteRoot);
    commitFile(otherRoot, 'origin-base.txt', 'origin-base', 'origin-base commit (BL-1236 acceptance)');
    git(otherRoot, ['push', '-q', 'origin', 'main']);

    ctx.bl1236 = { root, remoteRoot, otherRoot };
  });

  scoped(/^the divergence carries local commits that origin does not have$/, (ctx) => {
    const st = ctx.bl1236;
    st.localSha = commitFile(st.root, 'local-only.txt', 'local-side', 'local-only commit (BL-1236 acceptance)');
  });

  // ── shared Givens (identical step text across multiple scenarios - see
  //    header comment; each handler below covers every scenario reaching
  //    that text) ────────────────────────────────────────────────────────

  // Scenario 01 (both content values) and scenario 05 (fixed "contain").
  // Writes a NEW origin-only file - never overlaps anything, so it never
  // affects mergeability by itself; it exists purely to prove the verdict
  // ignores its content.
  scoped(/^the merged files (contain|do not contain) the word "CONFLICT" in their own text$/, (ctx, content) => {
    const st = ctx.bl1236;
    const line = content === 'contain' ? CONTAINING_LINE : NOT_CONTAINING_LINE;
    commitFile(st.otherRoot, 'origin-side.txt', line, 'origin-side commit (BL-1236 acceptance)');
    git(st.otherRoot, ['push', '-q', 'origin', 'main']);
  });

  // Scenario 01 ("clean" row), scenario 02, and scenario 05: no additional
  // git state needed - the fixture built so far already merges cleanly.
  scoped(/^git reports the merge as clean$/, (ctx) => {
    ctx.bl1236.forceVerdict = null;
  });

  // Scenario 01 ("conflicted" row) and scenario 04: build a REAL,
  // same-path, incompatible edit on both sides so the merge genuinely
  // conflicts - never forced, so this exercises git's real verdict.
  scoped(/^git reports the merge as conflicted$/, (ctx) => {
    const st = ctx.bl1236;
    st.forceVerdict = null;
    git(st.otherRoot, ['checkout', 'main']);
    fs.appendFileSync(path.join(st.otherRoot, 'seed.txt'), 'origin-conflict-line\n');
    git(st.otherRoot, ['add', '-A']);
    git(st.otherRoot, ['commit', '-q', '-m', 'origin conflicting edit (BL-1236 acceptance)']);
    git(st.otherRoot, ['push', '-q', 'origin', 'main']);
    fs.appendFileSync(path.join(st.root, 'seed.txt'), 'local-conflict-line\n');
    git(st.root, ['add', '-A']);
    git(st.root, ['commit', '-q', '-m', 'local conflicting edit (BL-1236 acceptance)']);
  });

  // Scenario 03 only - the one input a real git process cannot be made to
  // misbehave on cue from a scripted fixture (see header comment).
  scoped(/^git cannot produce a merge verdict for the divergence$/, (ctx) => {
    ctx.bl1236.forceVerdict = 'unavailable';
  });

  // Scenario 01's own When (distinct text - no collision).
  scoped(/^the reconcile sweep predicts whether the merge would conflict$/, (ctx) => {
    const st = ctx.bl1236;
    git(st.root, ['fetch', '-q', 'origin', 'main']);
    st.result = runSweepCli(st.root, st.forceVerdict);
  });

  // Scenarios 02, 03, 04 share this exact When text.
  scoped(/^the reconcile sweep runs$/, (ctx) => {
    const st = ctx.bl1236;
    git(st.root, ['fetch', '-q', 'origin', 'main']);
    st.result = runSweepCli(st.root, st.forceVerdict);
  });

  // Scenario 05's own When (distinct text, capture group for the entry point).
  scoped(/^(the handoffd reconcile sweep|the post-hotfix merge CLI) decides whether the merge would conflict$/, (ctx, entryPoint) => {
    const st = ctx.bl1236;
    st.isEntryPointScenario = true;
    git(st.root, ['fetch', '-q', 'origin', 'main']);
    st.headBefore = git(st.root, ['rev-parse', 'HEAD']);

    if (entryPoint === 'the handoffd reconcile sweep') {
      st.result = runSweepCli(st.root, null);
      st.predictedNoConflict = st.result.verdict === 'clean';
      st.resetPerformed = st.result.resetPerformed;
    } else {
      const proc = spawnSync('bb', [POST_HOTFIX_CLI, st.root], { encoding: 'utf8' });
      st.postHotfixResult = { status: proc.status, stdout: proc.stdout, stderr: proc.stderr };
      // The CLI exits 0 on noop/absorbed success and only ever exits 1 on
      // a genuine conflict/refuse path - a false "conflict" prediction
      // driven by decoy prose on this clean divergence would misroute it
      // there instead.
      st.predictedNoConflict = proc.status === 0;
      st.resetPerformed = !isAncestor(st.root, st.headBefore, 'main');
    }
  });

  // Scenario 01 (both prediction values) and scenario 05 (fixed "no conflict").
  scoped(/^the prediction is (no conflict|conflict)$/, (ctx, prediction) => {
    const st = ctx.bl1236;
    const expectClean = prediction === 'no conflict';
    if (st.isEntryPointScenario) {
      assert.equal(
        st.predictedNoConflict,
        expectClean,
        `expected a ${prediction} prediction, got: ${JSON.stringify(st.result || st.postHotfixResult)}`
      );
    } else {
      const expectedVerdict = expectClean ? 'clean' : 'conflict';
      assert.equal(st.result.verdict, expectedVerdict, `expected verdict ${expectedVerdict}, got: ${JSON.stringify(st.result)}`);
      cleanupFixture(ctx);
    }
  });

  // ── scenario 02 ───────────────────────────────────────────────────────

  scoped(/^local main contains origin\/main$/, (ctx) => {
    const st = ctx.bl1236;
    assert.ok(isAncestor(st.root, 'origin/main', 'main'), `expected local main to contain origin/main, got: ${JSON.stringify(st.result)}`);
  });

  scoped(/^every local commit that preceded the sweep is still reachable from HEAD$/, (ctx) => {
    const st = ctx.bl1236;
    try {
      assert.ok(isAncestor(st.root, st.localSha, 'main'), `local-only commit ${st.localSha} is no longer reachable from local main`);
      assert.equal(st.result.resetPerformed, false, `expected no reset, got: ${JSON.stringify(st.result)}`);
    } finally {
      cleanupFixture(ctx);
    }
  });

  // ── scenario 03 (and shared with scenario 05 below) ──────────────────

  // Shared with scenario 05 - the entry-point step above sets
  // st.resetPerformed for both shapes (handoffd sweep CLI result and
  // post-hotfix CLI process), so one handler covers scenario 02/03's
  // st.result.resetPerformed shape and scenario 05's st.resetPerformed shape.
  scoped(/^no reset is performed$/, (ctx) => {
    const st = ctx.bl1236;
    const resetPerformed = st.resetPerformed !== undefined ? st.resetPerformed : st.result?.resetPerformed;
    assert.equal(resetPerformed, false, `expected no reset, got: ${JSON.stringify(st.result || st.postHotfixResult)}`);
    if (st.isEntryPointScenario) cleanupFixture(ctx);
  });

  scoped(/^local main is left exactly as it was found$/, (ctx) => {
    const st = ctx.bl1236;
    assert.equal(st.result.headAfter, st.result.headBefore, `expected HEAD unmoved, got: ${JSON.stringify(st.result)}`);
  });

  scoped(/^the sweep records that the verdict was unavailable$/, (ctx) => {
    const st = ctx.bl1236;
    try {
      assert.equal(st.result.verdict, 'unavailable', `expected verdict unavailable, got: ${JSON.stringify(st.result)}`);
      assert.equal(st.result.outcome, 'verdict-unavailable', `expected outcome verdict-unavailable, got: ${JSON.stringify(st.result)}`);
    } finally {
      cleanupFixture(ctx);
    }
  });

  // ── scenario 04 ───────────────────────────────────────────────────────

  scoped(/^the reconcile sweep takes its existing conflict recovery path$/, (ctx) => {
    const st = ctx.bl1236;
    try {
      assert.equal(st.result.verdict, 'conflict', `expected a genuine conflict verdict, got: ${JSON.stringify(st.result)}`);
      assert.ok(
        ['rematched-bookkeeping', 'rematched-refuse'].includes(st.result.outcome),
        `expected the existing rematch/reset recovery outcome, got: ${JSON.stringify(st.result)}`
      );
      assert.equal(st.result.resetPerformed, true, `expected the existing recovery path to reset, got: ${JSON.stringify(st.result)}`);
    } finally {
      cleanupFixture(ctx);
    }
  });
}

module.exports = { registerSteps };
