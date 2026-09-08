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

// isFileCommitted checks status.trim().length === 0, never bare
// status.length === 0 - real `git status --porcelain` for a clean path
// returns a truly empty string, so this only matters for whitespace-only
// output; proven by making the real execFileSync return exactly that for
// the status call (every other call - add/commit for the setup - still
// goes through to the real git).
test('isFileCommitted treats whitespace-only git status output as clean/committed, not merely a byte-empty string', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked-whitespace-status.txt');
  fs.writeFileSync(filePath, 'content');
  commitScopedFile(target, filePath, 'commit it');

  const cp = require('node:child_process');
  const original = cp.execFileSync;
  cp.execFileSync = (...args) => {
    if (Array.isArray(args[1]) && args[1].includes('status')) {
      return '\n';
    }
    return original(...args);
  };
  let result;
  try {
    result = isFileCommitted(target, filePath);
  } finally {
    cp.execFileSync = original;
  }
  assert.equal(result, true, 'whitespace-only porcelain output must still read as clean/committed');
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
  // Exact values: with the default 250ms base and 11 real backoff calls
  // (12 attempts), 250*attempt never reaches the 5000ms cap - so a loose
  // "every delay <= 5000" check alone cannot tell Math.min from Math.max
  // (a min(x,5000) with x always below 5000 IS x; a max(x,5000) with x
  // always below 5000 is flatly 5000 every time, and still satisfies every
  // other assertion above). Pin the actual sequence.
  assert.deepEqual(sleeps, [250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750]);
});

test('commitScopedFile with the REAL default attempt/sleep still commits on the ordinary (first-try) success path', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');

  assert.equal(commitScopedFile(target, filePath, 'test commit'), true);
  const log = execFileSync('git', ['-C', target, 'log', '--format=%s', '--', filePath], { encoding: 'utf8' });
  assert.match(log, /test commit/);
});

// BL-1475: a first-attempt success returns true DIRECTLY from the loop -
// isFileCommitted (its own extra `git status --porcelain` subprocess) only
// runs as a fallback after every attempt gives up, never as a redundant
// re-check of a success the loop already saw. Proven by spying on the real
// child_process.execFileSync (the compiled module looks it up on the
// SAME cached core-module object at call time, so patching it here reaches
// defaultAttemptCommit/isFileCommitted without any seam of their own) and
// asserting no `status` subprocess call happens on this path.
test('commitScopedFile returns immediately on a first-attempt success, never re-verifying with an extra git status call', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked-immediate.txt');
  fs.writeFileSync(filePath, 'content');

  const cp = require('node:child_process');
  const original = cp.execFileSync;
  const argvCalls = [];
  cp.execFileSync = (...args) => {
    argvCalls.push(args[1]);
    return original(...args);
  };
  let committed;
  try {
    committed = commitScopedFile(target, filePath, 'test commit immediate');
  } finally {
    cp.execFileSync = original;
  }

  assert.equal(committed, true);
  const statusCalls = argvCalls.filter((argv) => argv.includes('status'));
  assert.equal(statusCalls.length, 0, `expected no git status call on a first-try success, got argv: ${JSON.stringify(statusCalls)}`);
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

// BL-1475: the sibling of the test above, checking the ACTUAL stderr text
// the real defaultAttemptCommit extracts from a genuine execFileSync
// failure - the prior test only checks the overall boolean, never that
// git's own message (rather than undefined, or an empty string) reaches
// onFailureDetail.
test('the REAL default attemptCommit carries gits actual stderr text through to onFailureDetail on final failure', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked-real-stderr.txt');
  fs.writeFileSync(filePath, 'content');
  const lockPath = path.join(target, '.git', 'index.lock');
  fs.writeFileSync(lockPath, '');
  try {
    const details = [];
    const committed = commitScopedFile(target, filePath, 'msg', undefined, () => {}, 1, (stderr) => details.push(stderr));
    assert.equal(committed, false);
    assert.equal(details.length, 1);
    assert.match(details[0], /index\.lock/, `expected gits real stderr naming index.lock, got: ${JSON.stringify(details[0])}`);
  } finally {
    fs.unlinkSync(lockPath);
  }
});

// BL-1475: proves the REAL defaultAttemptCommit actually classifies an
// index.lock refusal as `retryable: true` (not merely that the overall
// call eventually fails or succeeds) - by releasing the lock only inside
// the injected sleep, a retry can only reach the second, successful
// attempt if retryable was correctly true.
test('the REAL default attemptCommit is retried by commitScopedFile when the lock is transient (proving retryable was true, not silently false)', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked-real-retry.txt');
  fs.writeFileSync(filePath, 'content');
  const lockPath = path.join(target, '.git', 'index.lock');
  fs.writeFileSync(lockPath, '');
  const sleeps = [];
  const releasingSleep = (ms) => {
    sleeps.push(ms);
    fs.unlinkSync(lockPath);
  };

  const committed = commitScopedFile(target, filePath, 'msg', undefined, releasingSleep, 3);
  assert.equal(committed, true);
  assert.equal(sleeps.length, 1, `expected exactly one retry sleep before the second attempt succeeded, got ${JSON.stringify(sleeps)}`);
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
