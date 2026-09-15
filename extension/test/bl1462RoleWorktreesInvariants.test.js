'use strict';

// BL-1462 hardening: lib/roleWorktrees.js (masterCheckoutPath,
// firstLinkedWorktreePath) had NO direct unit coverage - it was exercised
// only through BL-968's and BL-1462's own acceptance scenarios, both of
// which run against the REAL repository and are structurally unable to
// discriminate a mutant here: scenario 01 asserts a fact ("no fix on the
// master checkout yet") that is true both with and without a broken
// masterCheckoutPath, because the real master checkout genuinely lacks this
// parcel's fix until it lands (same shape as the BL-1198 rule above - a
// real-integration test can be structurally incapable of discriminating the
// fix). Verified by hand: mutating `entries[0].path` to
// `entries[entries.length - 1].path` produced the SAME three "not ok" lines
// on BL-1462's own feature as the unmutated code.
//
// So this file drives the real `git worktree list --porcelain` parsing
// against a THROWAWAY git repository - never the live repository (BL-1390) -
// taken from the shared seeded fixture (BL-1039) rather than a raw `git
// init` of its own, per the standing repoCreationGuard.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { listWorktrees, masterCheckoutPath, firstLinkedWorktreePath } = require('../../specs/pipeline/steps/lib/roleWorktrees');
const { mkTmpDir } = require('./helpers/tmpDir');
const { checkoutSeededRepo } = require('./helpers/sharedRepoFixture');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

// BL-1390 guardrail: prove the fixture root's own .git before any mutating
// command runs against it.
function assertFixtureOwnsItsGit(cwd) {
  const commonDir = git(cwd, ['rev-parse', '--git-common-dir']);
  const resolved = path.resolve(cwd, commonDir);
  assert.ok(
    resolved.startsWith(cwd),
    `fixture root ${cwd} does not own its own .git (resolved common dir ${resolved}) - refusing to mutate`
  );
}

function buildFixtureRepoWithLinkedWorktree() {
  const master = checkoutSeededRepo('bl1462-worktree-master-');
  assertFixtureOwnsItsGit(master);

  const linkedParent = mkTmpDir('bl1462-worktree-linked-parent-');
  const linked = path.join(linkedParent, 'linked');
  git(master, ['worktree', 'add', '--quiet', linked, '-b', 'bl1462-fixture-branch']);

  return { master, linked };
}

test('BL-1462: masterCheckoutPath resolves to the FIRST entry `git worktree list` reports (the main checkout), never any linked one', () => {
  const { master, linked } = buildFixtureRepoWithLinkedWorktree();
  const entries = listWorktrees(master);
  assert.equal(entries.length, 2, `expected exactly one linked worktree in the fixture, got entries: ${JSON.stringify(entries)}`);
  assert.equal(masterCheckoutPath(master), path.resolve(master));
  assert.notEqual(masterCheckoutPath(master), path.resolve(linked));
});

test('BL-1462: firstLinkedWorktreePath resolves to the linked worktree, never the master checkout', () => {
  const { master, linked } = buildFixtureRepoWithLinkedWorktree();
  assert.equal(firstLinkedWorktreePath(master), path.resolve(linked));
});

test('BL-1462: firstLinkedWorktreePath is a real missing precondition (null), never a false assumption, when no linked worktree exists', () => {
  const master = checkoutSeededRepo('bl1462-worktree-solo-');
  assertFixtureOwnsItsGit(master);

  assert.equal(masterCheckoutPath(master), path.resolve(master));
  assert.equal(firstLinkedWorktreePath(master), null);
});
