const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { installExecutable } = require('./helpers/sharedBin');

const { getCurrentBranch, buildPrArgs, openPullRequest } = require('../out/swarm/prCreator');

function mkTmpGitRepo(branchName) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-pr-'));
  cp.execSync('git init', { cwd: tmp, stdio: 'ignore' });
  cp.execSync('git commit --allow-empty -m init', { cwd: tmp, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' } });
  if (branchName) {
    cp.execSync(`git checkout -b ${branchName}`, { cwd: tmp, stdio: 'ignore' });
  }
  return tmp;
}

test('getCurrentBranch returns current branch name', () => {
  const tmp = mkTmpGitRepo('my-feature');
  assert.equal(getCurrentBranch(tmp), 'my-feature');
});

test('getCurrentBranch returns undefined for a detached HEAD', () => {
  const tmp = mkTmpGitRepo();
  cp.execSync('git checkout --detach', { cwd: tmp, stdio: 'ignore' });
  assert.equal(getCurrentBranch(tmp), undefined);
});

test('getCurrentBranch returns undefined for non-git directory', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-nogit-'));
  assert.equal(getCurrentBranch(tmp), undefined);
});

test('buildPrArgs includes title and base branch', () => {
  const args = buildPrArgs('Fix auth bug', 'main');
  assert.ok(args.includes('--title'));
  assert.ok(args.includes('Fix auth bug'));
  assert.ok(args.includes('--base'));
  assert.ok(args.includes('main'));
});

test('buildPrArgs defaults base branch to main', () => {
  const args = buildPrArgs('My PR');
  assert.ok(args.includes('--base'));
  assert.ok(args.includes('main'));
});

test('buildPrArgs includes --fill flag', () => {
  const args = buildPrArgs('Title');
  assert.ok(args.includes('--fill'));
});

test('openPullRequest reports failure when gh is not available', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-pr-fail-'));
  const result = openPullRequest(tmp, 'Test PR');
  assert.equal(result.success, false);
  assert.ok(result.message.includes('Failed to create PR'));
});

function withFakeGh(scriptBody, fn) {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-fake-gh-'));
  const ghMock = path.join(binDir, 'gh');
  installExecutable(ghMock, `#!/bin/sh\n${scriptBody}\n`);
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
  try {
    return fn();
  } finally {
    process.env.PATH = originalPath;
    fs.rmSync(binDir, { recursive: true, force: true });
  }
}

test('openPullRequest extracts URL from gh output', () => {
  const tmp = mkTmpGitRepo('test-branch');
  withFakeGh(
    'echo "opening github.com/owner/repo/pull/1..."\necho "https://github.com/owner/repo/pull/1"',
    () => {
      const result = openPullRequest(tmp, 'Test PR');
      assert.equal(result.success, true);
      assert.equal(result.url, 'https://github.com/owner/repo/pull/1');
      assert.equal(result.message, 'PR created: https://github.com/owner/repo/pull/1');
    }
  );
});

test('openPullRequest succeeds with a generic message when gh prints no URL', () => {
  const tmp = mkTmpGitRepo('test-branch');
  withFakeGh('echo "pull request created"', () => {
    const result = openPullRequest(tmp, 'Test PR');
    assert.equal(result.success, true);
    assert.equal(result.url, undefined);
    assert.equal(result.message, 'PR created.');
  });
});
