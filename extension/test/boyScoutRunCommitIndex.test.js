const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');
const { boyScoutRun, commitEdits, defaultEnvironment } = require('../out/tools/boyScoutRun');
const { defaultGateSpawn } = require('../out/tools/boyScoutRun/gates');

// BL-1015 architect send-back #1, D1. Invariant 1 says a cleanup is "refused
// whole - never partially applied and never committed". The rest of this
// ticket's suite proves that over FILE CONTENT, against an injected mock
// environment that has no git index at all. A commit that fails after its
// `git add` has already run diverges the INDEX from the working tree, and no
// amount of rewriting file contents puts that back.
//
// These tests therefore use a real temp git repository and read `git status
// --porcelain`, which reports both columns - staged and unstaged. Nothing
// here asserts over the argv the code built; the repository either came back
// to the state it was in or it did not.

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function status(repo) {
  return git(repo, ['status', '--porcelain'])
    .split('\n')
    .filter((line) => line.length > 0)
    .sort();
}

function write(repo, relPath, content) {
  const abs = path.join(repo, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

// A pre-commit hook that refuses is the ticket's own named example of a
// commit failing AFTER staging has happened - and it is a real one, not a
// stubbed error thrown from a mock.
function installRefusingPreCommitHook(repo) {
  const hook = path.join(repo, '.git', 'hooks', 'pre-commit');
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, '#!/bin/sh\necho "pre-commit hook refused"\nexit 1\n', { mode: 0o755 });
}

function repoWithCommittedFile() {
  const repo = mkTmpDir('sfvc-bl1015-index-');
  copySeededRepoInto(repo);
  write(repo, 'src/a.ts', 'old\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'seed']);
  return repo;
}

test('BL-1015 D1: a commit that fails leaves nothing of this run staged - an edited file', () => {
  const repo = repoWithCommittedFile();
  installRefusingPreCommitHook(repo);
  write(repo, 'src/a.ts', 'new\n');

  assert.throws(() => commitEdits(repo, 'BL-1015 boy scout: tidy', ['src/a.ts'], defaultGateSpawn), /git commit failed/);

  // ' M' - modified in the working tree, NOTHING staged. 'MM' or 'M ' would
  // mean the failed commit left its own staging behind.
  assert.deepEqual(status(repo), [' M src/a.ts']);
});

test('BL-1015 D1: a commit that fails leaves nothing of this run staged - a file the cleanup created', () => {
  const repo = repoWithCommittedFile();
  installRefusingPreCommitHook(repo);
  write(repo, 'src/new.ts', 'brand new\n');

  assert.throws(() => commitEdits(repo, 'BL-1015 boy scout: tidy', ['src/new.ts'], defaultGateSpawn), /git commit failed/);

  // '??' - untracked, as it was before the run touched the index. 'A ' would
  // be the added-in-index/deleted-in-tree state the send-back reproduced.
  assert.deepEqual(status(repo), ['?? src/new.ts']);
});

test('BL-1015 D1: a run whose commit fails leaves the repository byte-for-byte and index-for-index as it found it', () => {
  const repo = repoWithCommittedFile();
  installRefusingPreCommitHook(repo);
  assert.deepEqual(status(repo), [], 'the fixture did not start clean');

  const env = {
    ...defaultEnvironment,
    scanRepository: () => ({ ranked: [{ subject: 'src/a.ts', score: 3 }] }),
    propose: () => ({
      subject: 'src/a.ts',
      summary: 'tidy',
      edits: [
        { path: 'src/a.ts', after: 'new\n' },
        { path: 'src/new.ts', after: 'brand new\n' },
      ],
    }),
    runGates: () => ({ passed: true, ran: ['unit'], failed: [], output: '' }),
  };

  assert.throws(() => boyScoutRun(repo, env), /git commit failed/);

  // Not merely "the file contents are back": the index has to be back too, or
  // the repository is in a state that is neither as-it-was nor committed.
  assert.deepEqual(status(repo), []);
  assert.equal(fs.readFileSync(path.join(repo, 'src', 'a.ts'), 'utf8'), 'old\n');
  assert.equal(fs.existsSync(path.join(repo, 'src', 'new.ts')), false);
});

test('BL-1015 D1: a commit that succeeds still commits exactly this run\'s paths and leaves other staged work alone', () => {
  const repo = repoWithCommittedFile();
  write(repo, 'src/a.ts', 'new\n');
  write(repo, 'src/new.ts', 'brand new\n');
  // Unrelated work the operator had already staged. A partial commit through a
  // temporary index must leave it staged and uncommitted - the fix for D1 must
  // not turn into a `git reset` that throws it away either.
  write(repo, 'src/unrelated.ts', 'theirs\n');
  git(repo, ['add', '--', 'src/unrelated.ts']);

  commitEdits(repo, 'BL-1015 boy scout: tidy', ['src/a.ts', 'src/new.ts'], defaultGateSpawn);

  assert.deepEqual(status(repo), ['A  src/unrelated.ts']);
  const committed = git(repo, ['show', '--name-only', '--format=', 'HEAD'])
    .split('\n')
    .filter(Boolean)
    .sort();
  assert.deepEqual(committed, ['src/a.ts', 'src/new.ts']);
});
