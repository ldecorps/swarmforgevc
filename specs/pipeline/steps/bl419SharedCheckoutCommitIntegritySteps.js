'use strict';

// BL-419: step handlers for "a commit on the shared master checkout
// carries the caller's own staged content". Drives the REAL
// commit_integrity_lib.bb (production commit_integrity_cli.bb for
// scenario 01, the commit_integrity_test_cli.bb seam for scenarios 02/03)
// against a REAL git fixture repo - no mocked git, since the whole point
// of this ticket is real git index/commit behavior. Per the ticket's own
// Testability note the race itself is timing-dependent and must never be
// driven with a sleep/poll test: scenario 02/03's "does not match what
// was staged" is reproduced deterministically by having the test seam's
// commit step genuinely commit corrupted content for its leading N
// attempts (real git throughout, no real concurrency, no faked
// observation).
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const CLI = path.join(SWARMFORGE_SCRIPTS, 'commit_integrity_cli.bb');
const TEST_CLI = path.join(SWARMFORGE_SCRIPTS, 'test', 'commit_integrity_test_cli.bb');

function mkGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl419-acceptance-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init', '--allow-empty'], { cwd: dir });
  return dir;
}

function runProductionCli(repo, message, relPath) {
  try {
    const out = execFileSync('bb', [CLI, repo, '--message', message, '--path', relPath], { encoding: 'utf8' });
    return { exitCode: 0, json: JSON.parse(out.trim().split('\n').pop()) };
  } catch (err) {
    const out = (err.stdout || '') + (err.stderr || '');
    const lastJsonLine = out.trim().split('\n').reverse().find((line) => line.startsWith('{'));
    return { exitCode: err.status ?? 1, json: lastJsonLine ? JSON.parse(lastJsonLine) : null, raw: out };
  }
}

function runTestSeamCli(repo, message, relPath, corruptCommits) {
  const env = { ...process.env, COMMIT_INTEGRITY_TEST_CORRUPT_COMMITS: String(corruptCommits) };
  try {
    const out = execFileSync('bb', [TEST_CLI, repo, message, relPath], { encoding: 'utf8', env });
    return { exitCode: 0, json: JSON.parse(out.trim()) };
  } catch (err) {
    const out = (err.stdout || '') + (err.stderr || '');
    return { exitCode: err.status ?? 1, json: JSON.parse(out.trim()) };
  }
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────
  registry.define(/^a writer staging an edit to a path in the shared master checkout$/, (ctx) => {
    ctx.repo = mkGitRepo();
    ctx.relPath = 'approval.yaml';
    ctx.stagedContent = 'human_approval: approved';
    ctx.message = 'Approve BL-000';
    fs.writeFileSync(path.join(ctx.repo, ctx.relPath), ctx.stagedContent);
  });

  // ── shared-checkout-commit-integrity-01 ─────────────────────────────
  registry.define(/^another process commits an unrelated path during the stage-to-commit window$/, (ctx) => {
    const unrelatedPath = 'unrelated.yaml';
    fs.writeFileSync(path.join(ctx.repo, unrelatedPath), 'some: other-content');
    execFileSync('git', ['add', '--', unrelatedPath], { cwd: ctx.repo });
    execFileSync('git', ['commit', '-q', '-m', 'unrelated concurrent commit', '--', unrelatedPath], { cwd: ctx.repo });
  });

  registry.define(/^the writer commits its staged edit$/, (ctx) => {
    ctx.result = runProductionCli(ctx.repo, ctx.message, ctx.relPath);
    assert.equal(ctx.result.exitCode, 0, `expected the writer's own commit to succeed, got: ${JSON.stringify(ctx.result)}`);
  });

  registry.define(/^git show of the new commit for the writer's path matches the staged content$/, (ctx) => {
    const sha = ctx.result.json.sha;
    assert.ok(sha, `expected a sha in the result, got: ${JSON.stringify(ctx.result)}`);
    const shown = execFileSync('git', ['show', `${sha}:${ctx.relPath}`], { cwd: ctx.repo, encoding: 'utf8' });
    assert.equal(shown, ctx.stagedContent, `expected the committed content to match what was staged, got: ${JSON.stringify(shown)}`);
  });

  // ── shared-checkout-commit-integrity-02 ─────────────────────────────
  registry.define(/^the committed content for the writer's path does not match what was staged$/, (ctx) => {
    // Narrative only - the actual corruption is driven deterministically
    // by the test seam CLI in the When step below (COMMIT_INTEGRITY_TEST_CORRUPT_COMMITS=1),
    // which genuinely commits wrong content for exactly the first attempt.
    ctx.corruptCommits = 1;
  });

  registry.define(/^the writer verifies its commit$/, (ctx) => {
    ctx.result = runTestSeamCli(ctx.repo, ctx.message, ctx.relPath, ctx.corruptCommits);
  });

  registry.define(/^it re-stages and re-commits within a bounded retry budget$/, (ctx) => {
    assert.equal(ctx.result.exitCode, 0, `expected the retried commit to ultimately succeed, got: ${JSON.stringify(ctx.result)}`);
    assert.equal(ctx.result.json.success, true, `expected success:true after the retry, got: ${JSON.stringify(ctx.result.json)}`);
    assert.equal(ctx.result.json.attempts, 2, `expected exactly one retry (2 total attempts), got: ${JSON.stringify(ctx.result.json)}`);
    assert.equal(ctx.result.json.commitCalls, 2, `expected a fresh commit on the retry (not an amend), got: ${JSON.stringify(ctx.result.json)}`);
    const sha = ctx.result.json.sha;
    const shown = execFileSync('git', ['show', `${sha}:${ctx.relPath}`], { cwd: ctx.repo, encoding: 'utf8' });
    assert.equal(shown, ctx.stagedContent, `expected the FINAL committed content to match what was staged, got: ${JSON.stringify(shown)}`);
  });

  // ── shared-checkout-commit-integrity-03 ─────────────────────────────
  registry.define(/^the committed content still does not match after the retry budget is exhausted$/, (ctx) => {
    // Every attempt lands corrupted (a huge corrupt-commits budget), so the
    // retry cap is guaranteed to be exhausted regardless of its exact value.
    ctx.corruptCommits = 99;
  });

  registry.define(/^the writer finishes$/, (ctx) => {
    ctx.result = runTestSeamCli(ctx.repo, ctx.message, ctx.relPath, ctx.corruptCommits);
  });

  registry.define(/^it surfaces the failure with a non-zero result and does not report the commit as successful$/, (ctx) => {
    assert.notEqual(ctx.result.exitCode, 0, `expected a non-zero result when the retry budget is exhausted, got: ${JSON.stringify(ctx.result)}`);
    assert.equal(ctx.result.json.success, false, `expected success:false, got: ${JSON.stringify(ctx.result.json)}`);
    assert.equal(ctx.result.json.reason, 'verify-mismatch', `expected reason verify-mismatch, got: ${JSON.stringify(ctx.result.json)}`);
    assert.ok(ctx.result.json.attempts > 1, `expected more than one attempt was made before giving up, got: ${JSON.stringify(ctx.result.json)}`);
  });
}

module.exports = { registerSteps };
