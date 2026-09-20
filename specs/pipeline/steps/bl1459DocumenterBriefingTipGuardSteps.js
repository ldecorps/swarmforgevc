'use strict';

// BL-1459: step handlers for "A documenter briefing lands on main through
// a QA note, inside its lane, once per day".
//
// Drives the REAL check_documenter_briefing_tip.sh as a real subprocess
// against a real throwaway git repo (fixture root registered via
// trackedTmpRoot, BL-1636) - never a reimplementation of its lane or
// already-landed-day decision. Mirrors the shell suite's own
// mk_repo/write_commit shape (test_check_documenter_briefing_tip.sh),
// which exercises the same guard more exhaustively; this handler is the
// acceptance-level, Gherkin-readable layer.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_documenter_briefing_tip.sh');
const PRE_MERGE_COMMIT_HOOK = path.join(REPO_ROOT, 'swarmforge', 'git-hooks', 'pre-merge-commit');

const FEATURE = 'BL-1459 A documenter briefing lands on main through a QA note, inside its lane, once per day';

const DOC_BRANCH = 'swarmforge-documenter';
const THE_DATE = '2099-06-15';
const BRIEFING_PATH = `docs/briefings/${THE_DATE}.md`;

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function writeCommit(root, branch, files) {
  git(root, ['checkout', '-q', branch]);
  for (const [relPath, content] of files) {
    const full = path.join(root, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    git(root, ['add', relPath]);
  }
  git(root, ['commit', '-q', '-m', `change: ${files.map((f) => f[0]).join(' ')}`]);
}

function runGuard(root, args) {
  const result = spawnSync('bash', [GUARD, ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository with a landed main and a documenter branch$/, (ctx) => {
    const root = trackedTmpRoot('aps-bl1459-briefing-tip-');
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', 'user.email', 't@t']);
    git(root, ['config', 'user.name', 't']);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    git(root, ['branch', DOC_BRANCH, 'main']);
    ctx.bl1459 = { root };
  });

  scoped(/^a documenter commit that changes only the day's briefing file$/, (ctx) => {
    writeCommit(ctx.bl1459.root, DOC_BRANCH, [[BRIEFING_PATH, 'today\'s briefing']]);
    ctx.bl1459.tip = git(ctx.bl1459.root, ['rev-parse', 'HEAD']);
    git(ctx.bl1459.root, ['checkout', '-q', 'main']);
  });

  scoped(/^a documenter commit that changes the day's briefing file and (\S+)$/, (ctx, extraPath) => {
    writeCommit(ctx.bl1459.root, DOC_BRANCH, [
      [BRIEFING_PATH, 'today\'s briefing'],
      [extraPath, 'unrelated content'],
    ]);
    ctx.bl1459.tip = git(ctx.bl1459.root, ['rev-parse', 'HEAD']);
    ctx.bl1459.extraPath = extraPath;
    git(ctx.bl1459.root, ['checkout', '-q', 'main']);
  });

  scoped(/^the landed main already carries the day's briefing file$/, (ctx) => {
    writeCommit(ctx.bl1459.root, 'main', [[BRIEFING_PATH, 'the original briefing']]);
  });

  scoped(/^a documenter commit that writes a different version of it$/, (ctx) => {
    writeCommit(ctx.bl1459.root, DOC_BRANCH, [[BRIEFING_PATH, 'a completely different briefing']]);
    ctx.bl1459.tip = git(ctx.bl1459.root, ['rev-parse', 'HEAD']);
    git(ctx.bl1459.root, ['checkout', '-q', 'main']);
  });

  scoped(/^the guard judges that commit as a tip$/, (ctx) => {
    ctx.bl1459.result = runGuard(ctx.bl1459.root, ['--tip', ctx.bl1459.tip, '--branch', DOC_BRANCH]);
  });

  scoped(/^it prints DOCUMENTER_BRIEFING_TIP_OK$/, (ctx) => {
    const { status, stdout } = ctx.bl1459.result;
    assert.equal(status, 0, `expected exit 0, got ${status}: ${stdout}${ctx.bl1459.result.stderr}`);
    assert.match(stdout, /DOCUMENTER_BRIEFING_TIP_OK/);
  });

  scoped(/^it refuses naming (\S+)$/, (ctx, expectedPath) => {
    const { status, stdout, stderr } = ctx.bl1459.result;
    const combined = stdout + stderr;
    assert.equal(status, 1, `expected exit 1, got ${status}: ${combined}`);
    assert.match(combined, /DOCUMENTER_BRIEFING_TIP_REFUSED/);
    assert.ok(combined.includes(expectedPath), `expected the refusal to name ${expectedPath}, got: ${combined}`);
  });

  scoped(/^it refuses saying the day's briefing is already on main$/, (ctx) => {
    const { status, stdout, stderr } = ctx.bl1459.result;
    const combined = stdout + stderr;
    assert.equal(status, 1, `expected exit 1, got ${status}: ${combined}`);
    assert.ok(combined.includes(THE_DATE), `expected the refusal to name ${THE_DATE}, got: ${combined}`);
    assert.match(combined, /already on main/);
  });

  scoped(/^a merge whose incoming parent is not reachable from the documenter branch$/, (ctx) => {
    const root = ctx.bl1459.root;
    git(root, ['branch', 'other-role', 'main']);
    writeCommit(root, 'other-role', [['extension/src/other-thing.ts', 'unrelated']]);
    git(root, ['checkout', '-q', '-b', 'landing', 'main']);
    spawnSync('git', ['merge', '-q', '--no-ff', '--no-commit', 'other-role'], { cwd: root });
  });

  scoped(/^the guard runs in hook mode$/, (ctx) => {
    ctx.bl1459.result = runGuard(ctx.bl1459.root, ['--branch', DOC_BRANCH]);
    spawnSync('git', ['merge', '--abort'], { cwd: ctx.bl1459.root });
  });

  scoped(/^it exits 0 without judging$/, (ctx) => {
    assert.equal(ctx.bl1459.result.status, 0, `expected exit 0, got ${ctx.bl1459.result.status}: ${ctx.bl1459.result.stdout}${ctx.bl1459.result.stderr}`);
  });

  scoped(/^the pre-merge-commit hook chain is inspected$/, (ctx) => {
    ctx.bl1459 = ctx.bl1459 || {};
    ctx.bl1459.hookText = fs.readFileSync(PRE_MERGE_COMMIT_HOOK, 'utf8');
  });

  scoped(/^it runs the documenter briefing guard beside the art-director guard$/, (ctx) => {
    assert.match(ctx.bl1459.hookText, /run_guard check_art_director_tip\.sh/);
    assert.match(ctx.bl1459.hookText, /run_guard check_documenter_briefing_tip\.sh/);
  });
}

module.exports = { registerSteps };
