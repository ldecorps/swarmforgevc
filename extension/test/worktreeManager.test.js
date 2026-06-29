const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const test = require('node:test');

const { WorktreeManager } = require('../out/orchestrator/WorktreeManager');

function mkGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-wt-'));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello');
  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' });
  return dir;
}

test('WorktreeManager setup creates worktrees for subordinate roles', () => {
  const repo = mkGitRepo();
  const wm = new WorktreeManager(repo);
  wm.setup(['coder', 'cleaner']);
  assert.ok(fs.existsSync(path.join(repo, '.worktrees', 'coder')));
  assert.ok(fs.existsSync(path.join(repo, '.worktrees', 'cleaner')));
});

test('WorktreeManager setup does not create worktrees for coordinator or specifier', () => {
  const repo = mkGitRepo();
  const wm = new WorktreeManager(repo);
  wm.setup(['coordinator', 'specifier', 'coder']);
  assert.ok(!fs.existsSync(path.join(repo, '.worktrees', 'coordinator')));
  assert.ok(!fs.existsSync(path.join(repo, '.worktrees', 'specifier')));
  assert.ok(fs.existsSync(path.join(repo, '.worktrees', 'coder')));
});

test('WorktreeManager list returns created worktrees', () => {
  const repo = mkGitRepo();
  const wm = new WorktreeManager(repo);
  wm.setup(['coder', 'cleaner']);
  const list = wm.list();
  assert.ok(list.some((w) => w.role === 'coder'));
  assert.ok(list.some((w) => w.role === 'cleaner'));
});

test('WorktreeManager teardown removes worktrees', () => {
  const repo = mkGitRepo();
  const wm = new WorktreeManager(repo);
  wm.setup(['coder']);
  wm.teardown();
  assert.ok(!fs.existsSync(path.join(repo, '.worktrees', 'coder')));
});

test('WorktreeManager getPath returns repo root for coordinator', () => {
  const repo = mkGitRepo();
  const wm = new WorktreeManager(repo);
  wm.setup(['coder']);
  assert.equal(wm.getPath('coordinator'), repo);
});

test('WorktreeManager setup reuses an existing registered worktree', () => {
  const repo = mkGitRepo();
  const wm1 = new WorktreeManager(repo);
  wm1.setup(['cleaner']);
  const wm2 = new WorktreeManager(repo);
  wm2.setup(['cleaner']);
  assert.equal(wm2.getPath('cleaner'), path.join(repo, '.worktrees', 'cleaner'));
  assert.ok(wm2.list().some((w) => w.role === 'cleaner'));
});
