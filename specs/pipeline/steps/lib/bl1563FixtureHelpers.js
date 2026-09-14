'use strict';

// BL-1563 fixture and CLI-invocation helpers for
// bl1563SwarmStampRouterTargetSteps.js. Split out (cleaner pass) so the step
// file holds only Gherkin step bindings; this module holds fixture
// construction and the two real-CLI invocation wrappers it drives.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const RESOLVE_CLI = path.join(__dirname, 'bl1563ResolveEmptyMailboxTargetCli.bb');
const ROWS_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'mono_router_rows_cli.bb');

function git(...args) {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });
}

function runResolveCli(argsObj) {
  const out = execFileSync('bb', [RESOLVE_CLI, JSON.stringify(argsObj)], { encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
}

// ── Scenario 04/05 fixture helpers ───────────────────────────────────────

const MAILBOX_STATES = ['new', 'in_process', 'completed', 'abandoned'];

function proveFixtureIsolated(root) {
  // BL-1390: a fresh mkdtemp dir, `git init` here can never touch the live
  // checkout - proven BEFORE any mutating git command.
  const commonDir = execFileSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
  assert.ok(
    path.resolve(root, commonDir).startsWith(root),
    `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
  );
}

function mkMailboxDirs(base) {
  for (const state of MAILBOX_STATES) {
    fs.mkdirSync(path.join(base, '.swarmforge', 'handoffs', 'inbox', state), { recursive: true });
  }
}

function mkMasterRoleMailboxDirs(root, role) {
  for (const state of MAILBOX_STATES) {
    fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', role, 'inbox', state), { recursive: true });
  }
}

function writeConfAndIdentity(root, confLines) {
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  const confPath = path.join(root, 'swarmforge', 'swarmforge.conf');
  fs.writeFileSync(confPath, confLines.join('\n') + '\n');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'swarm-identity'), `active_backlog_max_depth_conf_path\t${confPath}\n`);
}

function initFixtureRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init', '-q', root]);
  proveFixtureIsolated(root);
  execFileSync('git', ['-C', root, '-c', 'user.email=test@test', '-c', 'user.name=test', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return root;
}

// Scenario 04: the two-master-rows fixture (BL-1557's scenario 03 shape).
// specifier and coordinator share the master checkout (worktree-name
// "master", worktree-path = root); coder/cleaner/architect/hardender/QA get
// plain directories (never `cd`-ed into, so no real worktree is needed);
// documenter gets a REAL linked worktree, since its own dispatcher process
// is invoked from inside it and must see git-common-dir resolve to root.
function mkMasterRowsFixture() {
  const root = initFixtureRoot('bl1563-master-');

  for (const role of ['specifier', 'coordinator']) {
    mkMasterRoleMailboxDirs(root, role);
  }

  const plainWorktrees = {};
  for (const role of ['coder', 'cleaner', 'architect', 'hardender', 'QA']) {
    const wt = path.join(root, '.plain', role);
    mkMailboxDirs(wt);
    plainWorktrees[role] = wt;
  }

  const docWt = path.join(root, '.worktrees', 'documenter');
  execFileSync('git', ['-C', root, 'worktree', 'add', '-q', '-b', 'documenter', docWt]);
  mkMailboxDirs(docWt);

  writeConfAndIdentity(root, ['config rotation router', 'config rotation_home coder']);

  const receiveMode = { cleaner: 'batch', hardender: 'batch' };
  const rows = [
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask`,
    `coder\tcoder\t${plainWorktrees.coder}\tswarmforge-coder\tCoder\tclaude\ttask`,
    `cleaner\tcleaner\t${plainWorktrees.cleaner}\tswarmforge-cleaner\tCleaner\tclaude\t${receiveMode.cleaner}`,
    `architect\tarchitect\t${plainWorktrees.architect}\tswarmforge-architect\tArchitect\tclaude\ttask`,
    `hardender\thardender\t${plainWorktrees.hardender}\tswarmforge-hardender\tHardender\tclaude\t${receiveMode.hardender}`,
    `documenter\tdocumenter\t${docWt}\tswarmforge-documenter\tDocumenter\tclaude\ttask`,
    `QA\tQA\t${plainWorktrees.QA}\tswarmforge-QA\tQA\tclaude\ttask`,
    `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask`,
  ];
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), rows.join('\n') + '\n');

  // The specifier's role-keyed inbox holds an in_process note - the only
  // actionable mailbox anywhere in this fixture.
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'handoffs', 'specifier', 'inbox', 'in_process', '00_stampnote.handoff'),
    'id: stampnote\nfrom: coordinator\nto: specifier\npriority: 00\ntype: note\nmessage: adjudicate\n\nbody\n'
  );

  return { root, docWt };
}

function snapshotSharedMailboxes(root) {
  const base = path.join(root, '.swarmforge', 'handoffs');
  const rows = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        rows.push({ path: path.relative(base, full), content: fs.readFileSync(full, 'utf8') });
      }
    }
  }
  walk(base);
  return rows;
}

// Scenario 05 fixtures.

function mkRowsCliFixture(roles) {
  const root = initFixtureRoot('bl1563-rowscli-');
  writeConfAndIdentity(root, ['config rotation router']);
  const worktrees = {};
  for (const role of roles) {
    const wt = path.join(root, '.plain', role);
    mkMailboxDirs(wt);
    worktrees[role] = wt;
  }
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    roles.map((role) => `${role}\t${role}\t${worktrees[role]}\t${role}-session\t${role}\tclaude\ttask`).join('\n') + '\n'
  );
  return { root, worktrees };
}

function mkFixtureWithPriorityZeroHandoffAtHardender() {
  const { root, worktrees } = mkRowsCliFixture(['coder', 'hardender']);
  const nowIso = new Date().toISOString();
  fs.writeFileSync(
    path.join(worktrees.hardender, '.swarmforge', 'handoffs', 'inbox', 'new', '00_rows05a.handoff'),
    `id: rows05a\nfrom: cleaner\nto: hardender\npriority: 00\ntype: git_handoff\ntask: bl-fixture\ncommit: 0123456789\ncreated_at: ${nowIso}\n\nmerge_and_process cleaner 0123456789\n`
  );
  return root;
}

function mkFixtureWithOnlyAFreshNote() {
  const { root, worktrees } = mkRowsCliFixture(['coder']);
  const nowIso = new Date().toISOString();
  fs.writeFileSync(
    path.join(worktrees.coder, '.swarmforge', 'handoffs', 'inbox', 'new', '10_rows05b.handoff'),
    `id: rows05b\nfrom: coordinator\nto: coder\npriority: 10\ntype: note\nmessage: fresh broadcast\ncreated_at: ${nowIso}\n\nbody\n`
  );
  return root;
}

function runRowsCli(args) {
  try {
    const stdout = execFileSync('bb', [ROWS_CLI, ...args], { encoding: 'utf8' });
    return { stdout, stderr: '', status: 0 };
  } catch (e) {
    return {
      stdout: e.stdout ? e.stdout.toString() : '',
      stderr: e.stderr ? e.stderr.toString() : '',
      status: typeof e.status === 'number' ? e.status : 1,
    };
  }
}

module.exports = {
  REPO_ROOT,
  git,
  runResolveCli,
  proveFixtureIsolated,
  mkMailboxDirs,
  mkMasterRoleMailboxDirs,
  writeConfAndIdentity,
  initFixtureRoot,
  mkMasterRowsFixture,
  snapshotSharedMailboxes,
  mkRowsCliFixture,
  mkFixtureWithPriorityZeroHandoffAtHardender,
  mkFixtureWithOnlyAFreshNote,
  runRowsCli,
};
