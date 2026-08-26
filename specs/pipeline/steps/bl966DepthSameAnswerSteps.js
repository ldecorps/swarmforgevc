'use strict';

// BL-966: step handlers for "depth CLI gives the same answer from every
// checkout". Drives the REAL swarmforge/scripts/effective_backlog_depth_cli.bb
// over disposable scratch roots - a git repo with a linked worktree, a git
// repo with no identity, and a plain non-git temp dir - never a
// reimplementation of the resolution.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'effective_backlog_depth_cli.bb');

const FEATURE = 'BL-966 depth CLI gives the same answer from every checkout';

let trackedRoots = [];

afterEach(() => {
  while (trackedRoots.length) {
    const root = trackedRoots.pop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function mkTmp(prefix) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  trackedRoots.push(root);
  return root;
}

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function writeDefaultConf(root, cap) {
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    `config active_backlog_max_depth ${cap}\n`
  );
  // A no-op refresh stub so the CLI's throttle-recommendation step (out of
  // scope here) degrades silently - scenario 01/02 assert a genuinely
  // clean stderr, which must isolate BL-966's own fall-through notice.
  const toolsDir = path.join(root, 'extension', 'out', 'tools');
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(path.join(toolsDir, 'emit-throttle-recommendation.js'), 'process.exit(0);\n');
}

function mkGitMaster(ctx) {
  ctx.master = mkTmp('sfvc-bl966-');
  fs.writeFileSync(path.join(ctx.master, 'README.md'), 'init\n');
  git(ctx.master, ['init', '-q', '-b', 'main']);
  git(ctx.master, ['add', '-A']);
  git(ctx.master, ['commit', '-q', '-m', 'init']);
}

function runCli(ctx, root) {
  const r = spawnSync('bb', [CLI, root], { encoding: 'utf8' });
  ctx.result = {
    exitCode: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: r.stderr || '',
  };
}

function assertCapCleanStderr(ctx, cap) {
  assert.equal(ctx.result.stdout, String(cap), `expected cap ${cap} on stdout, got: ${JSON.stringify(ctx.result)}`);
  assert.equal(ctx.result.exitCode, 0);
  assert.equal(ctx.result.stderr, '', `expected nothing on stderr for an identity-derived answer, got: ${ctx.result.stderr}`);
}

function assertCapWithNotice(ctx, cap) {
  assert.equal(ctx.result.stdout, String(cap), `expected cap ${cap} on stdout, got: ${JSON.stringify(ctx.result)}`);
  assert.equal(ctx.result.exitCode, 0, `expected exit 0, got: ${JSON.stringify(ctx.result)}`);
  assert.ok(
    ctx.result.stderr.includes('no swarm-identity') && ctx.result.stderr.includes('swarmforge.conf'),
    `expected the fall-through notice naming the default conf on stderr, got: ${ctx.result.stderr}`
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a scratch git repository whose master checkout carries a swarm-identity naming a pack conf with cap 7$/,
    (ctx) => {
      mkGitMaster(ctx);
      writeDefaultConf(ctx.master, 3);
      fs.mkdirSync(path.join(ctx.master, 'swarmforge', 'packs'), { recursive: true });
      const packConf = path.join(ctx.master, 'swarmforge', 'packs', 'big.conf');
      fs.writeFileSync(packConf, 'config active_backlog_max_depth 7\n');
      fs.mkdirSync(path.join(ctx.master, '.swarmforge'), { recursive: true });
      fs.writeFileSync(
        path.join(ctx.master, '.swarmforge', 'swarm-identity'),
        `active_backlog_max_depth_conf_path\t${packConf}\n`
      );
    }
  );

  scoped(/^a linked worktree of that repository$/, (ctx) => {
    ctx.worktree = `${ctx.master}-wt`;
    trackedRoots.push(ctx.worktree);
    git(ctx.master, ['worktree', 'add', '-q', ctx.worktree, '-b', 'wt-branch']);
    writeDefaultConf(ctx.worktree, 3);
  });

  scoped(/^a scratch git repository with no swarm-identity in any checkout$/, (ctx) => {
    mkGitMaster(ctx);
  });

  scoped(/^its tracked default conf sets cap 3$/, (ctx) => {
    writeDefaultConf(ctx.master, 3);
  });

  scoped(
    /^a plain temp-dir root that is not a git repository, with a tracked default conf setting cap 3$/,
    (ctx) => {
      ctx.master = mkTmp('sfvc-bl966-plain-');
      writeDefaultConf(ctx.master, 3);
    }
  );

  scoped(/^the depth CLI runs against the worktree root$/, (ctx) => {
    runCli(ctx, ctx.worktree);
  });

  scoped(/^the depth CLI runs against the master checkout root$/, (ctx) => {
    runCli(ctx, ctx.master);
  });

  scoped(/^the depth CLI runs against that root$/, (ctx) => {
    runCli(ctx, ctx.master);
  });

  scoped(/^it prints cap 7 with nothing on stderr$/, (ctx) => {
    assertCapCleanStderr(ctx, 7);
  });

  scoped(/^it prints cap 3 and exits 0$/, (ctx) => {
    assert.equal(ctx.result.stdout, '3', `expected cap 3 on stdout, got: ${JSON.stringify(ctx.result)}`);
    assert.equal(ctx.result.exitCode, 0);
  });

  scoped(/^stderr carries a fall-through notice naming the default conf$/, (ctx) => {
    assertCapWithNotice(ctx, 3);
  });
}

module.exports = { registerSteps };
