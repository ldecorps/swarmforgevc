'use strict';

// BL-856: step handlers for "a failed integrity commit leaves the index
// exactly as it found it". Drives the REAL commit_integrity_lib.bb via a
// small acceptance-test seam CLI (commit_integrity_856_scenarios_cli.bb)
// that injects only the ONE seam needed to reproduce a named failure
// reason - every other path (add/commit/rev-parse/show/snapshot/restore)
// is the real git-backed implementation, so the restore behavior under
// test is the REAL restore-index!, mirroring the existing BL-419
// commit_integrity_test_cli.bb precedent for this same library.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCENARIOS_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'commit_integrity_856_scenarios_cli.bb');

const REASON_TEXT_TO_FLAG = {
  'a commit failure': 'commit-failure',
  'a verify mismatch': 'verify-mismatch',
  'a staging failure': 'staging-failure',
  'a lock timeout': 'lock-timeout',
};

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
}

function mkGitRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl856-')));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
  git(dir, ['commit', '-q', '-m', 'init', '--allow-empty']);
  return dir;
}

function gitStatusPorcelain(dir, paths) {
  return git(dir, ['status', '--porcelain', '--', ...paths]);
}

// Runs the real commit-with-integrity! (through the acceptance seam CLI)
// and returns both the parsed JSON result and whether the subprocess
// exited non-zero - mirrors the production CLI's own exit-code contract.
function runScenariosCli(dir, { message, paths, reason, restoreFails }) {
  const args = [SCENARIOS_CLI, dir, '--message', message, '--reason', reason];
  for (const p of paths) {
    args.push('--path', p);
  }
  if (restoreFails) {
    args.push('--restore-fails');
  }
  let stdout;
  let failed = false;
  try {
    stdout = execFileSync('bb', args, { encoding: 'utf8' });
  } catch (err) {
    failed = true;
    stdout = err.stdout;
  }
  return { parsed: JSON.parse(stdout), processFailed: failed };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a checkout whose index holds nothing staged$/, (ctx) => {
    ctx.dir = mkGitRepo();
    ctx.callerPath = 'caller.txt';
    ctx.paths = [ctx.callerPath];
    ctx.restoreFails = false;
  });

  registry.define(/^the caller has written its own change to disk unstaged$/, (ctx) => {
    const abs = path.join(ctx.dir, ctx.callerPath);
    fs.writeFileSync(abs, 'v1\n');
    git(ctx.dir, ['add', '--', ctx.callerPath]);
    git(ctx.dir, ['commit', '-q', '-m', 'seed']);
    fs.writeFileSync(abs, 'v2 - caller change\n');
    ctx.expectedContent = 'v2 - caller change\n';
  });

  // ── BL-856 no-staged-residue-on-failure-01 / restore-is-pathspec-scoped-02
  //    / caller-prestaged-state-survives-03 / restore-failure-is-loud-04 ──
  registry.define(/^the integrity commit fails with (a commit failure|a verify mismatch|a staging failure|a lock timeout)$/, (ctx, reasonText) => {
    ctx.reasonFlag = REASON_TEXT_TO_FLAG[reasonText];
    ctx.result = runScenariosCli(ctx.dir, { message: 'm', paths: ctx.paths, reason: ctx.reasonFlag, restoreFails: ctx.restoreFails });
  });

  registry.define(/^the call reports failure$/, (ctx) => {
    if (ctx.result.parsed.success !== false) {
      throw new Error(`expected the call to report failure, got: ${JSON.stringify(ctx.result.parsed)}`);
    }
    if (!ctx.result.processFailed) {
      throw new Error('expected the CLI subprocess to exit non-zero on a failed call, mirroring the production CLI');
    }
  });

  registry.define(/^the caller's paths are unstaged again$/, (ctx) => {
    const status = gitStatusPorcelain(ctx.dir, [ctx.callerPath]);
    if (status.startsWith('M') || status.startsWith('A')) {
      throw new Error(`expected the caller's path to be unstaged, got status: "${status}"`);
    }
  });

  // ── BL-856 restore-is-pathspec-scoped-02 ────────────────────────────
  registry.define(/^another writer has already staged a path of its own$/, (ctx) => {
    ctx.otherPath = 'other.txt';
    fs.writeFileSync(path.join(ctx.dir, ctx.otherPath), 'other content\n');
    git(ctx.dir, ['add', '--', ctx.otherPath]);
  });

  registry.define(/^the other writer's staged path is still staged$/, (ctx) => {
    const status = gitStatusPorcelain(ctx.dir, [ctx.otherPath]);
    if (!status.startsWith('A')) {
      throw new Error(`expected the other writer's path to remain staged, got status: "${status}"`);
    }
  });

  // ── BL-856 caller-prestaged-state-survives-03 ───────────────────────
  registry.define(/^the caller staged a rename with git mv before calling$/, (ctx) => {
    ctx.oldPath = 'backlog/active/BL-999.yaml';
    ctx.newPath = 'backlog/done/BL-999.yaml';
    fs.mkdirSync(path.join(ctx.dir, 'backlog', 'active'), { recursive: true });
    fs.mkdirSync(path.join(ctx.dir, 'backlog', 'done'), { recursive: true });
    fs.writeFileSync(path.join(ctx.dir, ctx.oldPath), 'id: BL-999\n');
    git(ctx.dir, ['add', '--', ctx.oldPath]);
    git(ctx.dir, ['commit', '-q', '-m', 'seed BL-999']);
    git(ctx.dir, ['mv', ctx.oldPath, ctx.newPath]);
    ctx.paths = [ctx.oldPath, ctx.newPath];
  });

  registry.define(/^the staged rename is still staged$/, (ctx) => {
    const status = gitStatusPorcelain(ctx.dir, [ctx.oldPath, ctx.newPath]);
    if (!status.includes(`R  ${ctx.oldPath} -> ${ctx.newPath}`)) {
      throw new Error(`expected the pre-staged rename to survive the restore, got status: "${status}"`);
    }
  });

  // ── BL-856 restore-failure-is-loud-04 ───────────────────────────────
  registry.define(/^restoring the index will fail$/, (ctx) => {
    ctx.restoreFails = true;
  });

  registry.define(/^the result names the index as left dirty$/, (ctx) => {
    if (ctx.result.parsed['index-left-dirty'] !== true) {
      throw new Error(`expected the result to name the index as left dirty, got: ${JSON.stringify(ctx.result.parsed)}`);
    }
  });

  // ── BL-856 success-path-unchanged-05 ────────────────────────────────
  registry.define(/^the integrity commit succeeds$/, (ctx) => {
    ctx.result = runScenariosCli(ctx.dir, { message: 'm', paths: ctx.paths, reason: 'none' });
  });

  registry.define(/^the committed content matches what the caller wrote$/, (ctx) => {
    const shown = git(ctx.dir, ['show', `${ctx.result.parsed.sha}:${ctx.callerPath}`]);
    if (shown !== ctx.expectedContent) {
      throw new Error(`expected committed content "${ctx.expectedContent}", got "${shown}"`);
    }
  });

  // ── BL-856 unrelated-commit-carries-nothing-06 ──────────────────────
  registry.define(/^the integrity commit has already failed with a commit failure$/, (ctx) => {
    ctx.result = runScenariosCli(ctx.dir, { message: 'm', paths: ctx.paths, reason: 'commit-failure' });
  });

  registry.define(/^an unrelated writer commits its own file with no pathspec$/, (ctx) => {
    ctx.unrelatedPath = 'unrelated.txt';
    fs.writeFileSync(path.join(ctx.dir, ctx.unrelatedPath), 'unrelated content\n');
    git(ctx.dir, ['add', '--', ctx.unrelatedPath]);
    git(ctx.dir, ['commit', '-q', '-m', 'unrelated writer: add unrelated.txt']);
  });

  registry.define(/^that commit carries only the unrelated writer's file$/, (ctx) => {
    const stat = git(ctx.dir, ['show', '--stat', '--format=', 'HEAD']);
    if (!stat.includes(ctx.unrelatedPath)) {
      throw new Error(`expected the unrelated writer's own commit to carry its own file, got: ${stat}`);
    }
    if (stat.includes(ctx.callerPath)) {
      throw new Error(`expected the unrelated writer's commit to carry NONE of the caller's abandoned edit, got: ${stat}`);
    }
  });
}

module.exports = { registerSteps };
