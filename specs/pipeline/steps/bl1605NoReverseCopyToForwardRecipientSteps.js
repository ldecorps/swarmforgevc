'use strict';

// BL-1605: step handlers for "No reverse copy to a role the forward
// already names". Drives the REAL swarm_handoff.bb (and handoffd.bb to
// deliver the mailbox-only queued parcels) against a real fixture swarm
// root - no reimplementation of the reverse-hop or send-gate decisions.
// Every send answers swarm_handoff.bb's own self-audit challenge (two
// identical calls: AUDIT_REQUIRED, then the real queue - BL-1529).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'BL-1605 No reverse copy to a role the forward already names';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARM_HANDOFF = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_handoff.bb');
const HANDOFFD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');

// Background: coder forward-only, cleaner back-one, architect back-all -
// the live full-forge.conf shape this defect was found on.
const ROLES = [
  ['coder', 'coder', 'forward-only'],
  ['cleaner', 'cleaner', 'back-one'],
  ['architect', 'architect', 'back-all'],
  ['hardender', 'hardender', 'forward-only'],
  ['documenter', 'documenter', 'forward-only'],
  ['QA', 'QA', 'forward-only'],
];

function sh(cmd, args, opts) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (res.status !== 0 && res.error) throw res.error;
  return res;
}

function mailboxDir(root, role, ...rest) {
  return path.join(root, '.worktrees', role, '.swarmforge', 'handoffs', ...rest);
}

function makeFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1605-'));
  sh('git', ['init', '-q'], { cwd: root });
  sh('git', ['config', 'user.email', 'test@test'], { cwd: root });
  sh('git', ['config', 'user.name', 'test'], { cwd: root });
  fs.writeFileSync(path.join(root, 'f.txt'), 'x\n');
  sh('git', ['add', 'f.txt'], { cwd: root });
  sh('git', ['commit', '-q', '-m', 'seed'], { cwd: root });
  const commit = execFileSync('git', ['rev-parse', '--short=10', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

  const rolesTsv =
    ROLES.map(([role, wt, prop]) =>
      [role, wt, path.join(root, '.worktrees', wt), `swarmforge-${role}`, role, 'claude', 'task', 'off', prop].join(
        '\t'
      )
    ).join('\n') + '\n';
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), rolesTsv);

  for (const [role] of ROLES) {
    for (const sub of ['outbox/tmp', 'sent', 'inbox/new', 'inbox/in_process', 'inbox/completed']) {
      fs.mkdirSync(mailboxDir(root, role, ...sub.split('/')), { recursive: true });
    }
  }

  // A fake tmux socket + binary so handoffd's own delivery machinery does
  // not need a real tmux server - SWARMFORGE_MAILBOX_ONLY below skips the
  // actual send-keys inject, but handoffd still probes for a socket file.
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
  const fakeBin = path.join(root, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fakeBin, 'tmux'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(fakeBin, 'tmux'), 0o755);

  return { root, commit, fakeBin };
}

function sendEnv(ctx, sender) {
  const env = { ...process.env, SWARMFORGE_ROLE: sender, SWARMFORGE_MAILBOX_ONLY: '1', SWARMFORGE_SKIP_SYNC_INJECT: '1', PATH: `${ctx.fakeBin}:${process.env.PATH}` };
  delete env.SWARMFORGE_SKIP_DAEMON;
  return env;
}

function runSend(ctx, draft, sender) {
  return spawnSync('bb', [SWARM_HANDOFF, draft], { cwd: ctx.root, env: sendEnv(ctx, sender), encoding: 'utf8' });
}

function sendGitHandoffAnswered(ctx, sender, recipient, task, commit) {
  const draft = path.join(ctx.root, `draft-${sender}-${recipient}-${task}.handoff`);
  fs.writeFileSync(draft, `type: git_handoff\nto: ${recipient}\npriority: 50\ntask: ${task}\ncommit: ${commit}\n`);
  const first = runSend(ctx, draft, sender); // AUDIT_REQUIRED, queues nothing
  assert.match(`${first.stdout}${first.stderr}`, /AUDIT_REQUIRED/, `expected the first call to challenge: ${first.stdout}${first.stderr}`);
  return runSend(ctx, draft, sender); // identical redraft - actually queues
}

function deliver(ctx) {
  const res = sh('bb', [HANDOFFD, ctx.root, '--poll-once'], {
    cwd: ctx.root,
    // BL-406: handoffd.bb refuses to start against a throwaway temp root
    // unless this is set - an intentional test fixture, opted in.
    env: { ...process.env, SWARMFORGE_ALLOW_TMP_DAEMON: '1', SWARMFORGE_MAILBOX_ONLY: '1', PATH: `${ctx.fakeBin}:${process.env.PATH}` },
  });
  assert.equal(res.status, 0, `handoffd --poll-once failed: ${res.stdout}${res.stderr}`);
}

// The task name lives in the file's `task:` header content, never in the
// filename (a filename names sender/recipient/timestamp only) - filters by
// reading each candidate file, not by matching the filename.
function newMailboxFilesForTask(ctx, role, task) {
  const dir = mailboxDir(ctx.root, role, 'inbox', 'new');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.handoff'))
    .filter((f) => new RegExp(`^task: ${task}$`, 'm').test(fs.readFileSync(path.join(dir, f), 'utf8')));
}

function parseReverseRoles(text) {
  if (/^nobody$/i.test(text.trim())) return [];
  return text.split(/\s+and\s+/).map((s) => s.trim());
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  scoped(
    /^a fixture swarm root whose roles table lists coder, cleaner, architect, hardender, documenter and QA, with the cleaner declared back-one and the architect back-all$/,
    (ctx) => {
      Object.assign(ctx, makeFixtureRoot());
      ctx.bl1605AllRoles = ROLES.map(([role]) => role);
    }
  );

  // -- Scenario 01 (Outline) ---------------------------------------------------
  scoped(/^(\S+) queues a git_handoff to (\S+) through the real sender with the audit answered$/, (ctx, sender, recipient) => {
    ctx.bl1605Sender = sender;
    ctx.bl1605Recipient = recipient;
    ctx.bl1605Task = `BL-9001-${sender}-${recipient}`;
    const res = sendGitHandoffAnswered(ctx, sender, recipient, ctx.bl1605Task, ctx.commit);
    assert.equal(res.status, 0, `expected the send to succeed: ${res.stdout}${res.stderr}`);
    deliver(ctx);
  });

  scoped(/^(\S+)'s mailbox holds exactly one file for the task and it carries no non-forwarding marker$/, (ctx, recipient) => {
    const files = newMailboxFilesForTask(ctx, recipient, ctx.bl1605Task);
    assert.equal(files.length, 1, `expected exactly one file for ${ctx.bl1605Task} in ${recipient}'s inbox/new, found ${files.length}: ${files.join(', ')}`);
    const content = fs.readFileSync(mailboxDir(ctx.root, recipient, 'inbox', 'new', files[0]), 'utf8');
    assert.doesNotMatch(content, /^non-forwarding: true$/m, `${recipient}'s forwarding copy carries a non-forwarding marker:\n${content}`);
  });

  scoped(/^the merge-only copies of that send go to (.+) and to no other role$/, (ctx, reverseRolesText) => {
    const expectedReverse = new Set(parseReverseRoles(reverseRolesText));
    for (const role of ctx.bl1605AllRoles) {
      const files = newMailboxFilesForTask(ctx, role, ctx.bl1605Task);
      if (role === ctx.bl1605Recipient) continue; // covered by the previous step
      if (expectedReverse.has(role)) {
        assert.equal(files.length, 1, `expected exactly one non-forwarding copy for ${role}, found ${files.length}`);
        const content = fs.readFileSync(mailboxDir(ctx.root, role, 'inbox', 'new', files[0]), 'utf8');
        assert.match(content, /^non-forwarding: true$/m, `${role}'s copy is missing the non-forwarding marker:\n${content}`);
      } else {
        assert.equal(files.length, 0, `${role} received an unexpected copy of the send: ${files.join(', ')}`);
      }
    }
  });

  // -- Scenario 02 -------------------------------------------------------------
  scoped(/^the cleaner holds in process a non-forwarding inbound for a different task$/, (ctx) => {
    const file = mailboxDir(ctx.root, 'cleaner', 'inbox', 'in_process', '00_other_non_forwarding.handoff');
    fs.writeFileSync(
      file,
      'id: x\nfrom: architect\nto: cleaner\npriority: 00\ntype: git_handoff\ntask: some-other-ticket\ncommit: aaaaaaaaaa\nnon-forwarding: true\n\nbody\n'
    );
  });

  scoped(/^the cleaner tries to queue a git_handoff to architect for its own task$/, (ctx) => {
    const draft = path.join(ctx.root, 'draft-cleaner-architect-refused.handoff');
    fs.writeFileSync(draft, `type: git_handoff\nto: architect\npriority: 50\ntask: BL-9002-cleaner-own\ncommit: ${ctx.commit}\n`);
    ctx.bl1605RefusedResult = runSend(ctx, draft, 'cleaner');
  });

  scoped(/^the sender refuses because a non-forwarding inbound is in process$/, (ctx) => {
    const out = `${ctx.bl1605RefusedResult.stdout}${ctx.bl1605RefusedResult.stderr}`;
    assert.equal(ctx.bl1605RefusedResult.status, 1, `expected exit 1, got ${ctx.bl1605RefusedResult.status}: ${out}`);
    assert.match(out, /Current inbound handoff is non-forwarding/, `expected the refusal message: ${out}`);
  });
}

module.exports = { registerSteps };
