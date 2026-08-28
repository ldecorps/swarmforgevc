'use strict';

// BL-1219: step handlers for "role inbox resolution covers master-resident
// roles as well as worktree roles". Drives the REAL TypeScript resolver
// (buildRoleInboxes/mailboxDir, extension/out) and the REAL dead-letter
// notify sweep (notify-dead-letters.js, subprocess - same pattern as
// notifyDeadLettersCli.test.js) against real fixture roots, and compares
// against the REAL Babashka resolver (handoff-lib/mailbox-dir) via
// specs/pipeline/steps/lib/bl1219MailboxDirCli.bb - the exact function
// production delivery (handoff_inject_lib.bb's target-path) and the live
// daemon (handoffd.bb's role-inboxes-for-chase) both go through.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildRoleInboxes } = require('../../../extension/out/watchdog/chaserMonitor');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'role inbox resolution covers master-resident roles as well as worktree roles';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const MAILBOX_CLI = path.join(__dirname, 'lib', 'bl1219MailboxDirCli.bb');
const NOTIFY_CLI = path.join(REPO_ROOT, 'extension', 'out', 'tools', 'notify-dead-letters.js');

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function mkFixtureRoot() {
  const root = fs.realpathSync(mkSocketFixtureRoot('bl1219-acceptance-'));
  // notify-dead-letters.js's resolveCliMainWorktreeContext() resolves the
  // project root via git worktree/repo root - a real (if minimal) git repo
  // is required for the CLI to run at all, same as mailboxIntakeSteps.js's
  // own ensureTargetPath.
  git(root, ['init', '-q']);
  git(root, ['-c', 'user.email=bl1219@example.com', '-c', 'user.name=bl1219', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return root;
}

function cleanupFixtureRoot(ctx) {
  const st = ctx.bl1219;
  if (!st || !st.root) return;
  releaseSocketFixtureRoot(st.root);
  fs.rmSync(st.root, { recursive: true, force: true });
  ctx.bl1219 = null;
}

function writeRolesTsv(root, coderWorktree) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${coderWorktree}\tswarmforge-coder\tCoder\tclaude\ttask\n` +
      `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n`
  );
}

function babashkaMailboxDirs(root, roles) {
  const out = execFileSync('bb', [MAILBOX_CLI, root, roles.join(',')], { encoding: 'utf8' });
  const byRole = {};
  for (const line of out.trim().split('\n').filter(Boolean)) {
    const parsed = JSON.parse(line);
    byRole[parsed.role] = parsed;
  }
  return byRole;
}

function fossilInboxNewDir(root) {
  return path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new');
}

function writeDeadLetter(dir, basename, recipient) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, basename),
    `type: note\nrecipient: ${recipient}\ntask: BL-1219-acceptance\n`
  );
}

function bindOperatorTopicAndTelegram(root) {
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json'),
    JSON.stringify({ '777': 'OPERATOR' })
  );
}

function runNotifySweep(root) {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TELEGRAM_BOT_TOKEN: 'fake-token',
    TELEGRAM_CHAT_ID: 'fake-chat',
    TELEGRAM_NOTIFY_FORCE_RESULT: JSON.stringify({ success: true, messageId: 1 }),
  };
  const out = execFileSync('node', [NOTIFY_CLI], { cwd: root, encoding: 'utf8', env });
  return JSON.parse(out);
}

function readNotifyState(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, '.swarmforge', 'operator', 'dead-letter-notify-state.json'), 'utf8'));
  } catch {
    return { announcedFilePaths: [] };
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a roles table seating "coder" in its own worktree$/, (ctx) => {
    ctx.bl1219 = ctx.bl1219 || { root: mkFixtureRoot() };
    ctx.bl1219.coderWorktree = path.join(ctx.bl1219.root, '.worktrees', 'coder');
  });

  scoped(/^seating "coordinator" on master$/, (ctx) => {
    writeRolesTsv(ctx.bl1219.root, ctx.bl1219.coderWorktree);
  });

  // ── scenario 01: each role resolves to its real mailbox ─────────────────

  scoped(/^inbox resolution runs for "([^"]+)"$/, (ctx, role) => {
    const st = ctx.bl1219;
    st.role = role;
    [st.resolved] = buildRoleInboxes(st.root, [role]);
    assert.ok(st.resolved, `buildRoleInboxes returned nothing for role "${role}"`);
  });

  scoped(/^the resolved inbox is the one handoff delivery writes to for "([^"]+)"$/, (ctx, role) => {
    const st = ctx.bl1219;
    const bb = babashkaMailboxDirs(st.root, [role])[role];
    assert.equal(
      st.resolved.inboxNewDir,
      bb.new,
      `expected buildRoleInboxes to agree with handoff-lib/mailbox-dir (real delivery's own resolver) for "${role}"`
    );
  });

  scoped(/^the resolved inbox is not the shared root inbox directory$/, (ctx) => {
    const st = ctx.bl1219;
    try {
      assert.notEqual(st.resolved.inboxNewDir, fossilInboxNewDir(st.root));
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });

  // ── scenario 02/03: dead letter visibility per role shape ───────────────

  scoped(/^a dead-lettered handoff in the mailbox for "([^"]+)"$/, (ctx, role) => {
    const st = ctx.bl1219;
    st.role = role;
    const bb = babashkaMailboxDirs(st.root, [role])[role];
    writeDeadLetter(bb.new, '00_bl1219.handoff.dead', role);
    st.deadLetterPath = path.join(bb.new, '00_bl1219.handoff.dead');
    bindOperatorTopicAndTelegram(st.root);
  });

  scoped(/^the dead-letter notify sweep runs$/, (ctx) => {
    const st = ctx.bl1219;
    st.sweepResult = runNotifySweep(st.root);
  });

  scoped(/^the sweep reports that dead letter$/, (ctx) => {
    const st = ctx.bl1219;
    assert.equal(st.sweepResult.sent, true, `expected the sweep to announce a new dead letter, got: ${JSON.stringify(st.sweepResult)}`);
    assert.equal(st.sweepResult.newCount, 1);
  });

  scoped(/^it is either announced with a recorded reason or recorded as a named refusal$/, (ctx) => {
    const st = ctx.bl1219;
    try {
      const state = readNotifyState(st.root);
      assert.ok(
        state.announcedFilePaths.includes(st.deadLetterPath),
        `expected ${st.deadLetterPath} in the recorded announcedFilePaths, got: ${JSON.stringify(state.announcedFilePaths)}`
      );
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });

  // ── scenario 04: the fossil directory is nobody's mailbox ───────────────

  scoped(/^a stale dead-lettered handoff in the shared root inbox directory$/, (ctx) => {
    ctx.bl1219 = ctx.bl1219 || { root: mkFixtureRoot() };
    const st = ctx.bl1219;
    if (!st.coderWorktree) {
      st.coderWorktree = path.join(st.root, '.worktrees', 'coder');
      writeRolesTsv(st.root, st.coderWorktree);
    }
    writeDeadLetter(fossilInboxNewDir(st.root), '00_stale_fossil.handoff.dead', 'coordinator');
    bindOperatorTopicAndTelegram(st.root);
  });

  scoped(/^the sweep reports no dead letter from that directory$/, (ctx) => {
    const st = ctx.bl1219;
    try {
      assert.equal(st.sweepResult.sent, false, `expected no announcement from the fossil-only fixture, got: ${JSON.stringify(st.sweepResult)}`);
      assert.equal(st.sweepResult.reason, 'no-new-dead-letters');
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });

  // ── scenario 05: no duplicate announcement ───────────────────────────────

  scoped(/^the notify sweep has already announced it$/, (ctx) => {
    const st = ctx.bl1219;
    st.firstSweepResult = runNotifySweep(st.root);
    assert.equal(st.firstSweepResult.sent, true, `expected the first sweep to announce, got: ${JSON.stringify(st.firstSweepResult)}`);
  });

  scoped(/^the dead-letter notify sweep runs again$/, (ctx) => {
    const st = ctx.bl1219;
    st.sweepResult = runNotifySweep(st.root);
  });

  scoped(/^it is not announced a second time$/, (ctx) => {
    const st = ctx.bl1219;
    try {
      assert.equal(st.sweepResult.sent, false, `expected no re-announcement, got: ${JSON.stringify(st.sweepResult)}`);
      assert.equal(st.sweepResult.reason, 'no-new-dead-letters');
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });

  // ── scenario 06: the two language implementations agree ─────────────────

  scoped(/^inbox resolution runs for every role in the roles table$/, (ctx) => {
    ctx.bl1219 = ctx.bl1219 || { root: mkFixtureRoot() };
    const st = ctx.bl1219;
    if (!st.coderWorktree) {
      st.coderWorktree = path.join(st.root, '.worktrees', 'coder');
      writeRolesTsv(st.root, st.coderWorktree);
    }
    st.allRoles = ['coder', 'coordinator'];
    st.tsResolved = buildRoleInboxes(st.root, st.allRoles);
  });

  scoped(/^each resolved inbox matches the one the handoff daemon resolves for that role$/, (ctx) => {
    const st = ctx.bl1219;
    try {
      const bb = babashkaMailboxDirs(st.root, st.allRoles);
      for (const entry of st.tsResolved) {
        assert.equal(
          entry.inboxNewDir,
          bb[entry.role].new,
          `TS/Babashka mailbox-dir disagreement for role "${entry.role}" (new)`
        );
        assert.equal(
          entry.inProcessDir,
          bb[entry.role].inProcess,
          `TS/Babashka mailbox-dir disagreement for role "${entry.role}" (in_process)`
        );
      }
    } finally {
      cleanupFixtureRoot(ctx);
    }
  });
}

module.exports = { registerSteps };
