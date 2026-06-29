const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const { getCurrentBranch, buildPrArgs } = require('../out/swarm/prCreator');

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
