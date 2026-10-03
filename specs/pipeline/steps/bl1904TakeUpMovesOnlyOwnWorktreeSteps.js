'use strict';

// BL-1904: step handlers for "A take-up moves only the running role's own
// registered worktree". Drives the REAL ready_for_next_task.bb (the leaf: it
// reads its cwd, so the receive stays inside the fixture) with
// SWARMFORGE_ROLE set and the chosen checkout as cwd. The fixture is a
// `git init` with a bare origin under mkdtemp, proven its own repository by
// --git-common-dir before any mutating git command (BL-1390), with coder and
// QA linked worktrees registered in its own .swarmforge/roles.tsv, and a stub
// tmux first on PATH so nothing reaches a live server.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = "BL-1904 A take-up moves only the running role's own registered worktree";
const SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
  return env;
}

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: cleanEnv(),
  }).trim();
}

function roleRow(role, worktreeName, worktreePath) {
  return [role, worktreeName, worktreePath, `swarmforge-${role}`, role, 'claude', 'task'].join('\t');
}

function makeFixture() {
  const work = fs.realpathSync(mkProcessTmpDir('bl1904acc-'));
  const origin = path.join(work, 'origin.git');
  const root = path.join(work, 'repo');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env: cleanEnv() });
  execFileSync('git', ['init', '-q', '-b', 'main', root], { env: cleanEnv() });
  assert.equal(path.resolve(root, git(root, 'rev-parse', '--git-common-dir')), path.join(root, '.git'), 'fixture is not its own repository');
  fs.writeFileSync(path.join(root, '.gitignore'), '.worktrees/\n.swarmforge/\nbin/\n');
  git(root, 'add', '.gitignore');
  git(root, 'commit', '-q', '-m', 'seed');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '-q', 'origin', 'main');
  git(root, 'fetch', '-q', 'origin');
  const coder = path.join(root, '.worktrees', 'coder');
  // coder@2's worktree path has coder's as a string prefix: a collision
  // candidate for any check that compares paths by prefix.
  const coder2 = path.join(root, '.worktrees', 'coder2');
  const qa = path.join(root, '.worktrees', 'QA');
  git(root, 'worktree', 'add', '-q', '-b', 'swarmforge-coder', coder, 'origin/main');
  git(root, 'worktree', 'add', '-q', '-b', 'swarmforge-coder2', coder2, 'origin/main');
  git(root, 'worktree', 'add', '-q', '-b', 'swarmforge-QA', qa, 'origin/main');
  // QA is mid-pass on a commit of its own, as it was on 2026-10-02.
  git(qa, 'commit', '-q', '--allow-empty', '-m', 'BL-9002: QA review pass evidence');
  const side = path.join(root, '.worktrees', 'side');
  git(root, 'worktree', 'add', '-q', '--detach', side, 'origin/main');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const fx = {
    work,
    root,
    coder,
    coder2,
    qa,
    side,
    rows: [roleRow('coder', 'coder', coder), roleRow('coder@2', 'coder2', coder2), roleRow('QA', 'QA', qa)],
    seq: 0,
  };
  writeRoles(fx);
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'tmux'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
  return fx;
}

function writeRoles(fx) {
  fs.writeFileSync(path.join(fx.root, '.swarmforge', 'roles.tsv'), `${fx.rows.join('\n')}\n`);
}

function ensure(ctx) {
  if (!ctx.bl1904) ctx.bl1904 = makeFixture();
  return ctx.bl1904;
}

// A commit no worktree's branch carries: made on the detached side worktree.
function parcelCommit(fx, ticket) {
  git(fx.side, 'checkout', '-q', '--detach', 'origin/main');
  fs.writeFileSync(path.join(fx.side, `${ticket}-${fx.seq}.txt`), `${ticket}\n`);
  git(fx.side, 'add', '-A');
  git(fx.side, 'commit', '-q', '-m', `${ticket}: the build`);
  return git(fx.side, 'rev-parse', 'HEAD');
}

// A seat claims from its stage's queue, so coder@2's parcel waits in coder's.
const MAILBOX_NEW = {
  coder: (fx) => path.join(fx.coder, '.swarmforge', 'handoffs', 'inbox', 'new'),
  'coder@2': (fx) => path.join(fx.coder, '.swarmforge', 'handoffs', 'inbox', 'new'),
  QA: (fx) => path.join(fx.qa, '.swarmforge', 'handoffs', 'inbox', 'new'),
  specifier: (fx) => path.join(fx.root, '.swarmforge', 'handoffs', 'specifier', 'inbox', 'new'),
};

const CHECKOUTS = {
  'the QA worktree': (fx) => fx.qa,
  'the coder worktree': (fx) => fx.coder,
  'a subdirectory of the coder worktree': (fx) => {
    const sub = path.join(fx.coder, 'sub', 'dir');
    fs.mkdirSync(sub, { recursive: true });
    return sub;
  },
  'the shared checkout': (fx) => fx.root,
};

function state(dir) {
  return { branch: git(dir, 'symbolic-ref', '--short', 'HEAD'), head: git(dir, 'rev-parse', 'HEAD') };
}

function backupRefs(fx) {
  return git(fx.root, 'for-each-ref', '--format=%(refname)', 'refs/swarmforge/parcel-backup/');
}

function writeHandoff(fx, role, commit) {
  fx.seq += 1;
  fx.parcel = commit;
  const dir = MAILBOX_NEW[role](fx);
  fs.mkdirSync(dir, { recursive: true });
  const id = `20261003T000000Z_${String(fx.seq).padStart(6, '0')}_from_QA`;
  fs.writeFileSync(
    path.join(dir, `00_${id}_to_${role}_for_${role}.handoff`),
    [
      `id: ${id}`,
      'from: QA',
      `to: ${role}`,
      `recipient: ${role}`,
      'priority: 00',
      'type: git_handoff',
      'role: QA',
      'task: BL-9001',
      `commit: ${commit.slice(0, 10)}`,
      'created_at: 2026-10-03T00:00:00Z',
      'enqueued_at: 2026-10-03T00:00:00Z',
      '',
      `merge_and_process QA ${commit.slice(0, 10)}`,
      '',
    ].join('\n')
  );
}

// The REAL receive, as `role`, from `cwd`, with the stub tmux first on PATH.
function runReceive(fx, role, cwd) {
  const res = spawnSync('bb', [path.join(SCRIPTS_DIR, 'ready_for_next_task.bb')], {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    env: cleanEnv({ PATH: `${path.join(fx.root, 'bin')}:${process.env.PATH}`, SWARMFORGE_ROLE: role }),
  });
  fx.out = `${res.stdout || ''}${res.stderr || ''}`;
  return res;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository with origin, and coder and QA worktrees registered in roles\.tsv$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^the specifier's roles\.tsv row is the shared checkout with worktree-name master$/, (ctx) => {
    const fx = ensure(ctx);
    fx.rows.push(roleRow('specifier', 'master', fx.root));
    writeRoles(fx);
  });

  scoped(/^the "([^"]+)" mailbox holds a git_handoff at a commit no worktree's branch carries$/, (ctx, role) => {
    assert.ok(MAILBOX_NEW[role], `unknown mailbox role in the feature: ${role}`);
    const fx = ensure(ctx);
    writeHandoff(fx, role, parcelCommit(fx, 'BL-9001'));
  });

  scoped(/^ready_for_next_task runs as "([^"]+)" from "([^"]+)"$/, (ctx, role, checkout) => {
    const where = CHECKOUTS[checkout];
    assert.ok(where, `unknown checkout in the feature: ${checkout}`);
    assert.ok(MAILBOX_NEW[role], `unknown role in the feature: ${role}`);
    const fx = ensure(ctx);
    fx.before = { qa: state(fx.qa), coder: state(fx.coder), root: state(fx.root), refs: backupRefs(fx) };
    const res = runReceive(fx, role, where(fx));
    assert.equal(res.status, 0, fx.out);
    assert.match(fx.out, /TASK:/, `the receive claimed nothing:\n${fx.out}`);
  });

  scoped(/^the QA worktree's branch and HEAD are unchanged$/, (ctx) => {
    const fx = ensure(ctx);
    assert.deepEqual(state(fx.qa), fx.before.qa, fx.out);
  });

  scoped(/^the shared checkout's branch and HEAD are unchanged$/, (ctx) => {
    const fx = ensure(ctx);
    assert.deepEqual(state(fx.root), fx.before.root, fx.out);
  });

  scoped(/^no parcel-backup ref is written$/, (ctx) => {
    const fx = ensure(ctx);
    assert.equal(backupRefs(fx), fx.before.refs, fx.out);
  });

  scoped(/^the output says the parcel was not taken up in that checkout$/, (ctx) => {
    const fx = ensure(ctx);
    const line = fx.out.split('\n').find((l) => l.startsWith('PARCEL_LINE:'));
    assert.ok(line, `no PARCEL_LINE line:\n${fx.out}`);
    assert.match(line, /not taken up/, line);
    assert.ok(line.includes(fx.qa), `the line does not name the checkout ${fx.qa}: ${line}`);
  });

  scoped(/^the coder worktree's branch is at the parcel's commit$/, (ctx) => {
    const fx = ensure(ctx);
    const now = state(fx.coder);
    assert.equal(now.branch, 'swarmforge-coder', fx.out);
    assert.equal(now.head, fx.parcel, fx.out);
  });

  scoped(/^the output carries no PARCEL_LINE line$/, (ctx) => {
    const fx = ensure(ctx);
    assert.doesNotMatch(fx.out, /PARCEL_LINE/, fx.out);
  });
}

// The property test (bl1904TakeUpMovesOnlyOwnWorktree.property.test.js) reuses
// the fixture rather than copying it.
module.exports = { registerSteps, fixture: { makeFixture, git, state, backupRefs, parcelCommit, writeHandoff, runReceive, MAILBOX_NEW } };
