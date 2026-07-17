'use strict';

// BL-477: step handlers for "the upstream drift-watch check". Drives the
// REAL swarmforge/scripts/upstream_drift_check.bb CLI end to end, including
// its real `git ls-remote --heads` adapter, against a REAL local git repo
// this file creates for "upstream" - `git ls-remote` works against a plain
// filesystem path with no network involved at all, so nothing here is
// faked or stubbed (mirrors mergedCodeReachesDaemonsSteps.js's own "real
// local git repo, real git commands" posture, and
// swarmforge/scripts/test/test_upstream_drift_check_cli.sh's identical
// technique). The pure comparator and the adapter-injected run!
// orchestration are already exhaustively unit-tested in-process by
// upstream_drift_check_lib_test_runner.bb; this file is the acceptance
// layer BL-112 requires on top of that, never a replacement for it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'upstream_drift_check.bb');

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function mkUpstreamRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-upstream-drift-'));
  // -b main: this box's git default-branch config may not be "main" - every
  // scenario below names its recorded branch "main" explicitly.
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return root;
}

function writeWatchFile(ctx) {
  fs.writeFileSync(ctx.watchPath, JSON.stringify({ repos: ctx.repos }, null, 2));
}

function runDriftCheck(ctx) {
  const lockPath = path.join(REPO_ROOT, 'swarmforge.lock.json');
  ctx.lockJsonBefore = fs.readFileSync(lockPath, 'utf8');
  const result = spawnSync('bb', [CLI, ctx.watchPath], { encoding: 'utf8' });
  ctx.stdout = result.stdout || '';
  ctx.stderr = result.stderr || '';
  ctx.exitCode = result.status;
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────────
  registry.define(/^a watch file recording, per upstream repo and branch, the last-reviewed commit SHA$/, (ctx) => {
    ctx.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-upstream-drift-watch-'));
    ctx.watchPath = path.join(ctx.tmpDir, 'upstream-watch.json');
    ctx.upstreamRepo = mkUpstreamRepo();
    ctx.repos = { 'swarm-forge': { url: ctx.upstreamRepo, branches: {} } };
  });

  // ── upstream-drift-watch-01/02/04 shared Given ───────────────────────────
  registry.define(/^the watch file records upstream "([^"]+)" branch "([^"]+)" at a recorded SHA$/, (ctx, repo, branch) => {
    ctx.recordedSha = git(ctx.upstreamRepo, ['rev-parse', 'HEAD']);
    ctx.repos[repo].branches[branch] = ctx.recordedSha;
    writeWatchFile(ctx);
    ctx.watchBytesBefore = fs.readFileSync(ctx.watchPath);
  });

  // ── upstream-drift-watch-01/04 ────────────────────────────────────────────
  registry.define(/^the live "([^"]+)" branch "([^"]+)" head is a different, newer SHA$/, (ctx, _repo, _branch) => {
    // A real new commit on the real upstream repo genuinely advances its
    // live `git ls-remote` head past the already-recorded/written sha.
    git(ctx.upstreamRepo, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'advance']);
    ctx.liveSha = git(ctx.upstreamRepo, ['rev-parse', 'HEAD']);
  });

  // ── upstream-drift-watch-02 ───────────────────────────────────────────────
  registry.define(/^the live "([^"]+)" branch "([^"]+)" head equals that recorded SHA$/, (ctx, _repo, _branch) => {
    // Nothing to do - no further commit means the live head IS still the
    // recorded sha; asserted directly below rather than assumed.
    ctx.liveSha = git(ctx.upstreamRepo, ['rev-parse', 'HEAD']);
    if (ctx.liveSha !== ctx.recordedSha) {
      throw new Error('test setup error: expected the live head to still equal the recorded sha');
    }
  });

  // ── upstream-drift-watch-03 ───────────────────────────────────────────────
  registry.define(/^the watch file has no entry for upstream "([^"]+)" branch "([^"]+)"$/, (ctx, repo, branch) => {
    delete ctx.repos[repo].branches[branch];
    writeWatchFile(ctx);
    ctx.watchBytesBefore = fs.readFileSync(ctx.watchPath);
  });

  registry.define(/^the live "([^"]+)" repo has a branch "([^"]+)"$/, (ctx, _repo, branch) => {
    git(ctx.upstreamRepo, ['checkout', '-q', '-b', branch]);
    git(ctx.upstreamRepo, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'new-branch']);
    ctx.newBranchSha = git(ctx.upstreamRepo, ['rev-parse', branch]);
    git(ctx.upstreamRepo, ['checkout', '-q', 'main']);
  });

  // ── When (shared by every scenario) ──────────────────────────────────────
  registry.define(/^the drift check runs$/, (ctx) => {
    runDriftCheck(ctx);
  });

  // ── Then ──────────────────────────────────────────────────────────────────
  registry.define(
    /^the report lists "([^"]+)" branch "([^"]+)" as drifted from the recorded SHA to the live head$/,
    (ctx, repo, branch) => {
      const expected = `DRIFT ${repo} ${branch}: ${ctx.recordedSha} -> ${ctx.liveSha}`;
      if (!ctx.stdout.includes(expected)) {
        throw new Error(`expected drift line "${expected}" in output, got: ${ctx.stdout}`);
      }
    }
  );

  registry.define(/^the drift check exits non-zero$/, (ctx) => {
    if (ctx.exitCode === 0) {
      throw new Error(`expected a non-zero exit code, got 0. stdout: ${ctx.stdout} stderr: ${ctx.stderr}`);
    }
  });

  registry.define(/^the report lists no drift for "([^"]+)" branch "([^"]+)"$/, (ctx, repo, branch) => {
    if (ctx.stdout.includes('DRIFT') || ctx.stdout.includes('NEW-BRANCH')) {
      throw new Error(`expected no drift reported for ${repo} ${branch}, got: ${ctx.stdout}`);
    }
  });

  registry.define(/^the drift check exits zero$/, (ctx) => {
    if (ctx.exitCode !== 0) {
      throw new Error(`expected exit code 0, got ${ctx.exitCode}. stdout: ${ctx.stdout} stderr: ${ctx.stderr}`);
    }
  });

  registry.define(/^the report lists "([^"]+)" branch "([^"]+)" as a new upstream branch$/, (ctx, repo, branch) => {
    const expected = `NEW-BRANCH ${repo} ${branch} @ ${ctx.newBranchSha}`;
    if (!ctx.stdout.includes(expected)) {
      throw new Error(`expected new-branch line "${expected}" in output, got: ${ctx.stdout}`);
    }
  });

  registry.define(/^the watch file on disk is byte-for-byte unchanged$/, (ctx) => {
    const after = fs.readFileSync(ctx.watchPath);
    if (!after.equals(ctx.watchBytesBefore)) {
      throw new Error('expected the watch file to be byte-for-byte unchanged after the drift check ran');
    }
  });

  registry.define(/^no install pin is modified$/, (ctx) => {
    const lockPath = path.join(REPO_ROOT, 'swarmforge.lock.json');
    // ctx.lockJsonBefore is captured by the shared "the drift check runs"
    // step, right before the CLI is spawned - compared here after the run.
    const lockNow = fs.readFileSync(lockPath, 'utf8');
    if (ctx.lockJsonBefore !== lockNow) {
      throw new Error('expected swarmforge.lock.json to be byte-for-byte unchanged after the drift check ran');
    }
  });
}

module.exports = { registerSteps };
