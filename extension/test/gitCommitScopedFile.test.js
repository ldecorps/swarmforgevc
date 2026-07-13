const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { commitScopedFile } = require('../out/util/gitCommitScopedFile');

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
