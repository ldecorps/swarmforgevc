'use strict';

// BL-1214: step handlers for "reconciling a genuine two-way divergence
// absorbs it with a real merge instead of resetting local main away".
//
// Drives master_main_reconcile_lib.bb's REAL absorb-with-merge! (already
// unit-tested with fake adapters) against REAL git fixtures - a bare
// "origin" and a local clone - via
// specs/pipeline/steps/lib/bl1214AbsorbWithMergeCli.bb, which wires the
// SAME real :ff!/:merge!/:abort!/:fallback! adapter shape handoffd.bb wires
// for its :ff-absorb execution branch. Same precedent and rationale as
// BL-1198's bl1198RematchPushFirstSteps.js: this ticket changes how an
// already-planned :ff-absorb is EXECUTED, not when it is planned
// (out_of_scope), so driving absorb-with-merge! directly is what exercises
// exactly the in-scope behavior without depending on the higher-level
// dispatch/sweep decision layer.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'reconciling a genuine two-way divergence absorbs it with a real merge instead of resetting local main away';

const CLI = path.join(__dirname, 'lib', 'bl1214AbsorbWithMergeCli.bb');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initBareRemote(root) {
  git(root, ['init', '-q', '--bare', '.']);
  git(root, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
}

function initClone(root, remoteRoot) {
  git(root, ['init', '-q', '-b', 'main', '.']);
  git(root, ['config', 'user.email', 'bl1214@example.com']);
  git(root, ['config', 'user.name', 'bl1214']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
  git(root, ['remote', 'add', 'origin', remoteRoot]);
  git(root, ['push', '-q', 'origin', 'main']);
}

function cloneOf(root, remoteRoot) {
  git(root, ['clone', '-q', remoteRoot, '.']);
  git(root, ['config', 'user.email', 'bl1214@example.com']);
  git(root, ['config', 'user.name', 'bl1214']);
  git(root, ['config', 'commit.gpgsign', 'false']);
}

function commitFile(root, name, content, message) {
  fs.writeFileSync(path.join(root, name), `${content}\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function appendToFile(root, name, content, message) {
  fs.appendFileSync(path.join(root, name), `${content}\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function runAbsorb(root) {
  const result = spawnSync('bb', [CLI, root], { encoding: 'utf8' });
  assert.equal(result.status, 0, `bl1214AbsorbWithMergeCli.bb exited ${result.status}: ${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').pop());
}

function cleanupFixtureState(ctx) {
  const st = ctx.bl1214;
  if (!st) return;
  for (const root of [st.root, st.remoteRoot, st.otherCloneRoot]) {
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
      releaseSocketFixtureRoot(root);
    }
  }
  ctx.bl1214 = null;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^local main and origin\/main have each advanced since their common ancestor, so the two refs genuinely diverge$/, (ctx) => {
    const remoteRoot = fs.realpathSync(mkSocketFixtureRoot('bl1214-remote-'));
    const root = fs.realpathSync(mkSocketFixtureRoot('bl1214-root-'));
    initBareRemote(remoteRoot);
    initClone(root, remoteRoot);
    ctx.bl1214 = { root, remoteRoot };
  });

  // ── scenario 01: non-conflicting divergence ──────────────────────────────

  scoped(/^the diverging commits on each side touch no common path$/, (ctx) => {
    const st = ctx.bl1214;
    st.localOnlySha = commitFile(st.root, 'local-only.txt', 'local-side', 'local-only commit (BL-1214 acceptance)');

    const otherCloneRoot = fs.realpathSync(mkSocketFixtureRoot('bl1214-other-'));
    cloneOf(otherCloneRoot, st.remoteRoot);
    st.landedSha = commitFile(otherCloneRoot, 'landed.txt', 'origin-side', 'landed commit (BL-1214 acceptance)');
    git(otherCloneRoot, ['push', '-q', 'origin', 'main']);
    st.otherCloneRoot = otherCloneRoot;
  });

  scoped(/^the master-main reconcile path runs$/, (ctx) => {
    const st = ctx.bl1214;
    st.result = runAbsorb(st.root);
  });

  scoped(/^the fast-forward attempt with origin\/main fails$/, (ctx) => {
    const st = ctx.bl1214;
    assert.equal(st.result.ffAttempted, true, `ff! was never attempted: ${JSON.stringify(st.result)}`);
    assert.notEqual(st.result.outcome, 'ff', `expected the ff-only attempt to fail on a genuine divergence, got: ${JSON.stringify(st.result)}`);
  });

  scoped(/^a 3-way merge with origin\/main is attempted$/, (ctx) => {
    const st = ctx.bl1214;
    assert.equal(st.result.mergeAttempted, true, `merge! was never attempted: ${JSON.stringify(st.result)}`);
  });

  scoped(/^the local-only commit remains reachable from local main$/, (ctx) => {
    const st = ctx.bl1214;
    assert.doesNotThrow(
      () => git(st.root, ['merge-base', '--is-ancestor', st.localOnlySha, 'main']),
      `local-only commit ${st.localOnlySha} is no longer reachable from local main`
    );
  });

  scoped(/^the commit landed on origin\/main remains reachable from local main$/, (ctx) => {
    const st = ctx.bl1214;
    assert.doesNotThrow(
      () => git(st.root, ['merge-base', '--is-ancestor', st.landedSha, 'main']),
      `landed commit ${st.landedSha} is not reachable from local main`
    );
  });

  scoped(/^local main's tip is a merge commit with two parents$/, (ctx) => {
    const st = ctx.bl1214;
    const parentCount = git(st.root, ['rev-list', '--parents', '-n', '1', 'main']).split(/\s+/).length - 1;
    assert.equal(parentCount, 2, `expected local main's tip to be a 2-parent merge commit, got ${parentCount} parent(s)`);
  });

  // "no reset of local main to origin/main is performed" is shared,
  // identically-worded step text across scenario 01 (lossless merge) and
  // scenario 03 (foreign merge in progress) - a SINGLE registration below
  // covers both (defineScoped resolves the first scoped match per feature,
  // so a second definition of the same pattern under the same FEATURE would
  // never be reached for the later scenario). Scenario 01's additional
  // "landed a real merge commit" assertion is already covered by the prior
  // "two parents" step, so this handler only needs the fallback! check
  // common to both scenarios.

  // ── scenario 02: conflicting divergence ──────────────────────────────────

  scoped(/^the diverging commits on each side change the same path incompatibly$/, (ctx) => {
    const st = ctx.bl1214;
    st.localTipBeforeSha = appendToFile(st.root, 'seed.txt', 'root-conflict-line', 'root-only conflicting edit');

    const otherCloneRoot = fs.realpathSync(mkSocketFixtureRoot('bl1214-other-'));
    cloneOf(otherCloneRoot, st.remoteRoot);
    appendToFile(otherCloneRoot, 'seed.txt', 'origin-conflict-line', 'origin-only conflicting edit');
    git(otherCloneRoot, ['push', '-q', 'origin', 'main']);
    st.originTipSha = git(otherCloneRoot, ['rev-parse', 'HEAD']);
    st.otherCloneRoot = otherCloneRoot;
  });

  scoped(/^that merge attempt is aborted before any recovery proceeds$/, (ctx) => {
    const st = ctx.bl1214;
    assert.equal(st.result.mergeAttempted, true, `merge! was never attempted: ${JSON.stringify(st.result)}`);
    assert.equal(st.result.abortAttempted, true, `abort! was never invoked after the conflicting merge: ${JSON.stringify(st.result)}`);
  });

  scoped(/^no conflicted merge state remains for an operator to finish$/, (ctx) => {
    const st = ctx.bl1214;
    assert.equal(fs.existsSync(path.join(st.root, '.git', 'MERGE_HEAD')), false, 'expected no MERGE_HEAD to remain after the aborted merge');
    const status = git(st.root, ['status', '--porcelain']);
    assert.equal(status, '', `expected a clean working tree after the aborted merge, got: ${status}`);
  });

  scoped(/^local main is reset to origin\/main exactly as it is today$/, (ctx) => {
    const st = ctx.bl1214;
    try {
      assert.equal(st.result.fallbackAttempted, true, `fallback! (reset) was never invoked after the conflicting merge: ${JSON.stringify(st.result)}`);
      const currentSha = git(st.root, ['rev-parse', 'HEAD']);
      assert.equal(
        currentSha,
        st.originTipSha,
        `expected local main to land exactly on origin's tip (${st.originTipSha}) after the reset, got ${currentSha}`
      );
    } finally {
      cleanupFixtureState(ctx);
    }
  });

  // ── scenario 03: foreign merge already in progress ───────────────────────

  scoped(/^a merge started by someone other than this path is already in progress on local main$/, (ctx) => {
    const st = ctx.bl1214;
    commitFile(st.root, 'local-only.txt', 'local-side', 'local-only commit (BL-1214 acceptance)');

    const otherCloneRoot = fs.realpathSync(mkSocketFixtureRoot('bl1214-other-'));
    cloneOf(otherCloneRoot, st.remoteRoot);
    commitFile(otherCloneRoot, 'landed.txt', 'origin-side', 'landed commit (BL-1214 acceptance)');
    git(otherCloneRoot, ['push', '-q', 'origin', 'main']);
    st.otherCloneRoot = otherCloneRoot;

    git(st.root, ['fetch', 'origin', 'main']);
    // Seed a foreign MERGE_HEAD directly - never via a real conflicting
    // `git merge` invocation, which this path itself would then own/abort
    // (BL-1120: only ever abort a merge it started itself).
    const originSha = git(st.root, ['rev-parse', 'origin/main']);
    fs.writeFileSync(path.join(st.root, '.git', 'MERGE_HEAD'), `${originSha}\n`);
    fs.writeFileSync(path.join(st.root, '.git', 'MERGE_MSG'), 'foreign merge in progress\n');
  });

  scoped(/^no merge with origin\/main is attempted$/, (ctx) => {
    const st = ctx.bl1214;
    assert.equal(st.result.ffAttempted, false, `ff! was invoked despite a foreign MERGE_HEAD: ${JSON.stringify(st.result)}`);
    assert.equal(st.result.mergeAttempted, false, `merge! was invoked despite a foreign MERGE_HEAD: ${JSON.stringify(st.result)}`);
  });

  scoped(/^no merge is aborted$/, (ctx) => {
    const st = ctx.bl1214;
    assert.equal(st.result.abortAttempted, false, `abort! was invoked despite a foreign MERGE_HEAD: ${JSON.stringify(st.result)}`);
    assert.equal(fs.existsSync(path.join(st.root, '.git', 'MERGE_HEAD')), true, 'expected the foreign MERGE_HEAD to remain untouched');
  });

  // Shared with scenario 01 (see comment above scenario 02's header) -
  // covers both "lossless merge, no fallback needed" and "foreign
  // MERGE_HEAD, absorb-with-merge! never even invoked" with the same
  // fallbackAttempted===false assertion.
  scoped(/^no reset of local main to origin\/main is performed$/, (ctx) => {
    const st = ctx.bl1214;
    try {
      assert.equal(st.result.fallbackAttempted, false, `fallback! (reset) was invoked: ${JSON.stringify(st.result)}`);
    } finally {
      fs.rmSync(path.join(st.root, '.git', 'MERGE_HEAD'), { force: true });
      fs.rmSync(path.join(st.root, '.git', 'MERGE_MSG'), { force: true });
      cleanupFixtureState(ctx);
    }
  });
}

module.exports = { registerSteps };
