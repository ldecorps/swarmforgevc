'use strict';

// BL-1611: step handlers for "the worktree-drift guard sees a batch role's
// in-process parcel". Drives the REAL ready_for_next.bb pre-turn guard
// against a real git fixture (git init/worktree/branch, no mocked git) -
// same established pattern as bl1195WorktreeTrackedContentDriftSteps.js and
// bl1515BranchIdentityGuardSteps.js, because the guard's own contract is
// entirely about real working-tree and mailbox state, which no stub can
// stand in for honestly.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = "BL-1611 The worktree-drift guard sees a batch role's in-process parcel";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const REAL_READY_FOR_NEXT = path.join(REAL_SCRIPTS_DIR, 'ready_for_next.bb');

const DRIFT_REL = 'swarmforge/scripts/fixture-drift-marker.txt';

function gitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'pipe'], env: gitEnv() });
}

function installScripts(wt) {
  const dest = path.join(wt, 'swarmforge', 'scripts');
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(REAL_SCRIPTS_DIR)) {
    if (name.endsWith('.bb') || name.endsWith('.sh')) {
      fs.copyFileSync(path.join(REAL_SCRIPTS_DIR, name), path.join(dest, name));
    }
  }
}

function ensureInbox(wt) {
  const inbox = path.join(wt, '.swarmforge', 'handoffs', 'inbox');
  for (const sub of ['new', 'in_process', 'completed']) {
    fs.mkdirSync(path.join(inbox, sub), { recursive: true });
  }
  return inbox;
}

function writeRolesTsv(dir, line) {
  fs.mkdirSync(path.join(dir, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.swarmforge', 'roles.tsv'), line);
  fs.writeFileSync(path.join(dir, '.swarmforge', 'swarm-identity'), 'swarm_name\tprimary\nswarm_mode\tautonomous\n');
}

// Roster: architect (task role, own worktree), hardender (batch role, own
// worktree), specifier (master-resident row sharing the root worktree) -
// exactly the three rows the Background names.
function mkFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1611-aps-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, DRIFT_REL), 'ORIGINAL: known-good content\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.swarmforge/\n');
  git(root, ['add', DRIFT_REL, '.gitignore']);
  git(root, ['commit', '-q', '-m', 'base']);
  git(root, ['branch', 'swarmforge-architect']);
  git(root, ['branch', 'swarmforge-hardender']);

  const architectWt = path.join(root, '.worktrees', 'architect');
  const hardenderWt = path.join(root, '.worktrees', 'hardender');
  git(root, ['worktree', 'add', '-q', architectWt, 'swarmforge-architect']);
  git(root, ['worktree', 'add', '-q', hardenderWt, 'swarmforge-hardender']);

  // The master-resident row (specifier) shares the root worktree itself -
  // it never gets its own .worktrees/ checkout (BL-1515's own established
  // shape).
  installScripts(root);
  installScripts(architectWt);
  installScripts(hardenderWt);

  const architectInbox = ensureInbox(architectWt);
  const hardenderInbox = ensureInbox(hardenderWt);

  // roles.tsv: role, worktree-name, worktree-path, session, display, agent,
  // receive-mode. "guard-boundary-only" is not a recognized receive mode -
  // dispatch_lib.bb's run-dispatch! fails closed with its own
  // INVALID_RECEIVE_MODE once a turn reaches it, proving control passed
  // every pre-turn guard without ever exec'ing the real dispatcher (same
  // technique bl1195/bl1515's own fixtures use).
  const rolesLine = [
    `architect\tarchitect\t${architectWt}\tswarmforge-architect\tArchitect\tclaude\tguard-boundary-only`,
    `hardender\thardender\t${hardenderWt}\tswarmforge-hardender\tHardender\tclaude\tguard-boundary-only`,
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\tguard-boundary-only`,
  ].join('\n') + '\n';

  // Written into every worktree's own .swarmforge/ - dispatch-lib/git-root
  // resolves to the WORKTREE's own toplevel for a linked worktree, which is
  // what this guard reads role-info through, so only writing the root copy
  // would silently make architect/hardender find no roles.tsv row and skip
  // themselves on every scenario.
  for (const dir of [root, architectWt, hardenderWt]) {
    writeRolesTsv(dir, rolesLine);
  }

  ctx.root = root;
  ctx.worktrees = {
    architect: architectWt,
    hardender: hardenderWt,
    specifier: root,
  };
  ctx.inboxes = { architect: architectInbox, hardender: hardenderInbox };
  return root;
}

function cleanup(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = undefined;
  }
}

function runReady(ctx, role) {
  const wt = ctx.worktrees[role];
  const readyPath = path.join(wt, 'swarmforge', 'scripts', 'ready_for_next.bb');
  const env = { ...gitEnv(), SWARMFORGE_ROLE: role };
  const result = spawnSync('bb', [readyPath], { cwd: wt, env, encoding: 'utf8' });
  ctx.rc = result.status;
  ctx.stdout = result.stdout || '';
  ctx.stderr = result.stderr || '';
}

function inProcessDirFor(ctx, role) {
  const wt = ctx.worktrees[role];
  return path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'in_process');
}

function writeParcel(file, role, type) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [`id: resume1`, 'from: specifier', `to: ${role}`, `recipient: ${role}`, 'priority: 00', `type: ${type}`];
  if (type === 'git_handoff') {
    lines.push('task: BL-000-demo', 'commit: 0000000000');
  } else {
    lines.push('message: resume');
  }
  lines.push('', 'body');
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture swarm root whose roles table declares architect as a task role with its own worktree, hardender as a batch role with its own worktree, and specifier as a master-resident row, each worktree with one tracked file$/,
    (ctx) => {
      mkFixture(ctx);
    }
  );

  scoped(/^the (\S+) worktree's tracked file is modified against its HEAD$/, (ctx, role) => {
    const wt = ctx.worktrees[role];
    fs.writeFileSync(path.join(wt, DRIFT_REL), 'DRIFTED: no commit authored this\n');
  });

  scoped(/^the (\S+)'s in_process box holds (.+)$/, (ctx, role, holding) => {
    const inProcess = inProcessDirFor(ctx, role);
    if (holding === 'a batch directory with one git_handoff parcel inside it') {
      writeParcel(path.join(inProcess, 'batch_20260917T000000Z_000001', '00_parcel.handoff'), role, 'git_handoff');
    } else if (holding === 'one git_handoff parcel') {
      writeParcel(path.join(inProcess, '00_parcel.handoff'), role, 'git_handoff');
    } else if (holding === 'nothing') {
      // The fixture's own base state IS this - nothing to do. A
      // master-resident role (specifier) has no in_process directory at
      // all, which is itself "nothing".
    } else {
      throw new Error(`unrecognized holding: ${holding}`);
    }
  });

  scoped(/^the (\S+) runs ready_for_next$/, (ctx, role) => {
    try {
      runReady(ctx, role);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the turn is (.+)$/, (ctx, outcome) => {
    try {
      if (outcome === 'not refused as drift') {
        assert.ok(
          !/WORKTREE_DRIFT_DETECTED/.test(ctx.stderr),
          `expected no drift refusal, got rc=${ctx.rc} stdout=${ctx.stdout} stderr=${ctx.stderr}`
        );
        assert.match(
          ctx.stderr,
          /INVALID_RECEIVE_MODE/,
          `expected control to reach dispatch, got rc=${ctx.rc} stdout=${ctx.stdout} stderr=${ctx.stderr}`
        );
      } else if (outcome === 'refused as WORKTREE_DRIFT_DETECTED naming the file') {
        assert.notEqual(ctx.rc, 0, `expected a non-zero exit refusing the turn, got rc=${ctx.rc} stdout=${ctx.stdout}`);
        assert.match(ctx.stderr, /WORKTREE_DRIFT_DETECTED/);
        assert.match(ctx.stderr, new RegExp(DRIFT_REL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.ok(!/^TASK:/m.test(ctx.stdout), `expected no task to print on a refused turn, got: ${ctx.stdout}`);
      } else {
        throw new Error(`unrecognized outcome: ${outcome}`);
      }
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the source of swarmforge\/scripts\/ready_for_next\.bb is read$/, (ctx) => {
    ctx.source = fs.readFileSync(REAL_READY_FOR_NEXT, 'utf8');
  });

  scoped(/^the in-process check the drift guard uses reads the box through the batch-aware reader$/, (ctx) => {
    assert.ok(
      ctx.source.includes('handoff-files-with-batches (handoff-lib/my-mailbox-dir :in_process)'),
      'expected the drift guard to reach handoff-files-with-batches for its in-process check'
    );
  });

  scoped(/^no flat in_process read remains in that file$/, (ctx) => {
    assert.ok(
      !ctx.source.includes('my-handoff-files (handoff-lib/my-mailbox-dir :in_process)'),
      'expected no flat in_process read in ready_for_next.bb'
    );
  });
}

module.exports = { registerSteps };
