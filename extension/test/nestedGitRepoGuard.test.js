'use strict';

// BL-1039-EXEMPT: the behavior under test IS ad hoc nested `git init` calls
// (BL-1230's whole subject is catching an unexpected nested repository); the
// shared seeded fixture is a single pinned repo shape and cannot stand in for
// the varying nested/non-nested layouts each scenario here builds.
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

// A leaked repository's own internals are not walked - the walk must stop
// at the `.git` boundary rather than falling through to the generic
// isDirectory() recursion. Not descending never produces a SECOND
// violation on its own (a real repo's internals rarely contain a literal
// `.git`-named directory), so this plants one by hand: a mutant that drops
// the `continue` after handling a `.git` entry reports BOTH the outer leak
// and this planted inner one; the correct code reports only the outer one.
test('BL-1230: a leaked repository\'s own internals are never walked', () => {
  const root = mkTmpDir('bl1230-nodescend-');
  gitInit(root);
  gitInit(path.join(root, 'backlog'));
  fs.mkdirSync(path.join(root, 'backlog', '.git', 'modules', 'x', '.git'), { recursive: true });
  const violations = findNestedGitRepositories(root);
  assert.deepEqual(violations.map((v) => v.path), ['backlog/.git']);
});

test('BL-1230: an unreadable directory does not crash the walk', () => {
  const root = mkTmpDir('bl1230-unreadable-');
  gitInit(root);
  const locked = path.join(root, 'locked');
  fs.mkdirSync(locked);
  const realReaddir = fs.readdirSync;
  const readdir = (dir, opts) => {
    if (dir === locked) {
      const err = new Error('EACCES: permission denied');
      err.code = 'EACCES';
      throw err;
    }
    return realReaddir(dir, opts);
  };
  assert.deepEqual(findNestedGitRepositories(root, { readdir }), []);
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

// ── BL-1246: a repository inside a git-ignored directory is not a leak ───
//
// Human ruling 2026-08-28, "Exempt git-ignored dirs (tmp/) by construction".
// These fixtures build a REAL repository with a REAL .gitignore, because the
// exemption is derived from git's own answer - a fixture that stubbed the
// predicate would prove only that the seam is wired, not that git agrees.

function writeIgnore(root, lines) {
  fs.writeFileSync(path.join(root, '.gitignore'), `${lines.join('\n')}\n`);
}

test('BL-1246: a repository inside a git-ignored directory is not reported', () => {
  const root = mkTmpDir('bl1246-ignored-');
  gitInit(root);
  writeIgnore(root, ['/tmp/']);
  gitInit(path.join(root, 'tmp', 'evilmerge'));
  assert.deepEqual(findNestedGitRepositories(root), []);
});

test('BL-1246: a repository in a TRACKED directory is still reported, unchanged', () => {
  const root = mkTmpDir('bl1246-tracked-');
  gitInit(root);
  writeIgnore(root, ['/tmp/']);
  gitInit(path.join(root, 'backlog'));
  const violations = findNestedGitRepositories(root);
  assert.deepEqual(violations.map((v) => v.path), ['backlog/.git']);
});

test('BL-1246: the exemption does not silence a real leak beside it', () => {
  const root = mkTmpDir('bl1246-both-');
  gitInit(root);
  writeIgnore(root, ['/tmp/']);
  gitInit(path.join(root, 'tmp', 'evilmerge'));
  gitInit(path.join(root, 'backlog'));
  const violations = findNestedGitRepositories(root);
  assert.deepEqual(violations.map((v) => v.path), ['backlog/.git']);
});

test('BL-1246: the exemption follows git, not a name - an unignored tmp/ is still reported', () => {
  const root = mkTmpDir('bl1246-name-');
  gitInit(root);
  writeIgnore(root, ['/build/']);
  gitInit(path.join(root, 'tmp', 'evilmerge'));
  const violations = findNestedGitRepositories(root);
  assert.deepEqual(
    violations.map((v) => v.path),
    ['tmp/evilmerge/.git'],
    'the exemption must come from git ignoring the directory, never from it being called tmp/'
  );
});

test('BL-1246: any ignored directory is exempt, not a hardcoded tmp/', () => {
  const root = mkTmpDir('bl1246-any-');
  gitInit(root);
  writeIgnore(root, ['/scratchpad/']);
  gitInit(path.join(root, 'scratchpad', 'fixture'));
  assert.deepEqual(findNestedGitRepositories(root), []);
});

test('BL-1246: an ignored directory nested deep inside a tracked one is exempt', () => {
  const root = mkTmpDir('bl1246-deep-');
  gitInit(root);
  writeIgnore(root, ['extension/coverage/']);
  gitInit(path.join(root, 'extension', 'coverage', 'fixture'));
  assert.deepEqual(findNestedGitRepositories(root), []);
});

test('BL-1246: an unanswerable ignore question never exempts', () => {
  // Not a repository at all, so `git check-ignore` cannot answer. Fail
  // closed: an unanswered question must not silence a leak.
  const root = mkTmpDir('bl1246-norepo-');
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  gitInit(path.join(root, 'tmp', 'evilmerge'));
  const violations = findNestedGitRepositories(root);
  assert.deepEqual(violations.map((v) => v.path), ['tmp/evilmerge/.git']);
});

test('BL-1246: gitIgnoresDirectory asks about the containing directory', () => {
  const { gitIgnoresDirectory } = require('./helpers/nestedGitRepoGuard');
  const root = mkTmpDir('bl1246-predicate-');
  gitInit(root);
  writeIgnore(root, ['/tmp/']);
  fs.mkdirSync(path.join(root, 'tmp', 'evilmerge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  assert.equal(gitIgnoresDirectory(root, path.join(root, 'tmp', 'evilmerge')), true);
  assert.equal(gitIgnoresDirectory(root, path.join(root, 'src')), false);
  // The working tree root is never "ignored", whatever the rules say, and a
  // path outside the tree is not this tree's question to answer.
  assert.equal(gitIgnoresDirectory(root, root), false);
  assert.equal(gitIgnoresDirectory(root, path.dirname(root)), false);
});

test('BL-1246: the predicate is answered for a directory, not for the .git inside it', () => {
  // The ticket's "How" says git never considers a `.git` path against ignore
  // rules. Measured on git 2.x here that is NOT reproducible - under a rule
  // that ignores the parent, `check-ignore tmp/evilmerge/.git` answers
  // ignored too. The guard still asks about the CONTAINING directory, which
  // is the right question independently of that: it is the thing being
  // exempted, and it stays correct on a git that does refuse to answer for
  // `.git` paths. This test pins the behaviour the guard actually relies on
  // rather than the rationale.
  const { gitIgnoresDirectory } = require('./helpers/nestedGitRepoGuard');
  const root = mkTmpDir('bl1246-ask-');
  gitInit(root);
  writeIgnore(root, ['/tmp/']);
  fs.mkdirSync(path.join(root, 'tmp', 'evilmerge'), { recursive: true });
  assert.equal(gitIgnoresDirectory(root, path.join(root, 'tmp', 'evilmerge')), true);
});
