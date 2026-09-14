'use strict';

// BL-1563: BL-848 stamp-off review of hotfix 0b727b286c, "idle resident
// with no parcel to follow rotates to the router's own next target instead
// of hopping home."
//
// This CONFIRMS OR REFUTES what landed. It reimplements nothing, changes no
// hotfix source line, and writes nothing to the ledger (invariant + the
// ticket's FIRM constraints). Scenario 01 EXECUTES the real
// mono-router-lib/resolve-empty-mailbox-target through
// lib/bl1563ResolveEmptyMailboxTargetCli.bb (the BL-1321 shape) - a
// source-text assertion cannot tell a wired decision from a dead one.
// Scenarios 02/03 execute the real shell tests as subprocesses. Scenario 04
// executes the real ready_for_next_task.bb dispatcher against a real fixture
// git checkout. Scenario 05 executes the real mono_router_rows_cli.bb.
// Scenario 06 reads (never writes) the hotfix ledger.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1563 Stamp-off review of the idle-resident-asks-the-router hotfix';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HOTFIX = '0b727b286c';
const RESOLVE_CLI = path.join(__dirname, 'lib', 'bl1563ResolveEmptyMailboxTargetCli.bb');
const READY_TASK = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'ready_for_next_task.bb');
const ROWS_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'mono_router_rows_cli.bb');
const ROTATE_HOME_TEST = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_ready_for_next_rotate_home.sh');
const WIRING_TEST = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_handoffd_priority_rotate_wiring.sh');
const LEDGER = path.join(REPO_ROOT, 'backlog', 'hotfix-ledger.yaml');

function git(...args) {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });
}

// ── Scenario 01 KNOWN_VALUES ─────────────────────────────────────────────

const KNOWN_ROLES = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA', 'coordinator'];
const KNOWN_ROUTER_VALUES = [...KNOWN_ROLES, 'none', 'art-director'];
const KNOWN_REASONS = [
  'forward-recipient',
  'policy-home',
  'recipient-is-home',
  'recipient-not-holding',
  'no-recipient',
  'forward-recipient-undelivered',
  'router-preferred',
];

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

// Scenario 04: the two-master-rows fixture (BL-1557 scenario 03's shape).
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

const KNOWN_ROWS_CLI_ARGS = {
  'the fixture root holding a priority-00 git_handoff at hardender': () => [mkFixtureWithPriorityZeroHandoffAtHardender()],
  'the fixture root holding only a fresh note': () => [mkFixtureWithOnlyAFreshNote()],
  'no argument': () => [],
};

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

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────

  scoped(
    /^a rotation-router pack whose home role is (\S+) and whose roles\.tsv names (.+)$/,
    (ctx, homeRole, roleList) => {
      ctx.bl1563 = ctx.bl1563 ?? {};
      const roles = roleList
        .split(/,| and /)
        .map((s) => s.trim())
        .filter(Boolean);
      assert.deepEqual(roles, KNOWN_ROLES, `background roster drifted from expectation, got: ${JSON.stringify(roles)}`);
      ctx.bl1563.homeRole = homeRole;
      ctx.bl1563.knownRoles = roles;
    }
  );

  // ── Scenario 01 ────────────────────────────────────────────────────────

  scoped(
    /^the departing role (\S+), whose forward decision is (\S+) for reason (\S+), and the router's preferred mailbox is (\S+)$/,
    (ctx, departingRole, forwardTarget, forwardReason, router) => {
      ctx.bl1563 = ctx.bl1563 ?? {};
      assert.ok(KNOWN_ROLES.includes(departingRole), `unknown departing role "${departingRole}"`);
      assert.ok(KNOWN_ROLES.includes(forwardTarget), `unknown forward target "${forwardTarget}"`);
      assert.ok(KNOWN_REASONS.includes(forwardReason), `unknown forward reason "${forwardReason}"`);
      assert.ok(KNOWN_ROUTER_VALUES.includes(router), `unknown router value "${router}"`);
      ctx.bl1563.departingRole = departingRole;
      ctx.bl1563.forwardTarget = forwardTarget;
      ctx.bl1563.forwardReason = forwardReason;
      ctx.bl1563.router = router;
    }
  );

  scoped(/^the empty-mailbox target is resolved$/, (ctx) => {
    const result = runResolveCli({
      forwardTarget: ctx.bl1563.forwardTarget,
      forwardReason: ctx.bl1563.forwardReason,
      homeRole: ctx.bl1563.homeRole,
      role: ctx.bl1563.departingRole,
      routerPreferred: ctx.bl1563.router,
      knownRoles: ctx.bl1563.knownRoles,
    });
    ctx.bl1563.result = result;
  });

  scoped(/^the target is (\S+) for reason (\S+)$/, (ctx, target, reason) => {
    assert.ok(KNOWN_ROLES.includes(target), `unknown expected target "${target}"`);
    assert.ok(KNOWN_REASONS.includes(reason), `unknown expected reason "${reason}"`);
    assert.equal(ctx.bl1563.result.target, target);
    assert.equal(ctx.bl1563.result.reason, reason);
  });

  // ── Scenario 02 ────────────────────────────────────────────────────────

  scoped(/^the rotate-home shell test runs against the real ready_for_next dispatchers and wrapper$/, (ctx) => {
    ctx.bl1563 = ctx.bl1563 ?? {};
    ctx.bl1563.shellKind = 'rotate-home';
    ctx.bl1563.shellStdout = execFileSync('bash', [ROTATE_HOME_TEST], { encoding: 'utf8' });
  });

  // ── Scenario 03 ────────────────────────────────────────────────────────

  scoped(/^the handoffd priority-rotate wiring shell test runs$/, (ctx) => {
    ctx.bl1563 = ctx.bl1563 ?? {};
    ctx.bl1563.shellKind = 'wiring';
    ctx.bl1563.shellStdout = execFileSync('bash', [WIRING_TEST], { encoding: 'utf8' });
    ctx.bl1563.shellSource = fs.readFileSync(WIRING_TEST, 'utf8');
  });

  // ── Scenario 02/03 shared "Then" wording ────────────────────────────────

  scoped(/^it reports every check passed$/, (ctx) => {
    if (ctx.bl1563.shellKind === 'rotate-home') {
      assert.match(ctx.bl1563.shellStdout, /test_ready_for_next_rotate_home: ALL CHECKS PASSED/);
    } else if (ctx.bl1563.shellKind === 'wiring') {
      assert.match(ctx.bl1563.shellStdout, /ALL PASS: test_handoffd_priority_rotate_wiring\.sh/);
    } else {
      throw new Error(`unknown shell kind: ${ctx.bl1563.shellKind}`);
    }
  });

  scoped(/^its passing checks include cases 16 through 20, the five the hotfix added$/, (ctx) => {
    const expected = [
      'PASS: 16: with no parcel to follow, the resident rotates to the router\'s preferred mailbox',
      'PASS: 17: a fresh note is not actionable, so the fallback is still home',
      'PASS: 18: an aged note is actionable and the resident goes straight to it',
      'PASS: 19: mono_router_rows_cli.bb prints the router\'s target, or none',
      'PASS: 20: batch-mode role with no parcel to follow rotates to the router\'s preferred mailbox',
    ];
    for (const line of expected) {
      assert.ok(ctx.bl1563.shellStdout.includes(line), `expected passing-check line missing: ${line}`);
    }
  });

  scoped(
    /^its source compares mono_router_rows_cli\.bb against the daemon's printed target on all four fixtures A through D$/,
    (ctx) => {
      for (const letter of ['A', 'B', 'C', 'D']) {
        const needle = `${letter}: mono_router_rows_cli.bb drifted from handoffd`;
        assert.ok(ctx.bl1563.shellSource.includes(needle), `expected fail-message literal missing: "${needle}"`);
      }
    }
  );

  // ── Scenario 04 ────────────────────────────────────────────────────────

  scoped(
    /^the specifier and coordinator rows share one master checkout, the specifier's role-keyed inbox holds an in_process note, and no other mailbox is actionable$/,
    (ctx) => {
      ctx.bl1563 = ctx.bl1563 ?? {};
      const { root, docWt } = mkMasterRowsFixture();
      ctx.bl1563.masterRoot = root;
      ctx.bl1563.docWt = docWt;
      ctx.bl1563.disposables = ctx.__disposables ?? [];
      ctx.__disposables = ctx.bl1563.disposables;
      ctx.bl1563.disposables.push(async () => fs.rmSync(root, { recursive: true, force: true }));
      ctx.bl1563.sharedBefore = snapshotSharedMailboxes(root);
    }
  );

  scoped(/^the documenter's task dispatcher finds its mailbox empty with no parcel to follow$/, (ctx) => {
    ctx.bl1563.dispatchOut = execFileSync('bb', [READY_TASK], {
      cwd: ctx.bl1563.docWt,
      encoding: 'utf8',
      env: { ...process.env, SWARMFORGE_ROLE: 'documenter' },
    });
  });

  scoped(/^it prints ROTATE_TO specifier for reason router-preferred$/, (ctx) => {
    assert.match(ctx.bl1563.dispatchOut, /^ROTATE_HOME$/m);
    assert.match(ctx.bl1563.dispatchOut, /^ROTATE_TO: specifier$/m);
    assert.match(ctx.bl1563.dispatchOut, /^ROTATE_REASON: router-preferred$/m);
  });

  scoped(/^every mailbox file on the shared checkout is unchanged$/, (ctx) => {
    const after = snapshotSharedMailboxes(ctx.bl1563.masterRoot);
    assert.deepEqual(after, ctx.bl1563.sharedBefore);
  });

  // ── Scenario 05 ────────────────────────────────────────────────────────

  scoped(/^the CLI is invoked with (.+)$/, (ctx, phrase) => {
    ctx.bl1563 = ctx.bl1563 ?? {};
    assert.ok(phrase in KNOWN_ROWS_CLI_ARGS, `unknown CLI-invocation phrase "${phrase}"`);
    const args = KNOWN_ROWS_CLI_ARGS[phrase]();
    ctx.bl1563.cliArgs = args;
    if (args.length) {
      ctx.bl1563.disposables = ctx.__disposables ?? [];
      ctx.__disposables = ctx.bl1563.disposables;
      const root = args[0];
      ctx.bl1563.disposables.push(async () => fs.rmSync(root, { recursive: true, force: true }));
    }
  });

  scoped(/^mono_router_rows_cli\.bb runs$/, (ctx) => {
    ctx.bl1563.cliResult = runRowsCli(ctx.bl1563.cliArgs);
  });

  scoped(/^it prints (\S+) and exits (\d+)$/, (ctx, output, exitStr) => {
    const exit = Number(exitStr);
    if (output === 'usage') {
      assert.equal(ctx.bl1563.cliResult.stdout.trim(), '');
      assert.match(ctx.bl1563.cliResult.stderr, /^Usage:/);
    } else {
      assert.equal(ctx.bl1563.cliResult.stdout.trim(), output);
    }
    assert.equal(ctx.bl1563.cliResult.status, exit);
  });

  // ── Scenario 06 ────────────────────────────────────────────────────────

  scoped(/^the review parcel completes$/, (ctx) => {
    ctx.bl1563 = ctx.bl1563 ?? {};
    ctx.bl1563.reviewComplete = true;
  });

  scoped(/^the ledger row for the reviewed commit carries no human decision$/, (ctx) => {
    assert.equal(ctx.bl1563.reviewComplete, true);
    const ledger = fs.readFileSync(LEDGER, 'utf8');
    const entry = ledger.split(/\n(?=-\s*commit:)/).find((block) => block.includes(`commit: ${HOTFIX}`));
    assert.ok(entry, `no hotfix-ledger entry for ${HOTFIX}`);
    // Undecided means: state is neither certified nor waived, human_decision
    // is null and decided_at is null. The row legitimately moves through
    // pending -> stamp-open while the parcel travels, so the literal state
    // pending is not asserted here (BL-1560 cleaner D1, 2026-09-14).
    assert.doesNotMatch(entry, /state:\s*(certified|waived)\b/, `a decided state appears on the row: ${entry}`);
    assert.match(entry, /human_decision:\s*null/, `ledger row already carries a human decision: ${entry}`);
    assert.match(entry, /decided_at:\s*null/, `a decision timestamp was written without a human: ${entry}`);
    assert.equal(
      git('status', '--porcelain', '--', 'backlog/hotfix-ledger.yaml').trim(),
      '',
      'a stamp-off review must never modify the hotfix ledger'
    );
  });
}

module.exports = { registerSteps, KNOWN_ROLES, KNOWN_REASONS };
