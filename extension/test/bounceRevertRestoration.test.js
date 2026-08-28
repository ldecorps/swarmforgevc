const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { decideBounceRevertVerdict } = require('../out/quality/bounceRevertVerdict');
const { bounceRevertCheck, gatherBounceRevertFacts } = require('../out/metrics/bounceRevertGitAdapter');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');

// BL-1208: a destructive revert remedy is earned by AUTHORSHIP of live
// content, never by liveness alone. Companion to bounceRevertCheck.test.js
// (BL-954) - that file's own scenarios are left untouched per this
// ticket's explicit constraint; every new behavior gets its own file.

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commitFile(root, file, content, message) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
  git(root, ['add', file]);
  git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function removeFile(root, file, message) {
  git(root, ['rm', '-q', file]);
  git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

// ── decideBounceRevertVerdict: pure verdict layer ──────────────────────────

test('BL-1208: a live file restored from earlier history withholds the remedy but stays a violation naming the path', () => {
  const report = decideBounceRevertVerdict({
    commitResolves: true,
    branchResolves: true,
    ancestorOfMain: false,
    files: [{ path: 'src/a.txt', tipMatchesBounced: true, bouncedDiffersFromParent: true, restoredFromEarlierHistory: true }],
  });
  assert.equal(report.verdict, 'violation');
  assert.equal(report.remedy, null);
  assert.deepEqual(report.liveFiles, ['src/a.txt']);
});

test('BL-1208: ANY live file not established as restored still earns the remedy, even alongside restored siblings', () => {
  const report = decideBounceRevertVerdict({
    commitResolves: true,
    branchResolves: true,
    ancestorOfMain: false,
    files: [
      { path: 'src/restored.txt', tipMatchesBounced: true, bouncedDiffersFromParent: true, restoredFromEarlierHistory: true },
      { path: 'src/authored.txt', tipMatchesBounced: true, bouncedDiffersFromParent: true, restoredFromEarlierHistory: false },
    ],
  });
  assert.equal(report.verdict, 'violation');
  assert.match(report.remedy, /git revert/);
  assert.deepEqual(report.liveFiles.sort(), ['src/authored.txt', 'src/restored.txt']);
});

test('BL-1208: restoredFromEarlierHistory absent (every pre-BL-1208 caller) behaves exactly as before - remedy offered', () => {
  const report = decideBounceRevertVerdict({
    commitResolves: true,
    branchResolves: true,
    ancestorOfMain: false,
    files: [{ path: 'src/a.txt', tipMatchesBounced: true, bouncedDiffersFromParent: true }],
  });
  assert.equal(report.verdict, 'violation');
  assert.match(report.remedy, /git revert/);
});

// ── bounceRevertCheck: gathering over real fixture repos ───────────────────

// The exact incident shape: a file existed on the branch, was lost (deleted
// or otherwise dropped from a later commit's parent), then a later commit
// restores byte-identical content. tipMatchesBounced AND bouncedDiffersFromParent
// both hold (a genuine "live" finding, BL-954 invariant 1 unaffected) - but
// the remedy must be withheld because the content is a restoration.
function mkRestorationFixture() {
  const root = mkTmpDir('sfvc-bl1208-restore-');
  copySeededRepoInto(root);
  git(root, ['checkout', '-q', '-b', 'swarmforge-architect']);
  commitFile(root, 'src/thing.ts', 'important content\n', 'add thing.ts');
  removeFile(root, 'src/thing.ts', 'oops, accidentally deleted thing.ts');
  const restored = commitFile(root, 'src/thing.ts', 'important content\n', 'recovery: restore thing.ts');
  git(root, ['checkout', '-q', 'main']);
  return { root, restored };
}

test('BL-1208: a commit that restores previously-lost, byte-identical content is a violation with the remedy withheld', () => {
  const { root, restored } = mkRestorationFixture();
  const report = bounceRevertCheck({ repoRoot: root, commit: restored, by: 'architect' });
  assert.equal(report.verdict, 'violation');
  assert.equal(report.remedy, null);
  assert.deepEqual(report.liveFiles, ['src/thing.ts']);
});

test('BL-1208 non-vacuity: content restored with DIFFERENT bytes than the earlier loss still earns the remedy (not a byte-for-byte match)', () => {
  const root = mkTmpDir('sfvc-bl1208-diff-');
  copySeededRepoInto(root);
  git(root, ['checkout', '-q', '-b', 'swarmforge-architect']);
  commitFile(root, 'src/thing.ts', 'important content\n', 'add thing.ts');
  removeFile(root, 'src/thing.ts', 'oops, accidentally deleted thing.ts');
  const restored = commitFile(root, 'src/thing.ts', 'DIFFERENT content, not a byte-for-byte restore\n', 'not actually a restore');
  git(root, ['checkout', '-q', 'main']);
  const report = bounceRevertCheck({ repoRoot: root, commit: restored, by: 'architect' });
  assert.equal(report.verdict, 'violation');
  assert.match(report.remedy, /git revert/);
});

test('BL-1208 scenario 03 guard: a genuinely NEW file coincidentally matching a sibling branch still earns the remedy', () => {
  const root = mkTmpDir('sfvc-bl1208-coincidence-');
  copySeededRepoInto(root);
  // A sibling review branch that happens to hold identical content at the
  // same path, for entirely unrelated reasons.
  git(root, ['checkout', '-q', '-b', 'swarmforge-cleaner']);
  commitFile(root, 'src/shared.ts', 'coincidentally identical fix\n', 'cleaner: unrelated own fix');
  git(root, ['checkout', '-q', 'main']);
  // architect's own branch has NEVER held this path before - a genuinely
  // new file, not a restoration, despite the sibling coincidence.
  git(root, ['checkout', '-q', '-b', 'swarmforge-architect']);
  const bounced = commitFile(root, 'src/shared.ts', 'coincidentally identical fix\n', 'architect: adds shared.ts (genuinely new here)');
  git(root, ['checkout', '-q', 'main']);
  const report = bounceRevertCheck({ repoRoot: root, commit: bounced, by: 'architect' });
  assert.equal(report.verdict, 'violation');
  assert.match(report.remedy, /git revert/);
  assert.deepEqual(report.liveFiles, ['src/shared.ts']);
});

test('BL-1208: an EDITED (not re-added) file is never a restoration candidate, even if it happens to match an earlier version', () => {
  // The bounced commit's parent already HAD this path (a plain edit) - the
  // restoration check only ever fires for an add-back where the immediate
  // parent lacked the path entirely.
  const root = mkTmpDir('sfvc-bl1208-edit-');
  copySeededRepoInto(root);
  git(root, ['checkout', '-q', '-b', 'swarmforge-architect']);
  commitFile(root, 'src/a.txt', 'version A\n', 'seed A');
  commitFile(root, 'src/a.txt', 'version B\n', 'edit to B');
  const backToA = commitFile(root, 'src/a.txt', 'version A\n', 'BL-999: reverts content back to version A (a plain edit, not a re-add)');
  git(root, ['checkout', '-q', 'main']);
  const report = bounceRevertCheck({ repoRoot: root, commit: backToA, by: 'architect' });
  assert.equal(report.verdict, 'violation');
  assert.match(report.remedy, /git revert/);
});

// Hardener: existedIdenticallyBeforeLoss's own `git log` call has a
// fail-safe branch (`if (log.status !== 0) return false`) that no real-git
// fixture above can reach - by the time this function runs, the caller has
// already established the file is an add-back (parent absent), and for
// every commit with a real parent, `git log <parent> -- path` succeeds
// (status 0) whether or not the path has any history, so the ONLY way this
// git invocation itself fails is an anomalous git error unrelated to the
// path's own history. Exercised directly with a fake runGit that mirrors
// every other call correctly and fails ONLY the `log` invocation, to prove
// the fail-safe direction: when the tool cannot determine restoration, it
// does NOT default to withholding the remedy (which would silently soften
// this ticket's own safety net) - it defaults to offering it, exactly as
// every pre-BL-1208 caller already did.
test('BL-1208: a git-log failure while checking prior history is NOT read as "restored" - the remedy is still offered (fail-safe direction)', () => {
  const commit = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
  const branch = 'swarmforge-architect';
  const filePath = 'src/thing.ts';
  const content = 'important content\n';
  // A commit hash the (failed) `log` call's stdout carries anyway - proves
  // the fail-safe check is what discards it, not merely empty stdout: if
  // the status guard were removed, this line would still be split out of
  // stdout and its `show` lookup below WOULD match `content`, flipping
  // .some(...) to true and silently un-doing the fail-safe.
  const staleLoggedCommit = 'a'.repeat(40);

  const fakeRunGit = (args) => {
    const joined = args.join(' ');
    if (joined.startsWith('rev-parse --verify --quiet')) return { status: 0, stdout: '' };
    if (joined.startsWith('merge-base --is-ancestor')) return { status: 1, stdout: '' };
    if (joined.startsWith('diff-tree')) return { status: 0, stdout: `${filePath}\n` };
    if (args[0] === 'show' && args[1] === `${commit}:${filePath}`) return { status: 0, stdout: content };
    if (args[0] === 'show' && args[1] === `${commit}^:${filePath}`) return { status: 1, stdout: '' };
    if (args[0] === 'show' && args[1] === `${branch}:${filePath}`) return { status: 0, stdout: content };
    if (args[0] === 'show' && args[1] === `${staleLoggedCommit}:${filePath}`) return { status: 0, stdout: content };
    // The `log` call itself fails (status 128, an anomalous git error) but,
    // as some git failures do, still emits stdout - the fail-safe must key
    // off the STATUS, never off whether stdout happens to be empty.
    if (args[0] === 'log') return { status: 128, stdout: `${staleLoggedCommit}\n` };
    throw new Error(`fakeRunGit: unexpected git invocation: ${joined}`);
  };

  const facts = gatherBounceRevertFacts({ commit, by: 'architect' }, fakeRunGit);
  const file = facts.files.find((f) => f.path === filePath);
  assert.equal(file.restoredFromEarlierHistory, false, 'a failed git-log lookup must never be read as a positive restoration finding, even when it still emits stdout');
  assert.equal(file.tipMatchesBounced, true);
  assert.equal(file.bouncedDiffersFromParent, true);
});
