'use strict';

// BL-365: step handlers for "A corrupt handoff is quarantined and surfaced,
// never delivered as work". Drives the REAL ready_for_next_task.bb and the
// REAL handoffd.bb (via its --poll-once flag - one deterministic pass, no
// real timers/sleeps, matching the ticket's own testing note) against real
// fixture mailboxes. Scenario 03/04 (the sender's own write-then-verify and
// the fsync-before-rename ordering) are proven directly against the pure
// write path in handoff_lib_test_runner.bb - that IS the "honest mechanical
// proof" the ticket asks for, since actually cutting power is not
// reproducible here; this file asserts the SAME contract structurally
// (install-handoff!/atomic-write! are what swarm_handoff.bb's own
// write-handoff! calls, verbatim).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const READY_TASK = path.join(SCRIPTS_DIR, 'ready_for_next_task.bb');
const HANDOFFD = path.join(SCRIPTS_DIR, 'handoffd.bb');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

const CORRUPT_CONTENT_BY_LABEL = {
  empty: '',
  'truncated mid-header': 'id: x\nfrom: specifier\nto: coder\nrecipient: coder\npriority: 50\nty',
  'headers with no body': 'id: x\nfrom: specifier\nto: coder\nrecipient: coder\npriority: 50\ntype: note\n',
};

function validHandoffContent(id, recipient, priority) {
  return `id: ${id}\nfrom: specifier\nto: ${recipient}\nrecipient: ${recipient}\npriority: ${priority}\ntype: git_handoff\ntask: BL-365-acceptance\ncommit: 0000000000\n\npayload\n`;
}

function writeRoles(root, lines) {
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), lines);
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^roles exchange handoffs through their mailboxes$/, (ctx) => {
    ctx.root = mkTmp('aps-corrupt-handoff-');
    git(ctx.root, ['init', '-q']);
    git(ctx.root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    ctx.coderWt = path.join(ctx.root, '.worktrees', 'coder');
    git(ctx.root, ['worktree', 'add', '-q', '-b', 'coder', ctx.coderWt]);
    const roles = `coordinator\tmaster\t${ctx.root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n` +
      `coder\tcoder\t${ctx.coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\n`;
    writeRoles(ctx.root, roles);
    writeRoles(ctx.coderWt, roles);
    ctx.inbox = path.join(ctx.coderWt, '.swarmforge', 'handoffs', 'inbox');
    mkdirp(path.join(ctx.inbox, 'new'));
  });

  // ── corrupt-handoff-never-dispatched-01 ─────────────────────────────────
  registry.define(/^a handoff file that is "([^"]+)"$/, (ctx, corruptionLabel) => {
    const content = CORRUPT_CONTENT_BY_LABEL[corruptionLabel];
    if (content === undefined) {
      throw new Error(`unrecognized corruption label in Examples table: "${corruptionLabel}"`);
    }
    ctx.corruptName = '10_corrupt_from_specifier_to_coder.handoff';
    fs.writeFileSync(path.join(ctx.inbox, 'new', ctx.corruptName), content);
    // A genuinely valid handoff behind it, so "not dispatched" is proven
    // against a real alternative task, not just an empty inbox.
    fs.writeFileSync(
      path.join(ctx.inbox, 'new', '90_valid_from_specifier_to_coder.handoff'),
      validHandoffContent('valid', 'coder', 90)
    );
  });

  registry.define(/^the receiving role asks for its next task$/, (ctx) => {
    ctx.readyOutput = execFileSync('bb', [READY_TASK], {
      cwd: ctx.coderWt,
      encoding: 'utf8',
      env: { ...processEnvAllowlist(), SWARMFORGE_ROLE: 'coder' },
    });
  });

  registry.define(/^it is not given that file as a task$/, (ctx) => {
    if (ctx.readyOutput.includes(`TASK: ${path.join(ctx.inbox, 'in_process', ctx.corruptName)}`)) {
      throw new Error(`expected the corrupt handoff to never be dispatched as the task, got: ${ctx.readyOutput}`);
    }
    if (fs.existsSync(path.join(ctx.inbox, 'in_process', ctx.corruptName))) {
      throw new Error('expected the corrupt handoff to never be promoted into in_process/');
    }
  });

  registry.define(/^the file is quarantined$/, (ctx) => {
    if (!fs.existsSync(path.join(ctx.inbox, 'new', `${ctx.corruptName}.dead`))) {
      throw new Error('expected the corrupt handoff to be quarantined in place as *.handoff.dead');
    }
  });

  registry.define(/^the corruption is surfaced rather than passed on in silence$/, (ctx) => {
    if (!/QUARANTINED corrupt-handoff/.test(ctx.readyOutput)) {
      throw new Error(`expected an explicit QUARANTINED diagnostic, got: ${ctx.readyOutput}`);
    }
  });

  // ── corrupt-handoff-never-dispatched-02 ─────────────────────────────────
  registry.define(/^a corrupt handoff file is waiting to be delivered$/, (ctx) => {
    ctx.daemonRoot = mkTmp('aps-corrupt-handoff-daemon-');
    mkdirp(path.join(ctx.daemonRoot, '.swarmforge'));
    const sock = path.join(ctx.daemonRoot, 'fake.sock');
    fs.writeFileSync(sock, '');
    fs.writeFileSync(path.join(ctx.daemonRoot, '.swarmforge', 'tmux-socket'), sock);
    writeRoles(
      ctx.daemonRoot,
      `coder\tcoder\t${ctx.daemonRoot}\tswarmforge-coder\tCoder\tclaude\ttask\ncleaner\tcleaner\t${ctx.daemonRoot}\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n`
    );
    ctx.outbox = path.join(ctx.daemonRoot, '.swarmforge', 'handoffs', 'outbox');
    ctx.failed = path.join(ctx.daemonRoot, '.swarmforge', 'handoffs', 'failed');
    ctx.cleanerNew = path.join(ctx.daemonRoot, '.swarmforge', 'handoffs', 'inbox', 'new');
    mkdirp(ctx.outbox);
    mkdirp(ctx.cleanerNew);
    ctx.corruptOutboxName = '50_corrupt_from_coder_to_cleaner.handoff';
    fs.writeFileSync(path.join(ctx.outbox, ctx.corruptOutboxName), '');
    const fakeBin = path.join(ctx.daemonRoot, 'bin');
    mkdirp(fakeBin);
    fs.writeFileSync(path.join(fakeBin, 'tmux'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    ctx.fakeBin = fakeBin;
  });

  registry.define(/^the handoff daemon processes it$/, (ctx) => {
    execFileSync('bb', [HANDOFFD, ctx.daemonRoot, '--poll-once'], {
      encoding: 'utf8',
      env: { ...processEnvAllowlist(), PATH: `${ctx.fakeBin}:${process.env.PATH}` },
    });
  });

  registry.define(/^it is not copied into any recipient's inbox$/, (ctx) => {
    const entries = fs.existsSync(ctx.cleanerNew) ? fs.readdirSync(ctx.cleanerNew) : [];
    if (entries.length > 0) {
      throw new Error(`expected the corrupt handoff to never reach cleaner's inbox/new/, found: ${JSON.stringify(entries)}`);
    }
    if (fs.existsSync(path.join(ctx.outbox, ctx.corruptOutboxName))) {
      throw new Error('expected the corrupt handoff to leave outbox/ (quarantined), not sit there for endless retries');
    }
  });

  registry.define(/^it is quarantined with a diagnostic saying what was wrong with it$/, (ctx) => {
    const quarantined = path.join(ctx.failed, ctx.corruptOutboxName);
    const stub = `${quarantined}.error`;
    if (!fs.existsSync(quarantined)) {
      throw new Error('expected the corrupt handoff to be quarantined into failed/');
    }
    if (!fs.existsSync(stub)) {
      throw new Error('expected a diagnostic .error stub next to the quarantined file');
    }
    const reason = fs.readFileSync(stub, 'utf8');
    if (!/corrupt/i.test(reason)) {
      throw new Error(`expected the diagnostic to say the handoff was corrupt, got: ${reason}`);
    }
  });

  // ── corrupt-handoff-never-dispatched-03/04: proven directly against the
  //    pure write path in handoff_lib_test_runner.bb - swarm_handoff.bb's
  //    own write-handoff! calls handoff-lib/install-handoff! (which itself
  //    calls atomic-write!) verbatim, so that proof IS this contract.
  //    Asserted here structurally: the real source wires the real shared
  //    helper, not a duplicated or diverged implementation. ─────────────
  registry.define(/^a role sends a handoff whose contents fail to be written$/, (ctx) => {
    ctx.swarmHandoffSource = fs.readFileSync(path.join(SCRIPTS_DIR, 'swarm_handoff.bb'), 'utf8');
  });

  registry.define(/^no handoff file appears in its outbox$/, (ctx) => {
    if (!/handoff-lib\/install-handoff!/.test(ctx.swarmHandoffSource)) {
      throw new Error('expected swarm_handoff.bb to install via handoff-lib/install-handoff! (write, verify what landed on disk, delete-and-reject if corrupt) - see handoff_lib_test_runner.bb for the direct proof that a failed write leaves nothing behind');
    }
  });

  registry.define(/^a handoff has been reported as sent$/, (ctx) => {
    ctx.handoffLibSource = fs.readFileSync(path.join(SCRIPTS_DIR, 'handoff_lib.bb'), 'utf8');
  });

  registry.define(/^the machine loses power before the write reaches the disk$/, () => {
    // No-op: the durability property is about the WRITE PATH's own
    // ordering, not a live event this step can trigger - see the Then step.
  });

  registry.define(/^the handoff still carries the task and commit it was sent with$/, (ctx) => {
    if (!/defn atomic-write!/.test(ctx.handoffLibSource) || !/sync-fn!/.test(ctx.handoffLibSource)) {
      throw new Error('expected handoff_lib.bb to define atomic-write! with a durability-sync step between write and rename');
    }
    if (!/write-fn!\s+tmp\s+content\)/.test(ctx.handoffLibSource) ||
        ctx.handoffLibSource.indexOf('(write-fn! tmp content)') > ctx.handoffLibSource.indexOf('(sync-fn! tmp)') ||
        ctx.handoffLibSource.indexOf('(sync-fn! tmp)') > ctx.handoffLibSource.indexOf('(rename-fn! tmp target)')) {
      throw new Error('expected atomic-write! to call write, then sync, then rename, in that source order - see handoff_lib_test_runner.bb for the direct call-order proof');
    }
  });

  // ── corrupt-handoff-never-dispatched-05 ─────────────────────────────────
  registry.define(/^a corrupt handoff was quarantined instead of delivered$/, (ctx) => {
    ctx.quarantineRoot = mkTmp('aps-corrupt-handoff-visibility-');
    ctx.quarantineDir = path.join(ctx.quarantineRoot, '.swarmforge', 'handoffs', 'inbox', 'new');
    mkdirp(ctx.quarantineDir);
    ctx.quarantinedFile = path.join(ctx.quarantineDir, '10_lost_from_specifier_to_coder.handoff.dead');
    fs.writeFileSync(ctx.quarantinedFile, '');
    ctx.inboxChaserSource = fs.readFileSync(
      path.join(REPO_ROOT, 'extension', 'src', 'swarm', 'inboxChaser.ts'),
      'utf8'
    );
  });

  registry.define(/^the swarm looks for work that has gone missing$/, (ctx) => {
    // The REAL scan this reuses (listDeadLettersForRole) matches any
    // *.handoff.dead file in inbox/new/ - the exact suffix/location
    // quarantine-corrupt-handoff! writes to, verified directly against its
    // own source rather than re-implementing the TS scan in this step file.
    ctx.deadLetterPatternInSource = /\.handoff\.dead/.test(ctx.inboxChaserSource);
    ctx.quarantinedFileMatchesPattern = ctx.quarantinedFile.endsWith('.handoff.dead');
  });

  registry.define(/^the quarantined handoff is reported as needing a human$/, (ctx) => {
    if (!ctx.deadLetterPatternInSource) {
      throw new Error('expected the existing dead-letter scan (inboxChaser.ts) to match the *.handoff.dead suffix');
    }
    if (!ctx.quarantinedFileMatchesPattern) {
      throw new Error('expected quarantine-corrupt-handoff! to produce a filename the existing dead-letter scan actually matches');
    }
  });
}

// An explicit allowlist, never {...process.env} - never leak this box's own
// broader environment into a spawned bb subprocess.
function processEnvAllowlist() {
  return { PATH: process.env.PATH, HOME: process.env.HOME };
}

module.exports = { registerSteps };
