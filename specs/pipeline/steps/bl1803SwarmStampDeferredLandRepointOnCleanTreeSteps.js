'use strict';

// BL-1803: step handlers for the review-only stamp of hotfix 4183cd29ca
// (BL-848). All three scenarios drive the REAL land_step_lib.bb
// (post-land-repoint!/try-pending-land-repoint!) and the REAL
// land_step_cli.bb `try-repoint` verb against fixture repositories built
// under mkdtemp - the exact same fixture shape
// land_step_lib_test_runner.bb's own scenarios already use, never a
// reimplementation. This is a REVIEW ticket: nothing here edits
// land_step_lib.bb, land_step_cli.bb, done_with_current_task.bb or
// .gitignore (the ticket's own FIRM invariant).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1803 swarm stamp - a skipped post-land re-point is retried on a clean tree (hotfix 4183cd29ca)';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');
const LAND_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function excludeSwarmforge(root) {
  const excludeFile = path.join(root, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
  const existing = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
  if (!existing.includes('.swarmforge/')) {
    fs.appendFileSync(excludeFile, '\n.swarmforge/\n');
  }
}

function markOriginMain(root) {
  git(root, ['update-ref', 'refs/remotes/origin/main', git(root, ['rev-parse', 'HEAD'])]);
}

function commitFile(root, rel, content, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
}

// post-land-repoint!/try-pending-land-repoint! are driven via `bb -e`
// (load-file, then call), the SAME two functions land_step_cli.bb itself
// calls - never a reimplementation.
function callBb(script) {
  const result = spawnSync('bb', ['-e', script], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function postLandRepoint(root, landedTaskTicketId) {
  const opts = landedTaskTicketId ? `{:root "${root}" :landed-task-ticket-id "${landedTaskTicketId}"}` : `{:root "${root}"}`;
  const r = callBb(`
(load-file "${LAND_LIB}")
(require '[cheshire.core :as json])
(println (json/generate-string (land-step-lib/post-land-repoint! ${opts})))
`);
  assert.equal(r.status, 0, `post-land-repoint! failed: ${r.stdout}${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

function readPending(root) {
  const r = callBb(`
(load-file "${LAND_LIB}")
(require '[cheshire.core :as json])
(println (json/generate-string (land-step-lib/read-pending-land-repoint "${root}")))
`);
  assert.equal(r.status, 0, `read-pending-land-repoint failed: ${r.stdout}${r.stderr}`);
  const parsed = JSON.parse(r.stdout.trim().split('\n').pop());
  return parsed;
}

function pendingFilePath(root) {
  return path.join(root, '.swarmforge', 'daemon', 'pending-land-repoint.json');
}

function runTryRepoint(root) {
  const result = spawnSync('bb', [CLI, 'try-repoint', root], { encoding: 'utf8' });
  assert.equal(result.status, 0, `land_step_cli.bb try-repoint exited ${result.status}: ${result.stdout}${result.stderr}`);
  return result.stdout.trim();
}

function mkFixtureRoot() {
  const root = trackedTmpRoot('bl1803-land-repoint-');
  git(root, ['init', '-q', '-b', 'main', '.']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'seed']);
  return root;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a fixture repository whose \.swarmforge directory is gitignored and whose origin\/main is marked at the current tip$/, (ctx) => {
    const root = mkFixtureRoot();
    excludeSwarmforge(root);
    markOriginMain(root);
    ctx.root = root;
    ctx.originMain = git(root, ['rev-parse', 'HEAD']);
  });

  // ── Scenario 01 ─────────────────────────────────────────────────────
  scoped(/^the tip is ahead of origin\/main and the worktree holds an uncommitted change$/, (ctx) => {
    commitFile(ctx.root, 'ahead.txt', 'ahead\n', 'BL-9001: ahead of origin/main');
    ctx.oldTip = git(ctx.root, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(ctx.root, 'dirty.txt'), 'uncommitted\n');
  });

  scoped(/^post-land-repoint! runs for landed ticket BL-9001$/, (ctx) => {
    ctx.result = postLandRepoint(ctx.root, 'BL-9001');
  });

  scoped(/^it skips naming an uncommitted change$/, (ctx) => {
    assert.equal(ctx.result.action, 'skipped', `expected a skip, got: ${JSON.stringify(ctx.result)}`);
    assert.equal(ctx.result.reason, 'an uncommitted change', `expected the reason "an uncommitted change", got: ${JSON.stringify(ctx.result)}`);
  });

  scoped(/^pending-land-repoint\.json names BL-9001 and that reason$/, (ctx) => {
    const pending = readPending(ctx.root);
    assert.ok(pending, `expected a pending record, got: ${JSON.stringify(pending)}`);
    assert.equal(pending['landed-task-ticket-id'], 'BL-9001', `expected landed-task-ticket-id BL-9001, got: ${JSON.stringify(pending)}`);
    assert.equal(pending.reason, 'an uncommitted change', `expected reason "an uncommitted change", got: ${JSON.stringify(pending)}`);
  });

  // ── Scenario 02 ─────────────────────────────────────────────────────
  scoped(/^a pending re-point was armed because of an uncommitted change on a tip ahead of origin\/main$/, (ctx) => {
    commitFile(ctx.root, 'ahead.txt', 'ahead\n', 'BL-9001: ahead of origin/main');
    ctx.oldTip = git(ctx.root, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(ctx.root, 'dirty.txt'), 'uncommitted\n');
    const skip = postLandRepoint(ctx.root, 'BL-9001');
    assert.equal(skip.action, 'skipped', `setup: expected the dirty tip to skip, got: ${JSON.stringify(skip)}`);
  });

  scoped(/^that uncommitted change has been removed$/, (ctx) => {
    fs.rmSync(path.join(ctx.root, 'dirty.txt'));
  });

  scoped(/^land_step_cli\.bb try-repoint runs$/, (ctx) => {
    ctx.tryRepointOutput = runTryRepoint(ctx.root);
  });

  scoped(/^it prints LAND_REPOINTED with the old tip and the new tip$/, (ctx) => {
    assert.match(ctx.tryRepointOutput, /^LAND_REPOINTED /, `expected a LAND_REPOINTED line, got: ${ctx.tryRepointOutput}`);
    assert.ok(ctx.tryRepointOutput.includes(ctx.oldTip), `expected the old tip ${ctx.oldTip} in: ${ctx.tryRepointOutput}`);
    assert.ok(ctx.tryRepointOutput.includes(ctx.originMain), `expected the new tip ${ctx.originMain} in: ${ctx.tryRepointOutput}`);
  });

  scoped(/^the branch tip equals origin\/main$/, (ctx) => {
    const head = git(ctx.root, ['rev-parse', 'HEAD']);
    assert.equal(head, ctx.originMain, `expected HEAD at origin/main (${ctx.originMain}), got ${head}`);
  });

  scoped(/^the pending re-point file is gone$/, (ctx) => {
    assert.ok(!fs.existsSync(pendingFilePath(ctx.root)), 'expected pending-land-repoint.json to be gone');
  });

  // ── Scenario 03 ─────────────────────────────────────────────────────
  scoped(/^no pending-land-repoint\.json exists$/, (ctx) => {
    assert.ok(!fs.existsSync(pendingFilePath(ctx.root)), 'setup: expected no pending file at the start of this scenario');
  });

  scoped(/^it prints LAND_REPOINT_IDLE and exits 0$/, (ctx) => {
    assert.match(ctx.tryRepointOutput, /^LAND_REPOINT_IDLE/, `expected LAND_REPOINT_IDLE, got: ${ctx.tryRepointOutput}`);
  });
}

module.exports = { registerSteps };
