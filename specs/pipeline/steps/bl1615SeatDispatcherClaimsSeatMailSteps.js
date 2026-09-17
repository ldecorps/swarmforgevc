'use strict';

// BL-1615: step handlers for "A seat's dispatcher claims the mail addressed
// to that seat". Follows bl983StageQueueSteps.js's own convention (the
// ticket's own direction: extend BL-983's handler fixture) - every
// scenario drives the REAL ready_for_next_task.bb over a fixture roster,
// never a reimplementation of the claim path. A "non-forwarding git_handoff
// copy" or a coordinator "branch behind" note is written straight into its
// recipient's own new/ (handoff_inject_lib.bb's own delivery target for
// seat-addressed mail - unchanged by this ticket, so a real send is not
// needed to reproduce the shape it delivers).
//
// Invariant 1 (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');
const { sendGitHandoffTwoCall } = require('./lib/sendGitHandoffTwoCall');

const FEATURE = "BL-1615 A seat's dispatcher claims the mail addressed to that seat";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const STAGE = 'coder';
const SEAT2 = 'coder@2';

function safeName(role) {
  return role.replace('@', '-');
}

// Task-mode roles (coder, coder@2, cleaner) each get their own worktree
// subdirectory; master-resident roles (specifier, coordinator, scenario
// 03's second row) share ctx.root ITSELF - roleRoot resolves either shape.
function roleRoot(ctx, role) {
  return ctx.masterResidentRoles && ctx.masterResidentRoles.has(role) ? ctx.root : path.join(ctx.root, safeName(role));
}

function mkFixture(ctx) {
  const root = mkSocketFixtureRoot('bl1615-acc-');
  ctx.root = root;
  ctx.masterResidentRoles = new Set();
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git(['init', '-q', '.']);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'active', 'F.yaml'), 'id: F\n');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const roles = ['specifier', STAGE, SEAT2, 'cleaner'];
  for (const r of roles) fs.mkdirSync(path.join(root, safeName(r)), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    roles.map((r) => `${r}\t${safeName(r)}-wt\t${path.join(root, safeName(r))}\tswarmforge-${r}\t${r}\tclaude\ttask`).join('\n') + '\n'
  );
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'tmux'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(root, 'bin', 'tmux'), 0o755);
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
  git(['add', '-A']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed']);
  ctx.commit = git(['rev-parse', '--short=10', 'HEAD']).trim();
}

function fixtureEnv(ctx, role) {
  return { PATH: `${path.join(ctx.root, 'bin')}:${process.env.PATH}`, HOME: process.env.HOME, SWARMFORGE_ROLE: role };
}

// Mirrors handoff_lib.bb's mailbox-base-dir exactly: a master-resident role
// (worktree-name "master") gets an extra <role> subdirectory under the
// shared checkout's .swarmforge/handoffs/, since only master-resident rows
// share one physical checkout; every other role's own dedicated worktree
// keeps the flat layout.
function mailboxBase(ctx, role) {
  const root = roleRoot(ctx, role);
  return ctx.masterResidentRoles && ctx.masterResidentRoles.has(role)
    ? path.join(root, '.swarmforge', 'handoffs', role)
    : path.join(root, '.swarmforge', 'handoffs');
}

function newDir(ctx, role) {
  return path.join(mailboxBase(ctx, role), 'inbox', 'new');
}

function inProcessDir(ctx, role) {
  return path.join(mailboxBase(ctx, role), 'inbox', 'in_process');
}

function listHandoffs(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.handoff')) : [];
}

function inProcess(ctx, role) {
  return listHandoffs(inProcessDir(ctx, role));
}

function newFiles(ctx, role) {
  return listHandoffs(newDir(ctx, role));
}

function sendGitHandoff(ctx, task, to) {
  const draft = path.join(roleRoot(ctx, 'specifier'), `d-${task}.txt`);
  fs.writeFileSync(draft, `type: git_handoff\nto: ${to}\npriority: 50\ntask: ${task}\ncommit: ${ctx.commit}\n`);
  const res = sendGitHandoffTwoCall('bb', [path.join(SCRIPTS_DIR, 'swarm_handoff.bb'), draft], {
    cwd: roleRoot(ctx, 'specifier'),
    encoding: 'utf8',
    timeout: 60000,
    env: fixtureEnv(ctx, 'specifier'),
  });
  assert.equal(res.status, 0, `send of ${task} failed: ${res.stdout}${res.stderr}`);
}

// Writes a raw .handoff file straight into recipient's own new/ - the
// exact shape handoff_inject_lib.bb's target-path delivers a seat-addressed
// parcel into (unchanged by this ticket), so this reproduces it without a
// real reverse-hop/chase-sweep round trip.
function deliverToOwnBox(ctx, { basename, recipient, from = 'coordinator', priority = '00', type = 'git_handoff', nonForwarding = false, message }) {
  const dir = newDir(ctx, recipient);
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    `id: ${basename}`,
    `from: ${from}`,
    `to: ${recipient}`,
    `recipient: ${recipient}`,
    `priority: ${priority}`,
    `type: ${type}`,
  ];
  if (type === 'git_handoff') {
    lines.push(`role: ${from}`, `task: ${basename}`, `commit: ${ctx.commit}`);
    if (nonForwarding) lines.push('non-forwarding: true');
  }
  if (message) lines.push(`message: ${message}`);
  const body = message || `merge_and_process ${from} ${ctx.commit}`;
  fs.writeFileSync(path.join(dir, `${basename}.handoff`), `${lines.join('\n')}\n\n${body}\n`);
  return `${basename}.handoff`;
}

function poll(ctx, role) {
  ctx.pollResult = spawnSync('bb', [path.join(SCRIPTS_DIR, 'ready_for_next_task.bb')], {
    cwd: roleRoot(ctx, role),
    encoding: 'utf8',
    timeout: 60000,
    env: fixtureEnv(ctx, role),
  });
  return ctx.pollResult;
}

function cleanup(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = null;
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a stage with two seats, coder and coder@2, each booted with its own worktree and mailbox$/, (ctx) => {
    mkFixture(ctx);
  });
  scoped(/^the stage queue is the coder seat's new\/$/, () => {
    // BL-983's own resolution (stage-queue-dir falls back to my-mailbox-dir
    // when stage === me): true by construction of the roles.tsv row for
    // 'coder' - nothing further to set up.
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^a (git_handoff|non-forwarding git_handoff copy|note) addressed to (coder|coder@2) is delivered$/, (ctx, kind, recipient) => {
    if (kind === 'git_handoff') {
      sendGitHandoff(ctx, 'BL-9001-bl1615', recipient);
      ctx.deliveredBasename = newFiles(ctx, STAGE)[0];
      ctx.expectedFrom = 'stage-queue';
    } else if (kind === 'non-forwarding git_handoff copy') {
      ctx.deliveredBasename = deliverToOwnBox(ctx, {
        basename: '00_bl1615_copy',
        recipient,
        from: 'architect',
        nonForwarding: true,
      });
      ctx.expectedFrom = 'own-box';
    } else {
      ctx.deliveredBasename = deliverToOwnBox(ctx, {
        basename: '00_bl1615_note',
        recipient,
        from: 'coordinator',
        type: 'note',
        message: `branch behind ${ctx.commit}: dirty worktree - merge up`,
      });
      ctx.expectedFrom = 'own-box';
    }
    ctx.recipient = recipient;
  });

  scoped(/^seat (coder|coder@2) asks for its next task$/, (ctx, asking) => {
    ctx.asking = asking;
    poll(ctx, asking);
  });

  scoped(/^the file (is claimed from the stage queue|is claimed from the seat's own new\/|is not listed and NO_TASK is printed)$/, (ctx, outcome) => {
    try {
      if (outcome === 'is claimed from the stage queue') {
        assert.ok(
          inProcess(ctx, ctx.asking).includes(ctx.deliveredBasename),
          `expected ${ctx.asking} to hold ${ctx.deliveredBasename}: ${inProcess(ctx, ctx.asking)}`
        );
        assert.ok(!newFiles(ctx, STAGE).includes(ctx.deliveredBasename), 'expected the stage queue drained of the claimed file');
      } else if (outcome === "is claimed from the seat's own new/") {
        assert.ok(
          inProcess(ctx, ctx.asking).includes(ctx.deliveredBasename),
          `expected ${ctx.asking} to hold ${ctx.deliveredBasename}: ${inProcess(ctx, ctx.asking)}`
        );
        assert.ok(
          !newFiles(ctx, ctx.recipient).includes(ctx.deliveredBasename),
          "expected the seat's own new/ drained of the claimed file"
        );
      } else {
        const out = `${ctx.pollResult.stdout || ''}${ctx.pollResult.stderr || ''}`;
        assert.match(out, /NO_TASK/, `expected NO_TASK, got: ${out}`);
        assert.deepEqual(inProcess(ctx, ctx.asking), [], `expected ${ctx.asking} to have claimed nothing`);
        assert.ok(
          newFiles(ctx, ctx.recipient).includes(ctx.deliveredBasename),
          "expected the seat-addressed file to remain in the recipient's own new/, untouched"
        );
      }
    } finally {
      cleanup(ctx);
    }
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^a priority-10 note addressed to coder sits in the stage queue$/, (ctx) => {
    ctx.stageBasename = deliverToOwnBox(ctx, {
      basename: '10_bl1615_stage_note',
      recipient: STAGE,
      from: 'coordinator',
      priority: '10',
      type: 'note',
      message: 'a lower-priority stage note',
    });
  });
  scoped(/^a priority-00 non-forwarding git_handoff copy addressed to coder@2 sits in the seat's own new\/$/, (ctx) => {
    ctx.seatBasename = deliverToOwnBox(ctx, {
      basename: '00_bl1615_seat_copy',
      recipient: SEAT2,
      from: 'architect',
      priority: '00',
      nonForwarding: true,
    });
  });
  scoped(/^seat coder@2 asks for its next task$/, (ctx) => {
    poll(ctx, SEAT2);
  });
  scoped(/^the priority-00 copy is claimed first$/, (ctx) => {
    try {
      assert.deepEqual(
        inProcess(ctx, SEAT2),
        [ctx.seatBasename],
        `expected the priority-00 seat copy claimed first: ${inProcess(ctx, SEAT2)}`
      );
      assert.ok(newFiles(ctx, STAGE).includes(ctx.stageBasename), 'expected the priority-10 stage note to stay queued');
    } finally {
      cleanup(ctx);
    }
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^a roster with a bare single-seat code role with its own worktree$/, (ctx) => {
    ctx.rosterRole = 'cleaner'; // already a bare single-seat row from mkFixture.
  });
  scoped(
    /^a roster with two master-resident rows sharing one checkout path with different session values$/,
    (ctx) => {
      // mkFixture's base roster already carries a task-worktree row for
      // 'specifier' (used as the sender identity in scenarios 01/02) -
      // replaced here, not appended to, so load-role-info resolves exactly
      // one row for 'specifier' (the master-resident one this scenario
      // needs), never an ambiguous first-match over two.
      const rolesPath = path.join(ctx.root, '.swarmforge', 'roles.tsv');
      const kept = fs
        .readFileSync(rolesPath, 'utf8')
        .split('\n')
        .filter((line) => line.trim() && !line.startsWith('specifier\t'));
      const line =
        `specifier\tmaster\t${ctx.root}\tswarmforge-specifier\tSpecifier\tclaude\tguard-boundary-only\n` +
        `coordinator\tmaster\t${ctx.root}\tswarmforge-coordinator\tCoordinator\tclaude\tguard-boundary-only\n`;
      fs.writeFileSync(rolesPath, kept.join('\n') + '\n' + line);
      ctx.masterResidentRoles.add('specifier');
      ctx.masterResidentRoles.add('coordinator');
      ctx.rosterRole = 'specifier';
    }
  );
  scoped(/^one note addressed to (cleaner|specifier) sits in its new\/$/, (ctx, role) => {
    ctx.rosterBasename = deliverToOwnBox(ctx, {
      basename: `00_bl1615_roster_${safeName(role)}`,
      recipient: role,
      from: 'coordinator',
      type: 'note',
      message: `Work BL-9002: read backlog/active`,
    });
    ctx.preClaimNewCount = newFiles(ctx, role).length;
  });
  scoped(/^seat (cleaner|specifier) asks for its next task$/, (ctx, role) => {
    poll(ctx, role);
  });
  scoped(/^exactly one candidate is offered and it is claimed$/, (ctx) => {
    assert.deepEqual(
      inProcess(ctx, ctx.rosterRole),
      [ctx.rosterBasename],
      `expected ${ctx.rosterRole} to hold exactly the one candidate: ${inProcess(ctx, ctx.rosterRole)}`
    );
  });
  scoped(/^the mailbox is unchanged apart from that claim$/, (ctx) => {
    try {
      assert.deepEqual(newFiles(ctx, ctx.rosterRole), [], "expected the role's own new/ drained of the one file");
      assert.equal(inProcess(ctx, ctx.rosterRole).length, 1, 'expected exactly one in-process file, nothing duplicated');
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
