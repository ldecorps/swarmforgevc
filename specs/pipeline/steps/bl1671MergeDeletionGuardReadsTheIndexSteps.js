'use strict';

// BL-1671: step handlers for "The merge-deletion guard reads the index, not
// the working tree". Drives the REAL swarmforge/scripts/check_merge_deletion.sh
// through the REAL commit-msg hook (installed via core.hooksPath, same
// fixture pattern as swarmforge/scripts/test/test_merge_deletion_guard.sh
// and bl632CommitTimeGuardSteps.js) as real `git merge --no-ff` subprocesses
// - never a parallel reimplementation of the guard's decision logic.
//
// Handler lands in the SAME commit as the feature (BL-233, BL-1371).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1671 The merge-deletion guard reads the index, not the working tree';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD_TEST_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_merge_deletion_guard.sh');

const {
  deriveCommitGuardFixtureSet,
} = require(path.join(REPO_ROOT, 'extension', 'test', 'helpers', 'commitGuardFixtureSet.js'));

// Every Examples: column value must be load-bearing (engineering.prompt): an
// unknown (e.g. gherkin-mutator-mutated) value fails the step outright
// instead of flowing through a passthrough/no-op branch.
const KNOWN_STATES = new Set(['deleted in the working tree but not staged', 'deleted by a commit on the other branch']);
const KNOWN_OUTCOMES = new Set([
  'the merge commits and the guard names no path',
  'the merge is refused naming keep.txt and BL-0001',
]);

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function mkFixtureRepo() {
  // BL-1636: registered for reaping via the shared fixtureReaper helper -
  // never a bare fs.mkdtempSync left to a hand-rolled process.on('exit').
  const root = trackedTmpRoot('sfvc-bl1671-acceptance-');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');

  fs.mkdirSync(path.join(root, 'swarmforge', 'git-hooks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  // commit-msg only (BL-1484): the merge-deletion guard fires from
  // commit-msg, not pre-commit's runner chain (the guard's own header).
  for (const rel of deriveCommitGuardFixtureSet({
    repoRoot: REPO_ROOT,
    runnerRel: null,
    hookRels: ['swarmforge/git-hooks/commit-msg'],
  }).files) {
    const dst = path.join(root, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, rel), dst);
    fs.chmodSync(dst, 0o755);
  }

  // Two branches that both carry keep.txt, introduced under a subject
  // naming BL-0001 (the Background's own wording).
  fs.writeFileSync(path.join(root, 'keep.txt'), 'kept\n');
  git(root, 'add', 'keep.txt');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'BL-0001: add keep.txt');
  const base = git(root, 'rev-parse', 'HEAD');

  git(root, 'checkout', '-q', '-b', 'other', base);
  fs.writeFileSync(path.join(root, 'other-work.txt'), 'other work\n');
  git(root, 'add', 'other-work.txt');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'BL-9000: unrelated other-branch work');

  git(root, 'checkout', '-q', 'main');
  git(root, 'config', 'core.hooksPath', 'swarmforge/git-hooks');

  return root;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository initialised under mkdtemp with the commit guard chain installed and two branches that both carry keep\.txt, committed under a subject naming BL-0001$/, (ctx) => {
    ctx.bl1671 = { root: mkFixtureRepo() };
  });

  scoped(/^keep\.txt is "?([^"]+)"?$/, (ctx, state) => {
    assert.ok(KNOWN_STATES.has(state), `unknown state value: ${state}`);
    const { root } = ctx.bl1671;
    if (state === 'deleted in the working tree but not staged') {
      fs.unlinkSync(path.join(root, 'keep.txt'));
      ctx.bl1671.state = state;
      return;
    }
    // "deleted by a commit on the other branch": a committed removal, no
    // ticket in the subject - BL-1242's original, unchanged contract.
    git(root, 'checkout', '-q', 'other');
    fs.unlinkSync(path.join(root, 'keep.txt'));
    git(root, 'rm', '-q', 'keep.txt');
    git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'chore: drop keep.txt');
    git(root, 'checkout', '-q', 'main');
    ctx.bl1671.state = state;
  });

  scoped(/^the other branch is merged with --no-ff and a message naming no ticket$/, (ctx) => {
    const { root } = ctx.bl1671;
    const result = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', '--no-ff', '-m', 'merge, no ticket named', 'other'], {
      cwd: root,
      encoding: 'utf8',
    });
    ctx.bl1671.mergeResult = result;
    if (result.status !== 0) {
      // A refused merge leaves MERGE_HEAD and the working tree mid-merge -
      // abort so a later step's git calls (e.g. status) read a clean tree.
      spawnSync('git', ['merge', '--abort'], { cwd: root });
    }
  });

  scoped(/^(the merge commits and the guard names no path|the merge is refused naming keep\.txt and BL-0001)$/, (ctx, outcome) => {
    assert.ok(KNOWN_OUTCOMES.has(outcome), `unknown outcome value: ${outcome}`);
    const { mergeResult } = ctx.bl1671;
    if (outcome === 'the merge commits and the guard names no path') {
      assert.equal(mergeResult.status, 0, `expected the merge to commit, got status ${mergeResult.status}: ${mergeResult.stdout}${mergeResult.stderr}`);
      assert.doesNotMatch(mergeResult.stderr, /Error: merge deletes/, `expected no path named, got: ${mergeResult.stderr}`);
    } else {
      assert.notEqual(mergeResult.status, 0, `expected the merge to be refused, got status ${mergeResult.status}`);
      assert.match(mergeResult.stderr, /keep\.txt/, `expected the refusal to name keep.txt, got: ${mergeResult.stderr}`);
      assert.match(mergeResult.stderr, /BL-0001/, `expected the refusal to name BL-0001, got: ${mergeResult.stderr}`);
    }
  });

  scoped(/^the merge commit's tree still carries keep\.txt$/, (ctx) => {
    const { root } = ctx.bl1671;
    const listing = git(root, 'ls-tree', 'HEAD', '--', 'keep.txt');
    assert.ok(listing.includes('keep.txt'), `expected keep.txt in the merge commit's tree, got: ${listing || '(empty)'}`);
  });

  scoped(/^git status still shows keep\.txt deleted and unstaged$/, (ctx) => {
    const { root } = ctx.bl1671;
    const status = git(root, 'status', '--short', '--', 'keep.txt');
    assert.ok(status.length > 0, 'expected keep.txt to show as an unstaged deletion in git status');
    assert.match(status, /^\s*D\s+keep\.txt/, `expected an unstaged D (working-tree deletion, not staged), got: ${status}`);
  });

  scoped(/^the merge deletion guard shell test runs$/, (ctx) => {
    const result = spawnSync('bash', [GUARD_TEST_SCRIPT], { encoding: 'utf8', timeout: 60000 });
    ctx.bl1671 = ctx.bl1671 || {};
    ctx.bl1671.shellTestResult = result;
  });

  scoped(/^it reports every check passed$/, (ctx) => {
    const { shellTestResult } = ctx.bl1671;
    assert.equal(shellTestResult.status, 0, `expected the shell test suite to exit 0, got: ${shellTestResult.stdout}${shellTestResult.stderr}`);
    assert.match(shellTestResult.stdout, /ALL PASS/, `expected ALL PASS, got: ${shellTestResult.stdout}`);
  });

  scoped(/^its passing checks include unstaged-worktree-deletion-is-not-a-finding$/, (ctx) => {
    const { shellTestResult } = ctx.bl1671;
    assert.match(shellTestResult.stdout, /PASS: unstaged-worktree-deletion-is-not-a-finding/, `expected that PASS line, got: ${shellTestResult.stdout}`);
  });
}

module.exports = { registerSteps };
