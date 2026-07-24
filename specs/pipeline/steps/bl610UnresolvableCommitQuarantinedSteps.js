'use strict';

// BL-610: step handlers for "A git handoff whose commit no longer resolves
// is quarantined at dequeue instead of handed to a role". Drives the REAL
// ready_for_next_task.bb against a real fixture git repo (the git lookup is
// NOT injected here - a real commit either exists in the repo or it
// doesn't), mirroring corruptHandoffNeverDispatchedSteps.js's own pattern.
// Scenario 06 (the send-time honest message) drives the REAL swarm_handoff.bb
// CLI end to end, since canonical-commit shells to git in the process cwd.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const READY_TASK = path.join(SCRIPTS_DIR, 'ready_for_next_task.bb');
const SWARM_HANDOFF = path.join(SCRIPTS_DIR, 'swarm_handoff.bb');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

// An explicit allowlist, never {...process.env} - never leak this box's own
// broader environment into a spawned bb subprocess.
function processEnvAllowlist(extra) {
  return { PATH: process.env.PATH, HOME: process.env.HOME, ...extra };
}

function writeRoles(root, lines) {
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), lines);
}

function gitHandoffContent({ id, task, commit, createdAt, enqueuedAt }) {
  const lines = [
    `id: ${id}`,
    'from: qa',
    'to: coder',
    'recipient: coder',
    'priority: 50',
    'type: git_handoff',
    `task: ${task}`,
  ];
  if (commit !== null && commit !== undefined) {
    lines.push(`commit: ${commit}`);
  }
  lines.push(`created_at: ${createdAt || '2026-07-24T21:30:22Z'}`);
  lines.push(`enqueued_at: ${enqueuedAt || '2026-07-24T21:30:24Z'}`);
  return `${lines.join('\n')}\n\nmerge_and_process qa ${commit || ''}\n`;
}

function parcelTypeContent(type) {
  if (type === 'note') {
    return 'id: 20260724T000000Z_note\nfrom: qa\nto: coder\nrecipient: coder\npriority: 50\ntype: note\nmessage: hi\n\nhi\n';
  }
  if (type === 'awake') {
    return 'id: 20260724T000000Z_awake\nfrom: qa\nto: coder\nrecipient: coder\npriority: 50\ntype: awake\n\nwake up\n';
  }
  throw new Error(`unrecognized parcel type in Examples table: "${type}"`);
}

function setUpFixtureRepo() {
  const root = mkTmp('aps-bl610-unresolvable-commit-');
  git(root, ['init', '-q']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  const commit = gitOut(root, ['rev-parse', '--short=10', 'HEAD']);
  const coderWt = path.join(root, '.worktrees', 'coder');
  git(root, ['worktree', 'add', '-q', '-b', 'coder', coderWt]);
  const roles = `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n` +
    `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\n`;
  writeRoles(root, roles);
  writeRoles(coderWt, roles);
  const inbox = path.join(coderWt, '.swarmforge', 'handoffs', 'inbox');
  mkdirp(path.join(inbox, 'new'));
  return { root, coderWt, inbox, resolvableCommit: commit };
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────────
  registry.define(/^a parcel has been delivered to a role's inbox$/, (ctx) => {
    Object.assign(ctx, setUpFixtureRepo());
  });

  // ── 01/02/03: git handoff with a resolvable/unresolvable commit ─────────
  registry.define(/^the parcel is a git handoff whose commit no longer resolves to a git object$/, (ctx) => {
    ctx.parcelName = '10_unresolvable_from_qa_to_coder.handoff';
    ctx.taskName = 'BL-610-acceptance';
    fs.writeFileSync(
      path.join(ctx.inbox, 'new', ctx.parcelName),
      gitHandoffContent({ id: 'unresolvable', task: ctx.taskName, commit: 'deadbeef00' })
    );
  });

  registry.define(/^the parcel is a git handoff whose commit still resolves to a git object$/, (ctx) => {
    ctx.parcelName = '10_resolvable_from_qa_to_coder.handoff';
    fs.writeFileSync(
      path.join(ctx.inbox, 'new', ctx.parcelName),
      gitHandoffContent({ id: 'resolvable', task: 'BL-610-acceptance', commit: ctx.resolvableCommit })
    );
  });

  registry.define(/^the parcel is a (note|awake)$/, (ctx, parcelType) => {
    ctx.parcelName = `10_${parcelType}_from_qa_to_coder.handoff`;
    fs.writeFileSync(path.join(ctx.inbox, 'new', ctx.parcelName), parcelTypeContent(parcelType));
  });

  registry.define(/^the parcel is structurally corrupt$/, (ctx) => {
    ctx.parcelName = '10_corrupt_from_qa_to_coder.handoff';
    fs.writeFileSync(path.join(ctx.inbox, 'new', ctx.parcelName), '');
  });

  registry.define(/^the role receives work$/, (ctx) => {
    ctx.readyOutput = execFileSync('bb', [READY_TASK], {
      cwd: ctx.coderWt,
      encoding: 'utf8',
      env: processEnvAllowlist({ SWARMFORGE_ROLE: 'coder' }),
    });
  });

  registry.define(/^the parcel is quarantined to the dead letter path$/, (ctx) => {
    if (!fs.existsSync(path.join(ctx.inbox, 'new', `${ctx.parcelName}.dead`))) {
      throw new Error(`expected ${ctx.parcelName} to be quarantined as *.handoff.dead, got output: ${ctx.readyOutput}`);
    }
  });

  registry.define(/^the parcel is not handed to the role as a task$/, (ctx) => {
    const inProcessPath = path.join(ctx.inbox, 'in_process', ctx.parcelName);
    if (ctx.readyOutput.includes(`TASK: ${inProcessPath}`)) {
      throw new Error(`expected the parcel to never be dispatched as the task, got: ${ctx.readyOutput}`);
    }
    if (fs.existsSync(inProcessPath)) {
      throw new Error('expected the parcel to never be promoted into in_process/');
    }
  });

  registry.define(/^the quarantine is announced with an unresolvable commit diagnostic$/, (ctx) => {
    if (!/QUARANTINED unresolvable-commit:/.test(ctx.readyOutput)) {
      throw new Error(`expected a QUARANTINED unresolvable-commit diagnostic, got: ${ctx.readyOutput}`);
    }
  });

  registry.define(/^the quarantine is announced with a corrupt handoff diagnostic$/, (ctx) => {
    if (!/QUARANTINED corrupt-handoff:/.test(ctx.readyOutput)) {
      throw new Error(`expected a QUARANTINED corrupt-handoff diagnostic, got: ${ctx.readyOutput}`);
    }
  });

  registry.define(/^the parcel is not quarantined$/, (ctx) => {
    if (fs.existsSync(path.join(ctx.inbox, 'new', `${ctx.parcelName}.dead`))) {
      throw new Error('expected the resolvable-commit parcel to be left unquarantined');
    }
  });

  registry.define(/^the parcel is handed to the role as a task$/, (ctx) => {
    const inProcessPath = path.join(ctx.inbox, 'in_process', ctx.parcelName);
    if (!ctx.readyOutput.includes(`TASK: ${inProcessPath}`)) {
      throw new Error(`expected the parcel to be dispatched as the task, got: ${ctx.readyOutput}`);
    }
  });

  // ── 02: the investigable record ─────────────────────────────────────────
  registry.define(/^the quarantine record states the commit, the task, the sending role, when it was sent, and when it was dequeued$/, (ctx) => {
    const line = ctx.readyOutput.split('\n').find((l) => l.startsWith('QUARANTINED unresolvable-commit:'));
    if (!line) {
      throw new Error(`expected a QUARANTINED unresolvable-commit line, got: ${ctx.readyOutput}`);
    }
    for (const field of ['commit=deadbeef00', `task=${ctx.taskName}`, 'from=qa', 'created_at=', 'enqueued_at=', 'dequeued_at=']) {
      if (!line.includes(field)) {
        throw new Error(`expected the quarantine record to include "${field}", got: ${line}`);
      }
    }
  });

  // ── 04: note/awake never commit checked ─────────────────────────────────
  registry.define(/^no git object lookup is performed for that parcel$/, (ctx) => {
    // A note/awake parcel carries no commit header at all, so
    // unresolvable-commit?'s own narrow trigger (type: git_handoff only)
    // guarantees resolve-fn? is never invoked - proven directly against the
    // decision-logic unit tests in handoff_lib_test_runner.bb (a spy
    // resolve-fn? that would throw if called). What's checked here is the
    // observable outcome: the parcel dequeues as a normal task, unquarantined.
    const inProcessPath = path.join(ctx.inbox, 'in_process', ctx.parcelName);
    if (!ctx.readyOutput.includes(`TASK: ${inProcessPath}`)) {
      throw new Error(`expected the note/awake parcel to dequeue normally, got: ${ctx.readyOutput}`);
    }
    if (fs.existsSync(`${path.join(ctx.inbox, 'new', ctx.parcelName)}.dead`)) {
      throw new Error('expected a note/awake parcel to never be quarantined');
    }
  });

  // ── 06: send-time honest no-match message ───────────────────────────────
  registry.define(/^a draft git handoff whose commit matches no git object$/, (ctx) => {
    ctx.sendRoot = mkTmp('aps-bl610-send-');
    git(ctx.sendRoot, ['init', '-q']);
    git(ctx.sendRoot, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    const specifierWt = ctx.sendRoot;
    const coderWt = path.join(ctx.sendRoot, '.worktrees', 'coder');
    git(ctx.sendRoot, ['worktree', 'add', '-q', '-b', 'coder', coderWt]);
    const roles = `specifier\tmaster\t${specifierWt}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n` +
      `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\n`;
    writeRoles(ctx.sendRoot, roles);
    mkdirp(path.join(ctx.sendRoot, '.swarmforge', 'handoffs', 'specifier', 'outbox', 'tmp'));
    mkdirp(path.join(ctx.sendRoot, '.swarmforge', 'handoffs', 'specifier', 'sent'));
    mkdirp(path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'new'));
    ctx.draftPath = path.join(ctx.sendRoot, 'draft.handoff');
    fs.writeFileSync(
      ctx.draftPath,
      'type: git_handoff\nto: coder\npriority: 50\ntask: BL-610-send-test\ncommit: 0000000000\n'
    );
  });

  registry.define(/^the draft is sent$/, (ctx) => {
    try {
      ctx.sendOutput = execFileSync('bb', [SWARM_HANDOFF, ctx.draftPath], {
        cwd: ctx.sendRoot,
        encoding: 'utf8',
        env: processEnvAllowlist({ SWARMFORGE_ROLE: 'specifier', SWARMFORGE_SKIP_DAEMON: '1' }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      ctx.sendExitCode = 0;
    } catch (err) {
      ctx.sendOutput = `${err.stdout || ''}${err.stderr || ''}`;
      ctx.sendExitCode = err.status;
    }
  });

  registry.define(/^the send is rejected$/, (ctx) => {
    if (ctx.sendExitCode === 0) {
      throw new Error(`expected the send to be rejected, got exit 0: ${ctx.sendOutput}`);
    }
  });

  registry.define(/^the rejection states that the commit matched no object$/, (ctx) => {
    if (!/matched 0/.test(ctx.sendOutput)) {
      throw new Error(`expected the rejection to say "matched 0", got: ${ctx.sendOutput}`);
    }
    if (/resolves to ''/.test(ctx.sendOutput)) {
      throw new Error(`expected the rejection to NOT use the misleading "resolves to ''" message, got: ${ctx.sendOutput}`);
    }
  });
}

module.exports = { registerSteps };
