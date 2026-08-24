'use strict';

// BL-1106: control pause must resolve at the master checkout (same as
// BL-966's config half). Drives REAL effective_backlog_depth_cli.bb and
// promote_and_route_next.sh — never a reimplementation.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const FEATURE = 'A control pause is visible from every checkout, not only from master';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'effective_backlog_depth_cli.bb');
const PROMOTE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'promote_and_route_next.sh');

const KNOWN_MARKERS = new Set([
  'an active pause marker with no timer',
  'a pause marker whose timer has already expired',
  'no pause marker',
]);
const KNOWN_CHECKOUTS = new Set(['master checkout', 'worktree']);
const KNOWN_CAPS = new Set(['0', '7']);

const TICKET_ID = 'BL-1106';
const TICKET_FILE = `${TICKET_ID}-promotable-fixture.yaml`;

let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    try {
      fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
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
  const toolsDir = path.join(root, 'extension', 'out', 'tools');
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(path.join(toolsDir, 'emit-throttle-recommendation.js'), 'process.exit(0);\n');
}

function writePauseMarker(master, kind) {
  const dir = path.join(master, '.swarmforge', 'operator');
  const file = path.join(dir, 'control-pause.json');
  if (kind === 'no pause marker') {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  if (kind === 'an active pause marker with no timer') {
    fs.writeFileSync(file, JSON.stringify({ active: true }));
    return;
  }
  if (kind === 'a pause marker whose timer has already expired') {
    fs.writeFileSync(file, JSON.stringify({ active: true, untilMs: 1 }));
    return;
  }
  throw new Error(`unknown marker cell: ${kind}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a scratch git repository whose master checkout carries a swarm-identity naming a pack conf with cap 7$/,
    (ctx) => {
      ctx.master = mkTmp('sfvc-bl1106-');
      fs.writeFileSync(path.join(ctx.master, 'README.md'), 'init\n');
      git(ctx.master, ['init', '-q', '-b', 'main']);
      git(ctx.master, ['add', '-A']);
      git(ctx.master, ['commit', '-q', '-m', 'init']);
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
    git(ctx.master, ['worktree', 'add', '-q', ctx.worktree, '-b', `wt-${Date.now()}`]);
    writeDefaultConf(ctx.worktree, 3);
  });

  scoped(/^the master checkout carries (.+)$/, (ctx, marker) => {
    assert.ok(KNOWN_MARKERS.has(marker), `unknown marker cell: ${marker}`);
    writePauseMarker(ctx.master, marker);
    ctx.marker = marker;
  });

  scoped(/^the depth CLI runs against the (.+) root$/, (ctx, checkout) => {
    assert.ok(KNOWN_CHECKOUTS.has(checkout), `unknown checkout cell: ${checkout}`);
    const root = checkout === 'worktree' ? ctx.worktree : ctx.master;
    const r = spawnSync('bb', [CLI, root], { encoding: 'utf8' });
    ctx.result = {
      exitCode: r.status,
      stdout: (r.stdout || '').trim(),
      stderr: r.stderr || '',
    };
  });

  scoped(/^it prints cap (\d+)$/, (ctx, cap) => {
    assert.ok(KNOWN_CAPS.has(cap), `unknown cap cell: ${cap}`);
    assert.equal(ctx.result.stdout, cap, `expected cap ${cap}, got ${JSON.stringify(ctx.result)}`);
    assert.equal(ctx.result.exitCode, 0);
  });

  scoped(/^a promotable ticket in the paused pool$/, (ctx) => {
    // Worktree has its own working tree — write the ticket where promote
    // will look (worktree ROOT/backlog/paused).
    const paused = path.join(ctx.worktree, 'backlog', 'paused');
    const active = path.join(ctx.worktree, 'backlog', 'active');
    fs.mkdirSync(paused, { recursive: true });
    fs.mkdirSync(active, { recursive: true });
    fs.writeFileSync(
      path.join(paused, TICKET_FILE),
      [
        `id: ${TICKET_ID}`,
        'title: "promotable fixture"',
        'status: todo',
        'priority: 50',
        'type: feature',
        'human_approval: approved',
        'assigned_to: coder',
        'acceptance: specs/features/x.feature',
        '',
      ].join('\n')
    );
    fs.mkdirSync(path.join(ctx.worktree, 'specs', 'features'), { recursive: true });
    fs.writeFileSync(path.join(ctx.worktree, 'specs', 'features', 'x.feature'), 'Feature: x\n');
    ctx.ticketPath = path.join(paused, TICKET_FILE);
  });

  scoped(/^the promotion path runs from the worktree root$/, (ctx) => {
    const r = spawnSync('bash', [PROMOTE, TICKET_ID, ctx.worktree], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    ctx.promote = {
      exitCode: r.status,
      stdout: r.stdout || '',
      stderr: r.stderr || '',
    };
  });

  scoped(/^no ticket moves into the active pool$/, (ctx) => {
    const active = path.join(ctx.worktree, 'backlog', 'active');
    const yaml = fs.existsSync(active)
      ? fs.readdirSync(active).filter((f) => f.endsWith('.yaml'))
      : [];
    assert.equal(yaml.length, 0, `active pool not empty: ${yaml.join(', ')}`);
  });

  scoped(/^the ticket is still in the paused pool$/, (ctx) => {
    assert.ok(fs.existsSync(ctx.ticketPath), `missing paused ticket ${ctx.ticketPath}`);
    assert.ok(
      ctx.promote.exitCode !== 0,
      `expected promote to refuse under pause; got exit 0\n${ctx.promote.stdout}\n${ctx.promote.stderr}`
    );
  });
}

module.exports = { registerSteps };
