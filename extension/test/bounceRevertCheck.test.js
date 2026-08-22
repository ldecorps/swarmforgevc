const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { bouncingBranchForRole, decideBounceRevertVerdict } = require('../out/quality/bounceRevertVerdict');
const { bounceRevertCheck } = require('../out/metrics/bounceRevertGitAdapter');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');

// BL-954: the bounce recorder verifies its own BL-490/BL-495 revert. The
// verdict is decided by whether the bounced commit's CONTENT is present at
// the bouncing branch tip, never by ancestry (invariant 1); an
// already-on-main bounce is a breach report and never a revert instruction
// (invariant 2). The check REPORTS - it never blocks the recording
// (invariant 3, covered at the CLI layer in recordBounceCli.test.js).
// Pure verdict lives under src/quality/ (the dependency-gate policy zone);
// the git-IO adapter under src/metrics/ (architect bounce D1).

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function initRepo(root) {
  copySeededRepoInto(root);
}

function commitFile(root, file, content, message) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
  git(root, ['add', file]);
  git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

// A fixture holding a bouncing branch (swarmforge-architect) with one
// bounced commit on it. `main` stays behind at the seed commit unless a
// test advances it.
function mkBounceFixture() {
  const root = mkTmpDir('sfvc-bl954-');
  initRepo(root);
  commitFile(root, 'src/a.txt', 'base\n', 'seed');
  git(root, ['checkout', '-q', '-b', 'swarmforge-architect']);
  const bounced = commitFile(root, 'src/a.txt', 'bounced content\n', 'BL-999: the bounced change');
  git(root, ['checkout', '-q', 'main']);
  return { root, bounced };
}

// ── bouncingBranchForRole ──────────────────────────────────────────────────

test('bouncingBranchForRole maps a role to its swarmforge-<role> review branch, QA case preserved', () => {
  assert.equal(bouncingBranchForRole('architect'), 'swarmforge-architect');
  assert.equal(bouncingBranchForRole('QA'), 'swarmforge-QA');
});

// ── decideBounceRevertVerdict: the pure truth table ────────────────────────

const resolvedFacts = (overrides = {}) => ({
  commitResolves: true,
  branchResolves: true,
  ancestorOfMain: false,
  files: [{ path: 'src/a.txt', tipMatchesBounced: false, bouncedDiffersFromParent: true }],
  ...overrides,
});

test('content live at the tip is a violation carrying a revert remedy', () => {
  const report = decideBounceRevertVerdict(
    resolvedFacts({ files: [{ path: 'src/a.txt', tipMatchesBounced: true, bouncedDiffersFromParent: true }] })
  );
  assert.equal(report.verdict, 'violation');
  assert.match(report.remedy, /git revert/);
  assert.deepEqual(report.liveFiles, ['src/a.txt']);
});

test('content gone from the tip is clean with no remedy', () => {
  const report = decideBounceRevertVerdict(resolvedFacts());
  assert.equal(report.verdict, 'clean');
  assert.equal(report.remedy, null);
});

test('a file the bounced commit did not change never counts as live', () => {
  // tip == bounced version BECAUSE the bounced commit never touched it
  // (bounced == parent): matching content proves nothing about the revert.
  const report = decideBounceRevertVerdict(
    resolvedFacts({ files: [{ path: 'src/b.txt', tipMatchesBounced: true, bouncedDiffersFromParent: false }] })
  );
  assert.equal(report.verdict, 'clean');
});

test('already an ancestor of main is a breach report and NEVER a revert instruction, even with content live', () => {
  const report = decideBounceRevertVerdict(
    resolvedFacts({
      ancestorOfMain: true,
      files: [{ path: 'src/a.txt', tipMatchesBounced: true, bouncedDiffersFromParent: true }],
    })
  );
  assert.equal(report.verdict, 'breach-report');
  assert.equal(report.remedy, null);
  assert.doesNotMatch(JSON.stringify(report), /git revert/);
});

test('an unresolvable bounced commit is undeterminable and names the commit as the cause', () => {
  const report = decideBounceRevertVerdict(
    decideInputsForUnresolvable({ commitResolves: false })
  );
  assert.equal(report.verdict, 'undeterminable');
  assert.match(report.cause, /commit/);
});

test('an unresolvable bouncing branch is undeterminable and names the branch as the cause', () => {
  const report = decideBounceRevertVerdict(
    decideInputsForUnresolvable({ branchResolves: false })
  );
  assert.equal(report.verdict, 'undeterminable');
  assert.match(report.cause, /branch/);
});

function decideInputsForUnresolvable(overrides) {
  return resolvedFacts({ files: [], ...overrides });
}

// ── bounceRevertCheck: gathering over a real fixture repo ─────────────────

test('an unreverted bounce reports a violation naming the live file and the revert command', () => {
  const { root, bounced } = mkBounceFixture();
  const report = bounceRevertCheck({ repoRoot: root, commit: bounced, by: 'architect' });
  assert.equal(report.verdict, 'violation');
  assert.deepEqual(report.liveFiles, ['src/a.txt']);
  assert.match(report.remedy, new RegExp(`git revert .*${bounced.slice(0, 7)}`));
  assert.equal(report.branch, 'swarmforge-architect');
});

test('a properly reverted bounce reads clean even though the commit is still an ancestor of the branch (invariant 1)', () => {
  const { root, bounced } = mkBounceFixture();
  git(root, ['checkout', '-q', 'swarmforge-architect']);
  git(root, ['revert', '--no-edit', bounced]);
  git(root, ['checkout', '-q', 'main']);
  // ancestry still holds - the constitution's own point
  git(root, ['merge-base', '--is-ancestor', bounced, 'swarmforge-architect']);
  const report = bounceRevertCheck({ repoRoot: root, commit: bounced, by: 'architect' });
  assert.equal(report.verdict, 'clean');
  assert.equal(report.remedy, null);
});

test('a bounced commit already on main is a breach report with no revert instruction (invariant 2)', () => {
  const { root, bounced } = mkBounceFixture();
  git(root, ['merge', '-q', '--no-edit', bounced]);
  const report = bounceRevertCheck({ repoRoot: root, commit: bounced, by: 'architect' });
  assert.equal(report.verdict, 'breach-report');
  assert.equal(report.remedy, null);
  assert.doesNotMatch(JSON.stringify(report), /git revert/);
});

test('an unresolvable commit is undeterminable, cause names the commit, and nothing throws', () => {
  const { root } = mkBounceFixture();
  const report = bounceRevertCheck({ repoRoot: root, commit: 'ffffffffff', by: 'architect' });
  assert.equal(report.verdict, 'undeterminable');
  assert.match(report.cause, /ffffffffff/);
});

test('a missing bouncing branch is undeterminable and the cause names the branch', () => {
  const { root, bounced } = mkBounceFixture();
  const report = bounceRevertCheck({ repoRoot: root, commit: bounced, by: 'documenter' });
  assert.equal(report.verdict, 'undeterminable');
  assert.match(report.cause, /swarmforge-documenter/);
});

test('a file DELETED by the bounced commit counts as live while the tip still lacks it', () => {
  const root = mkTmpDir('sfvc-bl954-del-');
  initRepo(root);
  commitFile(root, 'src/gone.txt', 'to be deleted\n', 'seed');
  git(root, ['checkout', '-q', '-b', 'swarmforge-cleaner']);
  git(root, ['rm', '-q', 'src/gone.txt']);
  git(root, ['commit', '-q', '-m', 'BL-998: bounced deletion']);
  const bounced = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-q', 'main']);
  const report = bounceRevertCheck({ repoRoot: root, commit: bounced, by: 'cleaner' });
  assert.equal(report.verdict, 'violation');
  assert.deepEqual(report.liveFiles, ['src/gone.txt']);
});

// ── Architect bounce D2: a bounced MERGE commit must never read clean by blindness ──

// The bounced commit is a MERGE whose first-parent-side diff carries the
// bounced content. A bare diff-tree lists nothing for it - the pre-fix
// implementation read every such bounce as 'clean' unconditionally.
function mkMergeBounceFixture() {
  const root = mkTmpDir('sfvc-bl954-merge-');
  initRepo(root);
  commitFile(root, 'src/a.txt', 'base\n', 'seed');
  git(root, ['checkout', '-q', '-b', 'feature']);
  commitFile(root, 'src/a.txt', 'bounced content\n', 'BL-997: side work');
  git(root, ['checkout', '-q', '-b', 'swarmforge-architect', 'main']);
  git(root, ['merge', '-q', '--no-ff', '--no-edit', 'feature']);
  const bounced = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-q', 'main']);
  return { root, bounced };
}

test('BL-954 D2: an unreverted MERGE-commit bounce reports a violation, never a blind clean', () => {
  const { root, bounced } = mkMergeBounceFixture();
  const report = bounceRevertCheck({ repoRoot: root, commit: bounced, by: 'architect' });
  assert.equal(report.verdict, 'violation');
  assert.deepEqual(report.liveFiles, ['src/a.txt']);
});

test('BL-954 D2: a properly reverted MERGE-commit bounce reads clean', () => {
  const { root, bounced } = mkMergeBounceFixture();
  git(root, ['checkout', '-q', 'swarmforge-architect']);
  git(root, ['revert', '--no-edit', '-m', '1', bounced]);
  git(root, ['checkout', '-q', 'main']);
  const report = bounceRevertCheck({ repoRoot: root, commit: bounced, by: 'architect' });
  assert.equal(report.verdict, 'clean');
});

// ── Architect bounce D3: a commit published on origin/main only is still a breach ──

test('BL-954 D3: a commit that is an ancestor of origin/main but NOT of a stale local main is a breach report, never a revert instruction', () => {
  const { root, bounced } = mkBounceFixture();
  // origin/main advanced past the bounced commit while local main stayed at
  // the seed - the exact BL-891 divergence shape.
  git(root, ['update-ref', 'refs/remotes/origin/main', bounced]);
  git(root, ['merge-base', '--is-ancestor', bounced, 'origin/main']);
  const localMainHasIt = (() => {
    try {
      git(root, ['merge-base', '--is-ancestor', bounced, 'main']);
      return true;
    } catch {
      return false;
    }
  })();
  assert.equal(localMainHasIt, false, 'fixture precondition: local main must NOT contain the bounced commit');
  const report = bounceRevertCheck({ repoRoot: root, commit: bounced, by: 'architect' });
  assert.equal(report.verdict, 'breach-report');
  assert.equal(report.remedy, null);
  assert.doesNotMatch(JSON.stringify(report), /git revert/);
});
