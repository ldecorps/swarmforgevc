const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { commitScopedFile, isFileCommitted } = require('../out/util/gitCommitScopedFile');

// Shared by costHealthSidecar.ts's commitCostHealthSidecar and
// blTopicStore.ts's commitTopicRecord - see cleaner DRY extraction, 2026-07-13.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-git-commit-scoped-'));
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkGitRepo() {
  const target = mkTmp();
  git(target, ['init', '-q']);
  git(target, ['config', 'user.email', 't@t']);
  git(target, ['config', 'user.name', 't']);
  git(target, ['commit', '-q', '-m', 'init', '--allow-empty']);
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

test('commitScopedFile returns false (never throws) when there is nothing new to commit', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');
  commitScopedFile(target, filePath, 'first commit');

  assert.doesNotThrow(() => commitScopedFile(target, filePath, 'second commit'));
  assert.equal(commitScopedFile(target, filePath, 'second commit'), false);
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
test('commitScopedFile retries a transient failure and succeeds once a later attempt does', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');

  let calls = 0;
  const attemptCommit = () => {
    calls += 1;
    return calls >= 3; // fails twice, succeeds on the 3rd attempt
  };
  const sleeps = [];
  const sleep = (ms) => sleeps.push(ms);

  const committed = commitScopedFile(target, filePath, 'msg', attemptCommit, sleep);
  assert.equal(committed, true);
  assert.equal(calls, 3, 'expected exactly 3 attempts (2 failures + the succeeding one)');
  assert.equal(sleeps.length, 2, 'expected a backoff sleep between each failed attempt, never after success');
});

test('commitScopedFile gives up after its bounded attempt cap, never retrying unboundedly', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');

  let calls = 0;
  const attemptCommit = () => {
    calls += 1;
    return false; // always fails
  };
  const sleeps = [];
  const sleep = (ms) => sleeps.push(ms);

  const committed = commitScopedFile(target, filePath, 'msg', attemptCommit, sleep);
  assert.equal(committed, false);
  assert.ok(calls >= 2 && calls <= 5, `expected a small bounded attempt count, got ${calls}`);
  assert.equal(sleeps.length, calls - 1, 'expected one backoff sleep between each attempt, none after the last');
});

test('commitScopedFile backs off with an increasing delay between retries, never a flat/zero wait', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');

  const attemptCommit = () => false;
  const sleeps = [];
  const sleep = (ms) => sleeps.push(ms);

  commitScopedFile(target, filePath, 'msg', attemptCommit, sleep);
  assert.ok(sleeps.every((ms) => ms > 0), `expected every backoff delay to be positive, got ${JSON.stringify(sleeps)}`);
  assert.ok(sleeps[sleeps.length - 1] >= sleeps[0], `expected a non-decreasing backoff, got ${JSON.stringify(sleeps)}`);
});

test('commitScopedFile with the REAL default attempt/sleep still commits on the ordinary (first-try) success path', () => {
  const target = mkGitRepo();
  const filePath = path.join(target, 'tracked.txt');
  fs.writeFileSync(filePath, 'content');

  assert.equal(commitScopedFile(target, filePath, 'test commit'), true);
  const log = execFileSync('git', ['-C', target, 'log', '--format=%s', '--', filePath], { encoding: 'utf8' });
  assert.match(log, /test commit/);
});
