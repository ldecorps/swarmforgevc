'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-1444 declared invariants (backlog/active/BL-1444-the-art-directors-tip-lands-on-main-by-qa.yaml):
//   1. "The verdict is a function of git objects only - the tip's
//      reachability from primary/art-director and from the landed main, and
//      the last commit touching each path the tip introduces - never of
//      SWARMFORGE_ROLE, the current branch name, the working tree, or who
//      runs it."
//   2. "A merge whose incoming parent is reachable from the landed main is
//      never judged, whatever it carries; neither is one whose incoming
//      parent is not on primary/art-director. Only an art-director-side
//      commit is ever judged."
//   3. "The guard reads only: it never writes a file, moves a ref, fetches,
//      or pushes."
// Coder-authored property tests per BL-654; run only via `npm run
// test:properties`. Drive the REAL swarmforge/scripts/check_art_director_tip.sh
// as real git subprocesses against real throwaway repositories - never a
// parallel reimplementation of the guard's decision logic. Hook mode is
// reached the same way a real `git merge --no-ff` reaches it - MERGE_HEAD
// present, mid-merge, via `git merge --no-ff --no-commit` - not a
// hand-simulated substitute, and never touches the live repository (a fresh
// `git init` under mkdtemp every case, BL-1390 posture).

const REPO_ROOT = path.join(__dirname, '..', '..');
const GUARD_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_art_director_tip.sh');

function git(cwd, args, env) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env });
}

function gitOk(cwd, args, env) {
  const r = git(cwd, args, env);
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (rc=${r.status}) in ${cwd}: ${r.stderr}`);
  }
  return (r.stdout || '').trim();
}

function mkRepo() {
  const d = mkTmpDir('bl1444-prop-');
  gitOk(d, ['init', '-q', '-b', 'main']);
  gitOk(d, ['config', 'user.email', 't@t']);
  gitOk(d, ['config', 'user.name', 't']);
  gitOk(d, ['commit', '-q', '--allow-empty', '-m', 'init']);
  gitOk(d, ['branch', 'primary/art-director', 'main']);
  return d;
}

// One commit on <branch> touching every given relative path, in one shot.
function writeCommit(d, branch, relPaths) {
  gitOk(d, ['checkout', '-q', branch]);
  for (const rel of relPaths) {
    const full = path.join(d, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'v1\n');
    gitOk(d, ['add', rel]);
  }
  gitOk(d, ['commit', '-q', '-m', `change ${relPaths.join(', ')}`]);
  return gitOk(d, ['rev-parse', 'HEAD']);
}

// ── generator reach: mixed in-lane and out-of-lane path shapes ───────────
// Both lane rules (docs/design/ prefix, backlog/evidence/*art-director*
// substring) and several out-of-lane roots, varying nesting depth - so a
// generated tip is sometimes wholly in lane, sometimes wholly out, and
// sometimes mixed, exercising both ART_DIRECTOR_TIP_OK and
// ART_DIRECTOR_TIP_REFUSED verdicts across runs.
const segmentArb = fc.stringMatching(/^[a-z][a-z0-9_-]{0,6}$/);

const laneDocsPathArb = fc
  .tuple(fc.array(segmentArb, { minLength: 0, maxLength: 2 }), segmentArb)
  .map(([dirs, name]) => `docs/design/${dirs.length ? `${dirs.join('/')}/` : ''}${name}.md`);

const laneEvidencePathArb = segmentArb.map((s) => `backlog/evidence/${s}-art-director-${s}.md`);

const outOfLanePathArb = fc
  .tuple(fc.constantFrom('extension/src/', 'swarmforge/scripts/', 'docs/how-to/', 'backlog/paused/'), segmentArb)
  .map(([prefix, name]) => `${prefix}${name}.ts`);

// backlog/evidence/ WITHOUT the "art-director" substring - still out of lane.
const nonArtDirectorEvidencePathArb = segmentArb.map((s) => `backlog/evidence/${s}-qa-pass.md`);

const pathArb = fc.oneof(laneDocsPathArb, laneEvidencePathArb, outOfLanePathArb, nonArtDirectorEvidencePathArb);
const tipPathsArb = fc
  .array(pathArb, { minLength: 1, maxLength: 3 })
  .map((arr) => [...new Set(arr)])
  .filter((arr) => arr.length > 0);

function runGuard(cwd, args, env) {
  const r = spawnSync('bash', [GUARD_SCRIPT, ...args], { cwd, encoding: 'utf8', env });
  return { rc: r.status, combined: `${r.stdout || ''}${r.stderr || ''}` };
}

function roleEnv(role) {
  const env = { ...process.env };
  delete env.SWARMFORGE_ROLE;
  if (role !== undefined) env.SWARMFORGE_ROLE = role;
  return env;
}

// ── invariant 1 ────────────────────────────────────────────────────────
test('property (invariant): the verdict is a function of git objects only - never SWARMFORGE_ROLE, the current branch name, the working tree, or who runs it', () => {
  fc.assert(
    fc.property(
      tipPathsArb,
      fc.constantFrom(undefined, 'coder', 'QA', 'architect', 'documenter', 'coordinator'),
      fc.stringMatching(/^[a-z][a-z0-9-]{2,8}$/),
      (relPaths, role, altBranchName) => {
        const d = mkRepo();
        const tip = writeCommit(d, 'primary/art-director', relPaths);
        gitOk(d, ['checkout', '-q', 'main']);
        const landingSha = gitOk(d, ['rev-parse', 'HEAD']);

        gitOk(d, ['checkout', '-q', landingSha]); // detached HEAD, same commit
        const baseline = runGuard(d, ['--tip', tip], roleEnv(undefined));

        const withRole = runGuard(d, ['--tip', tip], roleEnv(role));
        assert.deepEqual(withRole, baseline, `SWARMFORGE_ROLE=${role} changed the verdict`);

        gitOk(d, ['checkout', '-q', '-B', altBranchName, landingSha]); // same commit, different branch NAME
        const withBranch = runGuard(d, ['--tip', tip], roleEnv(undefined));
        assert.deepEqual(withBranch, baseline, 'the current branch name changed the verdict');

        gitOk(d, ['checkout', '-q', landingSha]);
        fs.writeFileSync(path.join(d, 'unrelated-dirty.txt'), 'dirty\n');
        const withDirtyTree = runGuard(d, ['--tip', tip], roleEnv(undefined));
        assert.deepEqual(withDirtyTree, baseline, 'an unrelated dirty working-tree file changed the verdict');
        fs.rmSync(path.join(d, 'unrelated-dirty.txt'));

        const identityEnv = roleEnv(undefined);
        identityEnv.GIT_AUTHOR_NAME = 'someone-else';
        identityEnv.GIT_AUTHOR_EMAIL = 'someone-else@example.com';
        identityEnv.USER = 'someone-else';
        identityEnv.LOGNAME = 'someone-else';
        const withIdentity = runGuard(d, ['--tip', tip], identityEnv);
        assert.deepEqual(withIdentity, baseline, "git identity / $USER (who runs it) changed the verdict");
      }
    ),
    { numRuns: 10 }
  );
}, 30000);

// ── invariant 2 ────────────────────────────────────────────────────────
const shapeArb = fc.constantFrom('not-on-art-director', 'reachable-from-main', 'fresh-on-art-director');

test('property (invariant): hook mode judges only an unmerged art-director-side commit; a merge whose incoming parent is not on primary/art-director, or is already reachable from the landed main, is never judged, whatever it carries', () => {
  fc.assert(
    fc.property(shapeArb, tipPathsArb, (shape, relPaths) => {
      const d = mkRepo();
      const earlyMain = gitOk(d, ['rev-parse', 'main']);

      let incoming;
      if (shape === 'not-on-art-director') {
        gitOk(d, ['checkout', '-q', '-b', 'other-role', 'main']);
        incoming = writeCommit(d, 'other-role', relPaths);
      } else if (shape === 'reachable-from-main') {
        incoming = writeCommit(d, 'main', relPaths);
      } else {
        incoming = writeCommit(d, 'primary/art-director', relPaths);
      }

      gitOk(d, ['checkout', '-q', '-b', 'landing', earlyMain]);
      const mergeRes = git(d, ['merge', '-q', '--no-ff', '--no-commit', incoming]);
      assert.equal(mergeRes.status, 0, `expected the fixture's own merge --no-commit to apply cleanly: ${mergeRes.stderr}`);

      const hookResult = runGuard(d, [], undefined);
      git(d, ['merge', '--abort']);

      if (shape === 'fresh-on-art-director') {
        // "only an art-director-side commit is ever judged": when it IS
        // judged, hook mode's verdict must agree with direct mode's own
        // verdict for the identical tip - both derive from the same
        // predicate, so they must never disagree.
        const directResult = runGuard(d, ['--tip', incoming], undefined);
        assert.equal(
          hookResult.rc !== 0,
          directResult.rc !== 0,
          `hook mode and direct mode disagreed for the same tip: hook rc=${hookResult.rc} (${hookResult.combined}), direct rc=${directResult.rc} (${directResult.combined})`
        );
      } else {
        assert.equal(
          hookResult.rc,
          0,
          `expected hook mode to skip (exit 0) for shape=${shape} regardless of the paths it carries (${relPaths.join(', ')}), got rc=${hookResult.rc}: ${hookResult.combined}`
        );
      }
    }),
    { numRuns: 10 }
  );
}, 30000);

// ── invariant 3 ────────────────────────────────────────────────────────
function snapshotRepoState(d) {
  const refs = gitOk(d, ['show-ref']);
  const status = gitOk(d, ['status', '--porcelain=v1', '--untracked-files=all']);
  const remotes = gitOk(d, ['remote', '-v']);
  const headSha = gitOk(d, ['rev-parse', 'HEAD']);
  const mergeHeadRes = git(d, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
  const mergeHead = mergeHeadRes.status === 0 ? (mergeHeadRes.stdout || '').trim() : '';
  return { refs, status, remotes, headSha, mergeHead };
}

test('property (invariant): the guard reads only - it never writes a file, moves a ref, fetches, or pushes', () => {
  fc.assert(
    fc.property(tipPathsArb, fc.boolean(), (relPaths, useHookMode) => {
      const d = mkRepo();
      const tip = writeCommit(d, 'primary/art-director', relPaths);
      gitOk(d, ['checkout', '-q', '-b', 'landing', 'main']);
      // Loud if the guard ever DID fetch or push: this remote cannot be
      // reached, so any attempt against it fails visibly rather than
      // silently succeeding.
      gitOk(d, ['remote', 'add', 'origin', '/nonexistent-bl1444-property-remote/repo.git']);

      let before;
      let result;
      let after;
      if (useHookMode) {
        const mergeRes = git(d, ['merge', '-q', '--no-ff', '--no-commit', tip]);
        assert.equal(mergeRes.status, 0, `expected the fixture's own merge --no-commit to apply cleanly: ${mergeRes.stderr}`);
        before = snapshotRepoState(d);
        result = runGuard(d, [], undefined);
        after = snapshotRepoState(d);
        git(d, ['merge', '--abort']);
      } else {
        before = snapshotRepoState(d);
        result = runGuard(d, ['--tip', tip], undefined);
        after = snapshotRepoState(d);
      }

      assert.deepEqual(
        after,
        before,
        `the guard (mode=${useHookMode ? 'hook' : 'direct'}, rc=${result.rc}) changed repo state: ` +
          `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
      );
    }),
    { numRuns: 10 }
  );
}, 30000);
