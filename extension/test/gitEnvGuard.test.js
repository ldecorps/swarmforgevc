const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { stripAmbientGitDirRedirect } = require('./helpers/gitEnvGuard');

// BL-1196: the pure strip must remove an inherited ambient GIT_DIR/
// GIT_WORK_TREE redirect so every test file's own local, unguarded
// `git(cwd, args)` helper resolves against the cwd it was given, not
// whatever repo those vars silently point at.

function git(cwd, args, env) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env }).trim();
}

test('stripAmbientGitDirRedirect deletes both GIT_DIR and GIT_WORK_TREE when set', () => {
  process.env.GIT_DIR = '/somewhere/.git';
  process.env.GIT_WORK_TREE = '/somewhere';
  try {
    stripAmbientGitDirRedirect();
    assert.equal('GIT_DIR' in process.env, false);
    assert.equal('GIT_WORK_TREE' in process.env, false);
  } finally {
    delete process.env.GIT_DIR;
    delete process.env.GIT_WORK_TREE;
  }
});

test('stripAmbientGitDirRedirect is a harmless no-op when neither var is set', () => {
  delete process.env.GIT_DIR;
  delete process.env.GIT_WORK_TREE;
  assert.doesNotThrow(() => stripAmbientGitDirRedirect());
  assert.equal('GIT_DIR' in process.env, false);
  assert.equal('GIT_WORK_TREE' in process.env, false);
});

test('stripAmbientGitDirRedirect deletes GIT_INDEX_FILE when set (BL-1196 amendment: index-redirect-stripped-03)', () => {
  process.env.GIT_INDEX_FILE = '/somewhere/.git/index';
  try {
    stripAmbientGitDirRedirect();
    assert.equal('GIT_INDEX_FILE' in process.env, false);
  } finally {
    delete process.env.GIT_INDEX_FILE;
  }
});

test('stripAmbientGitDirRedirect removes only GIT_DIR/GIT_WORK_TREE, leaving other env keys untouched', () => {
  process.env.GIT_DIR = '/somewhere/.git';
  process.env.BL1196_UNRELATED_KEY = 'kept';
  try {
    stripAmbientGitDirRedirect();
    assert.equal('GIT_DIR' in process.env, false);
    assert.equal(process.env.BL1196_UNRELATED_KEY, 'kept');
  } finally {
    delete process.env.GIT_DIR;
    delete process.env.BL1196_UNRELATED_KEY;
  }
});

// ── integration-shaped: a real ambient redirect, a real unguarded git() ────

test('BL-1196 qa_e2e step 2: a plain unguarded git() spawn honors cwd, not an ambient GIT_DIR pointing at a decoy repo, once stripped', () => {
  const decoy = mkTmpDir('sfvc-bl1196-decoy-');
  const target = mkTmpDir('sfvc-bl1196-target-');
  git(decoy, ['init', '-q']);
  git(target, ['init', '-q']);

  const ambientEnv = { ...process.env, GIT_DIR: path.join(decoy, '.git'), GIT_WORK_TREE: decoy };

  // Before the strip: the exact defect - an unguarded spawn silently obeys
  // the inherited ambient var over its own cwd.
  const beforeStripToplevel = git(target, ['rev-parse', '--show-toplevel'], ambientEnv);
  assert.equal(fs.realpathSync(beforeStripToplevel), fs.realpathSync(decoy), 'fixture precondition: an unstripped ambient redirect must actually redirect');

  const savedDir = process.env.GIT_DIR;
  const savedWorkTree = process.env.GIT_WORK_TREE;
  process.env.GIT_DIR = path.join(decoy, '.git');
  process.env.GIT_WORK_TREE = decoy;
  try {
    stripAmbientGitDirRedirect();
    // A plain, unguarded spawn with no explicit env - inherits process.env
    // exactly as every one of the ~60 local git() helpers does.
    const toplevel = git(target, ['rev-parse', '--show-toplevel']);
    assert.equal(fs.realpathSync(toplevel), fs.realpathSync(target));

    git(target, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'target-only commit']);
    const decoyLog = git(decoy, ['log', '--oneline', '--all']);
    assert.equal(decoyLog, '', 'the decoy must gain no commits from a spawn targeting a different cwd');
  } finally {
    if (savedDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = savedDir;
    if (savedWorkTree === undefined) delete process.env.GIT_WORK_TREE; else process.env.GIT_WORK_TREE = savedWorkTree;
  }
});
