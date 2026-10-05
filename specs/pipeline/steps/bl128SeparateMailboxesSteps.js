'use strict';

// BL-1945 (BL-128 stamp-off): step handlers for "coordinator and specifier
// no longer share one physical inbox". Drives the REAL handoffd.bb
// --poll-once delivery path (same fixture shape
// bl728HandoffdDeliverParenVerificationSteps.js already establishes), the
// REAL migrate_shared_mailbox.bb, and the REAL handoff_lib.bb mailbox-dir
// resolver (via a small inline `bb -e` call, never a restatement of its
// per-role-subdirectory logic) against a fresh fixture root - never a
// hand-rolled mailbox path.
//
// QA bounce (2026-10-05, BL-1904/BL-1905): mailbox-isolation-01/02
// originally spawned the REAL ready_for_next.bb receive dispatcher against
// the fixture - forbidden outright (no acceptance step handler may ever
// start a real receive/completion dispatcher, since a resolution mishap
// could take up a LIVE seat's own parcel). The fix proves the same
// "does not see or dequeue" claim through handoff_lib.bb's own
// `mailbox-dir`/`my-mailbox-dir` resolver instead: ready_for_next_task.bb's
// own dispatch scans exactly `(handoff-lib/my-mailbox-dir :new)` (its
// role's own resolved inbox, confirmed by reading ready_for_next_task.bb
// directly) - so proving that directory holds nothing of the role's own
// AND is a physically distinct path from where the other role's handoff
// sits is exactly what the real dispatcher would see, without ever
// starting it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const HANDOFFD = path.join(SCRIPTS, 'handoffd.bb');
const MIGRATE = path.join(SCRIPTS, 'migrate_shared_mailbox.bb');
const HANDOFF_LIB = path.join(SCRIPTS, 'handoff_lib.bb');

const FEATURE = 'coordinator and specifier no longer share one physical inbox';

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

// BL-1390: proven isolated from the live checkout BEFORE any mutating git
// call - `git -C ""` is the current directory, and a linked worktree
// shares the live repo's own `.git/config`.
function proveFixtureIsolated(root) {
  const commonDir = execFileSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
  assert.ok(
    path.resolve(root, commonDir).startsWith(root),
    `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
  );
}

function mkFixtureRoot() {
  const root = trackedTmpRoot('sfvc-bl128-');
  git(root, ['init', '-q']);
  proveFixtureIsolated(root);
  git(root, ['-c', 'user.email=bl128@example.com', '-c', 'user.name=bl128', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return root;
}

// Both coordinator and specifier are master-resident (worktree-name
// "master", worktree-path the fixture root itself) - the exact shape that
// makes them share one physical checkout and is this ticket's own subject.
function writeRolesTsv(root) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    'coordinator\tmaster\t' + root + '\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' +
      'specifier\tmaster\t' + root + '\tswarmforge-specifier\tSpecifier\tclaude\ttask\n'
  );
}

// The REAL mailbox-dir resolver, via a one-off `bb -e` (never a restatement
// of its per-role-subdirectory logic) - the same function production
// delivery (handoff_inject_lib.bb) and the daemon itself go through.
function mailboxDir(root, role, state) {
  const out = execFileSync(
    'bb',
    ['-e', `(load-file ${JSON.stringify(HANDOFF_LIB)}) (print (str (handoff-lib/mailbox-dir (handoff-lib/load-role-info ${JSON.stringify(role)} ${JSON.stringify(root)}) :${state})))`],
    { encoding: 'utf8' }
  );
  return out.trim();
}

function writeHandoffFile(dir, basename, headers, body) {
  fs.mkdirSync(dir, { recursive: true });
  const headerBlock = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  fs.writeFileSync(path.join(dir, basename), `${headerBlock}\n\n${body}\n`);
}

// BL-1905: never spawn the real receive dispatcher - prove instead that
// inspectingRole's OWN resolved mailbox (exactly what
// ready_for_next_task.bb's own `(handoff-lib/my-mailbox-dir :new)` scans)
// holds nothing of its own, and is a physically distinct directory from
// wherever the other role's handoff actually sits.
function assertHelperCannotSeeOthersHandoff(ctx, inspectingRole) {
  const ownInbox = mailboxDir(ctx.root, inspectingRole, 'new');
  const ownFiles = fs.existsSync(ownInbox) ? fs.readdirSync(ownInbox) : [];
  assert.ok(
    !ownFiles.some((f) => f.endsWith('.handoff')),
    `expected ${inspectingRole}'s own resolved mailbox to be empty, got: ${ownFiles}`
  );
  assert.ok(fs.existsSync(ctx.queuedPath), "the other role's own handoff must be untouched");
  assert.notEqual(
    ownInbox,
    path.dirname(ctx.queuedPath),
    `${inspectingRole}'s own mailbox must be a physically distinct directory from where the other role's handoff is queued`
  );
}

function runHandoffdPollOnce(root) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const sock = path.join(root, 'fake.sock');
  fs.writeFileSync(sock, '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), `${sock}\n`);
  const res = spawnSync('bb', [HANDOFFD, root, '--poll-once'], {
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ALLOW_TMP_DAEMON: '1' },
    timeout: 15000,
  });
  return `${res.stdout || ''}${res.stderr || ''}`;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── mailbox-isolation-01/02: cross-role invisibility ──────────────────
  scoped(/^a handoff is queued with recipient (coordinator|specifier)$/, (ctx, recipient) => {
    ctx.root = mkFixtureRoot();
    writeRolesTsv(ctx.root);
    ctx.queuedRecipient = recipient;
    ctx.queuedPath = path.join(mailboxDir(ctx.root, recipient, 'new'), '50_bl128-fixture.handoff');
    writeHandoffFile(
      path.dirname(ctx.queuedPath),
      path.basename(ctx.queuedPath),
      { from: 'coder', to: recipient, priority: '50', type: 'note' },
      'fixture body'
    );
  });

  // Nothing to run - BL-1905 forbids spawning the real receive dispatcher
  // from an acceptance fixture; the Then steps below prove the claim via
  // the mailbox-dir resolver instead (see assertHelperCannotSeeOthersHandoff).
  scoped(/^the specifier runs its ready-for-next helper$/, () => {});

  scoped(/^the coordinator runs its ready-for-next helper$/, () => {});

  scoped(/^the specifier's helper does not see or dequeue the coordinator's handoff$/, (ctx) => {
    assertHelperCannotSeeOthersHandoff(ctx, 'specifier');
  });

  scoped(/^the coordinator's helper does not see or dequeue the specifier's handoff$/, (ctx) => {
    assertHelperCannotSeeOthersHandoff(ctx, 'coordinator');
  });

  // ── mailbox-isolation-04: daemon delivery lands in two distinct dirs ──
  scoped(/^the coordinator and specifier both run on the master worktree$/, (ctx) => {
    ctx.root = mkFixtureRoot();
    writeRolesTsv(ctx.root);
  });

  scoped(/^the daemon delivers one handoff to the coordinator and one to the specifier$/, (ctx) => {
    writeHandoffFile(
      mailboxDir(ctx.root, 'coordinator', 'outbox'),
      '50_to-specifier.handoff',
      { from: 'coordinator', to: 'specifier', priority: '50', type: 'note' },
      'coordinator to specifier'
    );
    writeHandoffFile(
      mailboxDir(ctx.root, 'specifier', 'outbox'),
      '50_to-coordinator.handoff',
      { from: 'specifier', to: 'coordinator', priority: '50', type: 'note' },
      'specifier to coordinator'
    );
    ctx.daemonOutput = runHandoffdPollOnce(ctx.root);
  });

  scoped(/^the two delivered files land in two different inbox directories$/, (ctx) => {
    const coordinatorInbox = mailboxDir(ctx.root, 'coordinator', 'new');
    const specifierInbox = mailboxDir(ctx.root, 'specifier', 'new');
    assert.notEqual(coordinatorInbox, specifierInbox, 'the two roles must resolve to physically distinct inbox directories');

    const coordinatorFiles = fs.existsSync(coordinatorInbox) ? fs.readdirSync(coordinatorInbox) : [];
    const specifierFiles = fs.existsSync(specifierInbox) ? fs.readdirSync(specifierInbox) : [];
    assert.ok(
      coordinatorFiles.some((f) => f.endsWith('.handoff')),
      `expected a delivered handoff in the coordinator's own inbox; daemon output: ${ctx.daemonOutput}`
    );
    assert.ok(
      specifierFiles.some((f) => f.endsWith('.handoff')),
      `expected a delivered handoff in the specifier's own inbox; daemon output: ${ctx.daemonOutput}`
    );
  });

  // ── mailbox-isolation-05: pre-upgrade mail migrates to the right mailbox ─
  scoped(
    /^a pre-upgrade shared inbox contains a (new|in_process) handoff with recipient (coordinator|specifier)$/,
    (ctx, state, role) => {
      ctx.root = mkFixtureRoot();
      writeRolesTsv(ctx.root);
      ctx.migrationState = state;
      ctx.migrationRole = role;
      // The pre-BL-128 flat shared layout: <root>/.swarmforge/handoffs/inbox/<state>/
      // (mailbox-base-dir's own "pre-BL-128 flat layout" for a role with no
      // <role> subdirectory at all).
      const oldDir = path.join(root(ctx), '.swarmforge', 'handoffs', 'inbox', state);
      ctx.oldPath = path.join(oldDir, `50_bl128-migrate-fixture.handoff`);
      writeHandoffFile(
        oldDir,
        path.basename(ctx.oldPath),
        { from: 'coder', to: role, recipient: role, priority: '50', type: 'note' },
        'pre-upgrade fixture body'
      );
    }
  );

  function root(ctx) {
    return ctx.root;
  }

  scoped(/^the mailbox migration runs$/, (ctx) => {
    const res = spawnSync('bb', [MIGRATE, ctx.root], { encoding: 'utf8' });
    ctx.migrationOutput = `${res.stdout || ''}${res.stderr || ''}`;
  });

  scoped(/^that handoff exists in the (coordinator|specifier) mailbox in state (new|in_process)$/, (ctx, role, state) => {
    const dir = mailboxDir(ctx.root, role, state);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    assert.ok(
      files.some((f) => f.endsWith('.handoff')),
      `expected the migrated handoff in ${role}'s ${state} mailbox (${dir}); migration output: ${ctx.migrationOutput}`
    );
  });

  scoped(/^it exists nowhere else$/, (ctx) => {
    assert.ok(!fs.existsSync(ctx.oldPath), 'the old shared-inbox copy must be moved, not left behind');
    const otherRole = ctx.migrationRole === 'coordinator' ? 'specifier' : 'coordinator';
    for (const state of ['new', 'in_process']) {
      const otherDir = mailboxDir(ctx.root, otherRole, state);
      const files = fs.existsSync(otherDir) ? fs.readdirSync(otherDir) : [];
      assert.ok(
        !files.some((f) => f.includes('bl128-migrate-fixture')),
        `the migrated handoff must not also land in the other role's ${state} mailbox`
      );
    }
  });
}

module.exports = { registerSteps };
