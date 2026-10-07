'use strict';

// Scaffolded by scaffold_step_handler.js from specs/features/BL-1913-a-merge-of-origin-main-carries-a-deletion-origin-main-already-made.feature (BL-1979).
// Fill in each stub below - this header records where it began.
//
// Scenario 03 reuses BL-1872's lander fixture (exported as `fixture` from
// bl1872LanderDaemonSteps.js) and BL-1901's own `moveOrigin`-style shape -
// never imported from bl1901's file (its steps are defineScoped to ITS
// OWN feature, BL-425), so this file keeps its own scoped copies of
// anything it needs built the same way.
//
// The fixture sets no core.hooksPath, so the lander's own merge (made in
// .worktrees/lander, a worktree created on demand off the SAME fx.root
// repository - hooks are a repository-level setting, shared by every
// worktree of one repo) meets check_merge_deletion.sh only because this
// handler installs a commit-msg hook that runs the real script.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { fixture } = require('./bl1872LanderDaemonSteps');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const { makeFixture, git, queue, runSweep, entries } = fixture;

const FEATURE = "BL-1913 A merge of origin/main is not refused for a deletion that origin/main already made";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const MERGE_GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_merge_deletion.sh');

function st(ctx) {
  if (!ctx.bl1913) ctx.bl1913 = makeFixture();
  return ctx.bl1913;
}

// A minimal commit-msg hook that runs only the REAL check_merge_deletion.sh
// - this feature's own scope, never the full swarmforge/git-hooks chain
// (which would also pull in check_ticket_deletion.sh and friends, testing
// more than this ticket touches).
function installMergeGuardHook(fx) {
  const hooksDir = path.join(fx.work, 'bl1913-hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, 'commit-msg');
  fs.writeFileSync(hookPath, `#!/usr/bin/env bash\nexec bash ${JSON.stringify(MERGE_GUARD)} "$1"\n`, { mode: 0o755 });
  git(fx.root, 'config', 'core.hooksPath', hooksDir);
}

// Commits `relPath` to origin/main (via a throwaway detached worktree),
// pushes it, and returns the pushed sha - origin/main's own history
// gaining one commit, exactly how the lander's own `moveOrigin` works.
function commitToOriginMain(fx, subject, relPath, body) {
  const side = trackedTmpRoot('bl1913-side-');
  git(fx.root, 'worktree', 'add', '-q', '--detach', side, 'origin/main');
  const full = path.join(side, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  git(side, 'add', relPath);
  git(side, 'commit', '-q', '-m', subject);
  git(side, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  return git(side, 'rev-parse', 'HEAD');
}

// Deletes `relPath` on origin/main (via a throwaway detached worktree,
// cut from origin/main's CURRENT tip, so the file is already there to
// remove), pushes it.
function deleteFromOriginMain(fx, subject, relPath) {
  const side = trackedTmpRoot('bl1913-side-');
  git(fx.root, 'worktree', 'add', '-q', '--detach', side, 'origin/main');
  git(side, 'rm', '-q', relPath);
  git(side, 'commit', '-q', '-m', subject);
  git(side, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
}

function landLog(fx, ticket) {
  const e = entries(fx).find((x) => x.task === ticket);
  assert.ok(e, `no queue entry for ${ticket}: ${JSON.stringify(entries(fx))}`);
  const m = e.text.match(/:log "([^"]+)"/);
  return m && fs.existsSync(m[1]) ? fs.readFileSync(m[1], 'utf8') : '';
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(new RegExp("^a fixture project with a bare origin, the repository's commit hooks, and a line for BL-9001 cut from origin/main$"), (ctx) => {
    const fx = st(ctx);
    installMergeGuardHook(fx);
    // The actual checkout is deferred to the NEXT Given step - origin/main
    // must carry BL-9002's file BEFORE the line is cut, for the line to
    // genuinely "carry" it (the Background's own causal order), even
    // though this step's text is read first.
  });

  scoped(new RegExp('^origin/main carried a non-ticket file introduced by BL-9002 when the line was cut$'), (ctx) => {
    const fx = st(ctx);
    fx.filePath = 'specs/pipeline/steps/bl9002ExampleSteps.js';
    commitToOriginMain(fx, 'BL-9002: add an example step handler', fx.filePath, '// BL-9002\n');
    git(fx.line, 'fetch', '-q', 'origin');
    git(fx.line, 'checkout', '-q', '--detach', 'origin/main');
    fs.writeFileSync(path.join(fx.line, 'BL-9001.txt'), 'BL-9001\n');
    git(fx.line, 'add', 'BL-9001.txt');
    git(fx.line, 'commit', '-q', '-m', 'BL-9001: own work');
    fx.lineTip = git(fx.line, 'rev-parse', 'HEAD');
  });

  scoped(new RegExp('^origin/main has since deleted that file$'), (ctx) => {
    const fx = st(ctx);
    deleteFromOriginMain(fx, 'BL-9003: retire the example step handler', fx.filePath);
    git(fx.line, 'fetch', '-q', 'origin');
  });

  scoped(new RegExp('^the line merges origin/main with a message that names only BL-9001$'), (ctx) => {
    const fx = st(ctx);
    git(fx.line, 'checkout', '-q', '--detach', fx.lineTip);
    try {
      git(fx.line, 'merge', '--no-ff', '-m', 'BL-9001: merge origin/main', 'origin/main');
      fx.mergeExitCode = 0;
    } catch (err) {
      fx.mergeExitCode = err.status ?? 1;
      fx.mergeError = `${err.stdout || ''}${err.stderr || ''}`;
      git(fx.line, 'merge', '--abort');
    }
  });

  scoped(new RegExp('^the merge commits$'), (ctx) => {
    const fx = st(ctx);
    assert.equal(fx.mergeExitCode, 0, `expected the merge to commit, got: ${fx.mergeError}`);
  });

  scoped(new RegExp('^the merged tree does not carry that file$'), (ctx) => {
    const fx = st(ctx);
    let exists = true;
    try {
      git(fx.line, 'cat-file', '-e', `HEAD:${fx.filePath}`);
    } catch {
      exists = false;
    }
    assert.equal(exists, false, `expected ${fx.filePath} to be absent from the merged tree`);
  });

  scoped(new RegExp('^a branch that is not on origin/main has deleted that file$'), (ctx) => {
    const fx = st(ctx);
    git(fx.root, 'worktree', 'add', '-q', '-b', 'bl1913-off-origin', path.join(fx.work, 'off-origin'), fx.lineTip);
    const off = path.join(fx.work, 'off-origin');
    git(off, 'rm', '-q', fx.filePath);
    git(off, 'commit', '-q', '-m', 'a side branch that is not on origin/main, also deleting it');
    fx.offOriginTip = git(off, 'rev-parse', 'HEAD');
  });

  scoped(new RegExp('^the line merges that branch with a message that names only BL-9001$'), (ctx) => {
    const fx = st(ctx);
    git(fx.line, 'checkout', '-q', '--detach', fx.lineTip);
    try {
      git(fx.line, 'merge', '--no-ff', '-m', 'BL-9001: merge the side branch', fx.offOriginTip);
      fx.mergeExitCode = 0;
    } catch (err) {
      fx.mergeExitCode = err.status ?? 1;
      fx.mergeError = `${err.stdout || ''}${err.stderr || ''}`;
      git(fx.line, 'merge', '--abort');
    }
  });

  scoped(new RegExp('^the merge is refused naming that file and BL-9002$'), (ctx) => {
    const fx = st(ctx);
    assert.notEqual(fx.mergeExitCode, 0, 'expected the merge to be refused');
    assert.ok(fx.mergeError.includes(fx.filePath), `expected the refusal to name ${fx.filePath}, got: ${fx.mergeError}`);
    assert.ok(fx.mergeError.includes('BL-9002'), `expected the refusal to name BL-9002, got: ${fx.mergeError}`);
  });

  scoped(new RegExp('^the lander queue holds an entry for BL-9001 whose line carries only BL-9001 commits$'), (ctx) => {
    const fx = st(ctx);
    queue(fx, 'BL-9001', fx.lineTip);
  });

  scoped(new RegExp('^the lander sweep runs until the queue is empty$'), (ctx) => {
    runSweep(st(ctx));
  });

  scoped(new RegExp('^the land record for BL-9001 names the merge path$'), (ctx) => {
    const fx = st(ctx);
    const log = landLog(fx, 'BL-9001');
    assert.match(log, /^LAND_PATH merge$/m, log);
  });

  scoped(new RegExp('^origin/main does not carry that file$'), (ctx) => {
    const fx = st(ctx);
    let exists = true;
    try {
      git(fx.origin, 'cat-file', '-e', `main:${fx.filePath}`);
    } catch {
      exists = false;
    }
    assert.equal(exists, false, `expected ${fx.filePath} to be absent from origin/main, got log: ${landLog(fx, 'BL-9001')}`);
  });
}

module.exports = { registerSteps };
