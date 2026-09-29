'use strict';

// BL-1805: step handlers for "Every QA turn retries a pending land re-point".
// Drives the REAL ready_for_next_task.bb (which calls the REAL
// land_step_cli.bb try-repoint) against a fixture with a bare origin under
// mkdtemp - never the live QA worktree, and never a reimplementation of
// the re-point. Fixture shape follows bl1773's bare-origin-plus-worktree
// convention, with a roles.tsv naming QA and coder so the role gate is
// exercised for real.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1805 Every QA turn retries a pending land re-point';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const READY_FOR_NEXT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'ready_for_next_task.bb');
const LANDED_TICKET = 'BL-9805';

const KNOWN_ROLES = new Set(['QA', 'coder']);
const KNOWN_PENDING = new Set(['cleared', 'armed']);

const extraCleanupPaths = [];
process.on('exit', () => {
  for (const p of extraCleanupPaths) {
    fs.rmSync(p, { recursive: true, force: true });
  }
});

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function pendingPath(root) {
  return path.join(root, '.swarmforge', 'daemon', 'pending-land-repoint.json');
}

function armPending(root, oldTip) {
  const dir = path.dirname(pendingPath(root));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    pendingPath(root),
    JSON.stringify({
      'landed-task-ticket-id': LANDED_TICKET,
      reason: 'an uncommitted change',
      'old-tip': oldTip,
      'armed-at-ms': Date.now(),
    })
  );
}

function seatDir(root, role) {
  return role === 'QA' ? root : path.join(root, 'coder');
}

function buildFixture(ctx) {
  const root = trackedTmpRoot('sfvc-bl1805-');
  const origin = `${root}-origin.git`;
  extraCleanupPaths.push(origin);

  execFileSync('git', ['init', '-q', '--bare', origin]);
  try {
    execFileSync('git', ['-C', origin, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  } catch {
    // best-effort
  }

  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'coder'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  for (const [k, v] of [
    ['user.email', 't@t'],
    ['user.name', 't'],
    ['commit.gpgsign', 'false'],
  ]) {
    git(root, 'config', k, v);
  }
  git(root, 'remote', 'add', 'origin', origin);
  fs.writeFileSync(path.join(root, '.gitignore'), '.swarmforge/\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  // Tracked conf committed with the seed so the tree stays clean after
  // later .swarmforge-only writes (gitignored).
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), '');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed');
  git(root, 'push', '-q', '-u', 'origin', 'main');

  // Tip ahead of origin/main so a successful try-repoint has somewhere to
  // move FROM. Pending is armed as if a prior dirty-tree skip recorded it.
  fs.writeFileSync(path.join(root, 'ahead.txt'), 'ahead\n');
  git(root, 'add', 'ahead.txt');
  git(root, 'commit', '-q', '-m', `${LANDED_TICKET}: ahead of origin/main`);
  ctx.oldTip = git(root, 'rev-parse', 'HEAD');
  armPending(root, ctx.oldTip);

  const qaPath = root;
  const coderPath = seatDir(root, 'coder');
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    [
      `QA\tQA\t${qaPath}\tswarmforge-QA\tQA\tclaude\ttask`,
      `coder\tcoder\t${coderPath}\tswarmforge-coder\tCoder\tclaude\ttask`,
    ].join('\n') + '\n'
  );
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'swarm-identity'),
    [
      'swarm_name\tfixture',
      'swarm_mode\tautonomous',
      'active_backlog_max_depth_conf_path\tswarmforge/swarmforge.conf',
      '',
    ].join('\n')
  );

  // Empty mailboxes so ready_for_next reports NO_TASK when nothing is
  // claimed / resumed (scenario 01 and the coder turn).
  for (const role of ['QA', 'coder']) {
    for (const state of ['new', 'in_process', 'completed', 'abandoned']) {
      fs.mkdirSync(
        path.join(seatDir(root, role), '.swarmforge', 'handoffs', 'inbox', state),
        { recursive: true }
      );
    }
  }

  ctx.root = root;
  ctx.origin = origin;
  ctx.originMain = git(origin, 'rev-parse', 'main');
}

function runReadyForNext(ctx, role) {
  const result = spawnSync('bb', [READY_FOR_NEXT], {
    cwd: seatDir(ctx.root, role),
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, SWARMFORGE_ROLE: role, HOME: process.env.HOME },
  });
  ctx.lastRole = role;
  ctx.lastOut = `${result.stdout || ''}${result.stderr || ''}`;
  ctx.lastStatus = result.status;
  assert.equal(
    result.status,
    0,
    `ready_for_next as ${role} failed (status ${result.status}): ${ctx.lastOut}`
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture swarm whose QA worktree has an armed pending land re-point and a clean tree$/,
    (ctx) => {
      buildFixture(ctx);
      assert.equal(git(ctx.root, 'status', '--porcelain'), '', 'fixture tree must be clean');
      assert.ok(fs.existsSync(pendingPath(ctx.root)), 'pending re-point must be armed');
    }
  );

  scoped(/^no role has new mail waiting$/, (ctx) => {
    for (const role of ['QA', 'coder']) {
      const dir = path.join(seatDir(ctx.root, role), '.swarmforge', 'handoffs', 'inbox', 'new');
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.handoff')) : [];
      assert.equal(files.length, 0, `${role} new/ must be empty`);
    }
  });

  scoped(/^a parcel sits in QA's in_process$/, (ctx) => {
    const dir = path.join(ctx.root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '00_other.handoff'),
      'type: git_handoff\ntask: BL-9999\nfrom: coder\nto: QA\n'
    );
  });

  scoped(/^"([^"]+)" runs ready_for_next$/, (ctx, role) => {
    assert.ok(KNOWN_ROLES.has(role), `unknown role: ${role}`);
    runReadyForNext(ctx, role);
  });

  scoped(/^the pending land re-point is "([^"]+)"$/, (ctx, state) => {
    assert.ok(KNOWN_PENDING.has(state), `unknown pending state: ${state}`);
    const armed = fs.existsSync(pendingPath(ctx.root));
    if (state === 'cleared') {
      assert.equal(armed, false, `expected pending cleared; output was:\n${ctx.lastOut}`);
    } else {
      assert.equal(armed, true, `expected pending still armed; output was:\n${ctx.lastOut}`);
    }
  });

  scoped(/^the QA branch points at origin\/main$/, (ctx) => {
    const head = git(ctx.root, 'rev-parse', 'HEAD');
    assert.equal(head, ctx.originMain, 'expected QA HEAD to equal origin/main after re-point');
  });

  scoped(/^the QA branch has not moved$/, (ctx) => {
    const head = git(ctx.root, 'rev-parse', 'HEAD');
    assert.equal(head, ctx.oldTip, 'expected QA HEAD unchanged');
  });

  scoped(/^the output still ends with NO_TASK$/, (ctx) => {
    // The turn's idle report must still fire; trailing diagnostic lines
    // from unrelated libs (if any) do not count against that.
    assert.match(ctx.lastOut, /(^|\n)NO_TASK(\n|$)/, `expected a NO_TASK line; got:\n${ctx.lastOut}`);
  });
}

module.exports = { registerSteps };
