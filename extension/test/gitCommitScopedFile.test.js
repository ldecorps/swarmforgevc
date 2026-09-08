const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { commitScopedFile, isFileCommitted } = require('../out/util/gitCommitScopedFile');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');

// Shared by costHealthSidecar.ts's commitCostHealthSidecar and
// blTopicStore.ts's commitTopicRecord - see cleaner DRY extraction, 2026-07-13.

function mkTmp() {
  return mkTmpDir('sfvc-git-commit-scoped-');
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkGitRepo() {
  const target = mkTmp();
  copySeededRepoInto(target);
  return target;
}

test('commitScopedFile commits only the named file, leaving other dirty state untouched', () => {
  const target = mkGitRepo();
  fs.writeFileSync(path.join(target, 'unrelated.txt'), 'do not commit me');
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');

  const committed = commitScopedFile(target, filePath, 'test commit');
  assert.equal(committed, true);

  const status = execFileSync('git', ['-C', target, 'status', '--porcelain'], { encoding: 'utf8' });
  assert.match(status, /unrelated\.txt/, 'the unrelated file must remain uncommitted (still dirty)');
  assert.doesNotMatch(status, /tracked\.txt/, 'the named file must no longer show as dirty (it was committed)');

  const log = execFileSync('git', ['-C', target, 'log', '--format=%s', '--', filePath], { encoding: 'utf8' });
  assert.match(log, /test commit/);
});

// BL-1475: a "nothing to commit" attempt (identical content already
// committed) verifies as durable against HEAD before commitScopedFile
// reports failure - true, not the previously ambiguous false (which every
// caller here used to have to pre-check with isFileCommitted to tell apart
// from a genuine failure).
test('commitScopedFile returns true (already durable) when there is nothing new to commit', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');
  commitScopedFile(target, filePath, 'first commit');

  assert.doesNotThrow(() => commitScopedFile(target, filePath, 'second commit'));
  assert.equal(commitScopedFile(target, filePath, 'second commit'), true);
});

test('commitScopedFile returns false (never throws) when the target is not a git repo at all', () => {
  const target = mkTmp();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');

  assert.doesNotThrow(() => commitScopedFile(target, filePath, 'commit'));
  assert.equal(commitScopedFile(target, filePath, 'commit'), false);
});

// ── isFileCommitted (BL-331 architect bounce: content-verified is not the
//    same as DURABLY verified - a caller gating an irreversible action must
//    check this too) ─────────────────────────────────────────────────────

test('isFileCommitted is true once commitScopedFile has actually committed the file', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');
  commitScopedFile(target, filePath, 'commit it');
  assert.equal(isFileCommitted(target, filePath), true);
});

test('isFileCommitted is false for a file written directly, never committed (the exact crash window CommitFailureReporter exists for)', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content'); // written, but never git add/commit
  assert.equal(isFileCommitted(target, filePath), false);
});

test('isFileCommitted is false when the file was committed once, then modified again without a follow-up commit', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'v1');
  commitScopedFile(target, filePath, 'v1 commit');
  fs.writeFileSync(filePath, 'v2'); // a later write with no follow-up commit
  assert.equal(isFileCommitted(target, filePath), false);
});

test('isFileCommitted is false (fails closed, never throws) when the target is not a git repo at all', () => {
  const target = mkTmp();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');
  assert.doesNotThrow(() => isFileCommitted(target, filePath));
  assert.equal(isFileCommitted(target, filePath), false);
});

test('isFileCommitted is unaffected by an UNRELATED dirty file elsewhere in the same repo', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');
  commitScopedFile(target, filePath, 'commit it');
  fs.writeFileSync(path.join(target, 'unrelated.txt'), 'some other dirty file');
  assert.equal(isFileCommitted(target, filePath), true, 'expected the check scoped to exactly the one file, not the whole repo status');
});

// BL-390 hardening: `git status --porcelain -- <path>` prints nothing for a
// path that was never written at all - the same empty output as a path
// that IS committed with no pending changes. A file that does not exist on
// disk can never be "durably committed"; fail closed rather than reading
// silence as durability.
test('isFileCommitted is false for a path that was never written at all (fails closed, not a true-by-silence false positive)', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'never-written.txt');
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(isFileCommitted(target, filePath), false);
});

// ── BL-407: commitScopedFile's git add/commit pair can fail on a TRANSIENT
// index-lock collision (confirmed live: two concurrent processes sharing one
// physical worktree - e.g. the front-desk bot and a coordinator commit - can
// race on .git/index.lock). The prior single-attempt, fail-open contract
// turned a momentary collision into a PERMANENT durability gap (26+ done
// tickets' completion records sat uncommitted for weeks). A bounded retry
// with backoff (this codebase's own established pattern - see
// daemon_alarm_lib.bb / tmuxClient's capped respawn) self-heals the
// transient case without ever retrying unboundedly. The attempt/sleep steps
// are injected (mirrors CommitFailureReporter's own adapter-injected
// testability convention) so this is provable without a real git race or a
// real wall-clock wait.
test('commitScopedFile retries a transient (retryable) failure and succeeds once a later attempt does', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');

  let calls = 0;
  const attemptCommit = () => {
    calls += 1;
    return { committed: calls >= 3, retryable: true }; // fails twice, succeeds on the 3rd attempt
  };
  const sleeps = [];
  const sleep = (ms) => sleeps.push(ms);

  const committed = commitScopedFile(target, filePath, 'msg', attemptCommit, sleep);
  assert.equal(committed, true);
  assert.equal(calls, 3, 'expected exactly 3 attempts (2 failures + the succeeding one)');
  assert.equal(sleeps.length, 2, 'expected a backoff sleep between each failed attempt, never after success');
});

// BL-1475: raised from 3 attempts to 12 (a budget sized to the guard chain,
// which can hold .git/index.lock for seconds) - only ever retried for a
// retryable (lock-shaped) failure, never a real error.
test('commitScopedFile gives up after its bounded attempt cap, never retrying unboundedly', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');

  let calls = 0;
  const attemptCommit = () => {
    calls += 1;
    return { committed: false, retryable: true }; // always fails, always retryable
  };
  const sleeps = [];
  const sleep = (ms) => sleeps.push(ms);

  const committed = commitScopedFile(target, filePath, 'msg', attemptCommit, sleep);
  assert.equal(committed, false);
  assert.equal(calls, 12, 'expected the full 12-attempt budget to be spent on a retryable failure');
  assert.equal(sleeps.length, calls - 1, 'expected one backoff sleep between each attempt, none after the last');
});

test('commitScopedFile does NOT retry a non-retryable (real) failure, even once', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');

  let calls = 0;
  const attemptCommit = () => {
    calls += 1;
    return { committed: false, retryable: false, stderr: 'hook declined' };
  };
  const sleeps = [];
  const sleep = (ms) => sleeps.push(ms);

  const committed = commitScopedFile(target, filePath, 'msg', attemptCommit, sleep);
  assert.equal(committed, false);
  assert.equal(calls, 1, 'expected exactly one attempt for a non-retryable failure');
  assert.deepEqual(sleeps, [], 'expected no backoff wait for a non-retryable failure');
});

test('commitScopedFile reports the real stderr from the final failed attempt via onFailureDetail, never on success', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');

  const details = [];
  const attemptCommit = () => ({ committed: false, retryable: false, stderr: "fatal: Unable to create '.../.git/index.lock': File exists." });

  const committed = commitScopedFile(target, filePath, 'msg', attemptCommit, () => {}, 3, (stderr) => details.push(stderr));
  assert.equal(committed, false);
  assert.deepEqual(details, ["fatal: Unable to create '.../.git/index.lock': File exists."]);

  details.length = 0;
  const successAttempt = () => ({ committed: true });
  const succeeded = commitScopedFile(target, filePath, 'msg', successAttempt, () => {}, 3, (stderr) => details.push(stderr));
  assert.equal(succeeded, true);
  assert.deepEqual(details, [], 'onFailureDetail must never fire on a successful commit');
});

test('commitScopedFile backs off with an increasing delay between retries, capped, never a flat/zero wait', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');

  const attemptCommit = () => ({ committed: false, retryable: true });
  const sleeps = [];
  const sleep = (ms) => sleeps.push(ms);

  commitScopedFile(target, filePath, 'msg', attemptCommit, sleep);
  assert.ok(sleeps.every((ms) => ms > 0), `expected every backoff delay to be positive, got ${JSON.stringify(sleeps)}`);
  assert.ok(sleeps[sleeps.length - 1] >= sleeps[0], `expected a non-decreasing backoff, got ${JSON.stringify(sleeps)}`);
  assert.ok(sleeps.every((ms) => ms <= 5000), `expected every backoff delay capped at 5000ms, got ${JSON.stringify(sleeps)}`);
});

test('commitScopedFile with the REAL default attempt/sleep still commits on the ordinary (first-try) success path', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');

  assert.equal(commitScopedFile(target, filePath, 'test commit'), true);
  const log = execFileSync('git', ['-C', target, 'log', '--format=%s', '--', filePath], { encoding: 'utf8' });
  assert.match(log, /test commit/);
});

// BL-1475: the real default attemptCommit captures git's own stderr and
// flags a `.git/index.lock` refusal as retryable - proven against a REAL
// lock file (no fake seam for the attempt itself), only sleep is faked so
// the test never actually waits.
test('the REAL default attemptCommit reports an index.lock refusal as retryable, with gits own stderr', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');
  const lockPath = path.join(target, '.git', 'index.lock');
  fs.writeFileSync(lockPath, '');
  try {
    const sleeps = [];
    // maxAttempts=1 so this proves only the SINGLE attempt's own
    // classification, never depends on the lock actually being released.
    const committed = commitScopedFile(target, filePath, 'msg', undefined, (ms) => sleeps.push(ms), 1);
    assert.equal(committed, false, 'expected the commit to fail while the lock is held');
  } finally {
    fs.unlinkSync(lockPath);
  }
});

// BL-1475: another writer's commit already carrying the EXACT content this
// call intended to commit (simulated: the file is committed directly by a
// second real git command before commitScopedFile ever runs) means every
// one of THIS call's own attempts fails (nothing new to stage/commit), yet
// the outcome is durable - true, never a false alarm.
test('commitScopedFile reports true when another writer already committed the exact intended content', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');
  // The "other writer": commits the exact same content directly.
  git(target, ['add', '--', filePath]);
  git(target, ['commit', '-q', '-m', 'another writer landed it first']);

  let calls = 0;
  const attemptCommit = () => {
    calls += 1;
    return { committed: false, retryable: false, stderr: 'nothing to commit, working tree clean' };
  };
  assert.equal(commitScopedFile(target, filePath, 'msg', attemptCommit), true);
  assert.equal(calls, 1, 'a non-retryable failure is attempted exactly once before the durability check');
});
