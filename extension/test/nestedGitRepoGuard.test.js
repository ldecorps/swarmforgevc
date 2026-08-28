'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { findNestedGitRepositories } = require('./helpers/nestedGitRepoGuard');

function gitInit(dir) {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
}

test('BL-1230: a git repository nested in a tracked directory is reported', () => {
  const root = mkTmpDir('bl1230-leak-');
  gitInit(root); // the root's own repo - not a leak
  gitInit(path.join(root, 'backlog'));
  const violations = findNestedGitRepositories(root);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, 'backlog/.git');
});

test('BL-1230: the report explains a git command redirects there', () => {
  const root = mkTmpDir('bl1230-explain-');
  gitInit(root);
  gitInit(path.join(root, 'backlog'));
  const [violation] = findNestedGitRepositories(root);
  assert.match(violation.reason, /resolves to this nested repository/);
});

test('BL-1230: the working tree\'s own root .git is not reported', () => {
  const root = mkTmpDir('bl1230-ownroot-');
  gitInit(root);
  assert.deepEqual(findNestedGitRepositories(root), []);
});

test('BL-1230: a worktree gitfile (.git as a FILE, not a directory) is not reported', () => {
  const root = mkTmpDir('bl1230-worktreefile-');
  gitInit(root);
  const worktreeDir = path.join(root, '.worktrees', 'coder');
  fs.mkdirSync(worktreeDir, { recursive: true });
  fs.writeFileSync(path.join(worktreeDir, '.git'), 'gitdir: /elsewhere/.git/worktrees/coder\n');
  assert.deepEqual(findNestedGitRepositories(root), []);
});

test('BL-1230: the guard never descends into .worktrees/ at all (cost must not scale with worktree count)', () => {
  const root = mkTmpDir('bl1230-worktreesdir-');
  gitInit(root);
  // Even a leak WITHIN a linked worktree's own subtree (not just its
  // gitfile) is out of scope here - that worktree's own copy of this guard
  // is what covers it.
  gitInit(path.join(root, '.worktrees', 'coder', 'backlog'));
  assert.deepEqual(findNestedGitRepositories(root), []);
});

test('BL-1230: a repository nested under node_modules is not reported', () => {
  const root = mkTmpDir('bl1230-nodemodules-');
  gitInit(root);
  gitInit(path.join(root, 'extension', 'node_modules', 'some-pkg'));
  assert.deepEqual(findNestedGitRepositories(root), []);
});

test('BL-1230: the check reports without removing anything', () => {
  const root = mkTmpDir('bl1230-noremoval-');
  gitInit(root);
  const leaked = path.join(root, 'backlog', '.git');
  gitInit(path.join(root, 'backlog'));
  findNestedGitRepositories(root);
  assert.ok(fs.existsSync(leaked), 'the leaked repository must still exist after the check runs');
});

test('BL-1230: a clean working tree reports nothing', () => {
  const root = mkTmpDir('bl1230-clean-');
  gitInit(root);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-1-x.yaml'), 'id: BL-1\n');
  assert.deepEqual(findNestedGitRepositories(root), []);
});

// BL-1230's whole reason for existing: `git status` cannot see a leaked
// nested repository at all - not tracked, not untracked, git simply never
// considers it. This guard must still catch it.
test('BL-1230: a leaked repository is caught even though `git status` reports the tree clean', () => {
  const root = mkTmpDir('bl1230-gitstatusclean-');
  gitInit(root);
  // The real incident's git status stayed clean because backlog/*.yaml was
  // ALREADY tracked before the nested repo appeared - reproduce that order:
  // track backlog/'s contents first, only then git-init inside it.
  fs.mkdirSync(path.join(root, 'backlog'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'BL-1-x.yaml'), 'id: BL-1\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed'], { cwd: root });
  gitInit(path.join(root, 'backlog'));

  const status = execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' });
  assert.equal(status.trim(), '', 'the fixture must reproduce git status reading clean despite the leak');

  const violations = findNestedGitRepositories(root);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, 'backlog/.git');
});

test('BL-1230: multiple leaks are each reported independently', () => {
  const root = mkTmpDir('bl1230-multi-');
  gitInit(root);
  gitInit(path.join(root, 'backlog'));
  gitInit(path.join(root, 'docs'));
  const violations = findNestedGitRepositories(root).map((v) => v.path).sort();
  assert.deepEqual(violations, ['backlog/.git', 'docs/.git']);
});

test('BL-1230: an unreadable directory does not crash the walk', () => {
  const root = mkTmpDir('bl1230-unreadable-');
  gitInit(root);
  const locked = path.join(root, 'locked');
  fs.mkdirSync(locked);
  fs.chmodSync(locked, 0o000);
  try {
    assert.deepEqual(findNestedGitRepositories(root), []);
  } finally {
    fs.chmodSync(locked, 0o755);
  }
});

// BL-1038-EXEMPT: proves the guard against the real repository (readdirSync
// over the live tree, skipping node_modules) - the standing call site this
// check exists to have; scoped to a single bounded walk, not history/size
// beyond directory enumeration.
test('BL-1230: the real repository has no unexplained nested git repository', () => {
  const root = path.join(__dirname, '..', '..');
  const violations = findNestedGitRepositories(root);
  assert.deepEqual(
    violations,
    [],
    'every nested .git directory must be explained (worktree gitfile or node_modules) or removed by a human:\n' +
      violations.map((v) => `  ${v.path}: ${v.reason}`).join('\n')
  );
});
