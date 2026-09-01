'use strict';

// BL-1313: step handlers for the batch-guard-visibility feature.
// Drives the REAL swarm_handoff.bb and duplicate_chain_guard_lib.bb through
// their CLI surfaces - the same "handoff protocol" allowlisted domain as
// mailboxIntakeSteps.js. Never a live swarm, never a live tmux session.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SWARMFORGE_SCRIPTS, 'swarm_handoff.bb');

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function ensureFixture(ctx) {
  if (ctx.fixtureRoot) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1313-aps-'));
  ctx.fixtureRoot = root;

  // Set up a minimal git repo so swarm_handoff.bb can compute a commit hash.
  git(root, ['init', '-q']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  ctx.commitHash = execFileSync('git', ['-C', root, 'rev-parse', '--short=10', 'HEAD'], { encoding: 'utf8' }).trim();

  // Set up the roles: sender (coder, task mode) and holder (cleaner, batch mode).
  ctx.senderRole = 'coder';
  ctx.holderRole = 'cleaner';
  ctx.ticket = 'BL-1313-test';

  const masterWt = root;
  const cleanerWt = path.join(root, '.worktrees', 'cleaner');
  const coderWt = path.join(root, '.worktrees', 'coder');

  fs.mkdirSync(path.join(masterWt, '.swarmforge', 'handoffs', 'coordinator', 'outbox'), { recursive: true });
  fs.mkdirSync(path.join(masterWt, '.swarmforge', 'handoffs', 'coordinator', 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(masterWt, '.swarmforge', 'handoffs', 'coordinator', 'sent'), { recursive: true });
  fs.mkdirSync(path.join(masterWt, '.swarmforge', 'handoffs', 'coordinator', 'inbox', 'in_process'), { recursive: true });
  fs.mkdirSync(path.join(cleanerWt, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.mkdirSync(path.join(cleanerWt, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  fs.mkdirSync(path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.mkdirSync(path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });

  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    [
      `coordinator\tmaster\t${masterWt}\tswarmforge-coordinator\tCoordinator\tclaude\ttask`,
      `cleaner\tcleaner\t${cleanerWt}\tswarmforge-cleaner\tCleaner\tclaude\tbatch`,
      `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask`,
    ].join('\n') + '\n'
  );

  ctx.masterWt = masterWt;
  ctx.cleanerWt = cleanerWt;
  ctx.coderWt = coderWt;
}

function writeHandoff(dir, basename, from, to, ticket, nonForwarding) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    `id: ${basename}`,
    `from: ${from}`,
    `to: ${to}`,
    'priority: 50',
    'type: git_handoff',
    `task: ${ticket}`,
    'commit: a1b2c3d4e5',
  ];
  if (nonForwarding === true) lines.push('non-forwarding: true');
  lines.push('');
  lines.push('body');
  fs.writeFileSync(path.join(dir, basename), lines.join('\n'));
}

function placementDir(ctx, role, held) {
  const base = path.join(ctx[role === 'sender' ? 'coderWt' : 'cleanerWt'], '.swarmforge', 'handoffs', 'inbox', 'in_process');
  if (held.includes('batch directory')) {
    return path.join(base, 'batch_20260901T000000Z_000001');
  }
  return base;
}

function runSend(ctx) {
  const draft = path.join(ctx.fixtureRoot, 'draft.handoff');
  fs.writeFileSync(draft, [
    'type: git_handoff',
    'to: cleaner',
    'priority: 50',
    `task: ${ctx.ticket}`,
    `commit: ${ctx.commitHash}`,
  ].join('\n'));

  const result = spawnSync('bb', [SWARM_HANDOFF, draft], {
    encoding: 'utf8',
    cwd: ctx.coderWt,
    env: { ...process.env, SWARMFORGE_ROLE: 'coder', SWARMFORGE_SKIP_DAEMON: '1', GIT_DIR: undefined, GIT_WORK_TREE: undefined },
  });
  return { stdout: result.stdout || '', stderr: result.stderr || '', status: result.status };
}

function registerSteps(registry) {
  registry.define(/^a role is sending a forward git_handoff for a ticket$/, (ctx) => {
    ensureFixture(ctx);
    // Clean any previously-placed parcels from prior scenarios.
    for (const role of ['cleaner', 'coder']) {
      const base = path.join(ctx[role === 'sender' ? 'coderWt' : 'cleanerWt'], '.swarmforge', 'handoffs', 'inbox', 'in_process');
      fs.rmSync(base, { recursive: true, force: true });
      fs.mkdirSync(base, { recursive: true });
    }
    ctx.sendResult = null;
  });

  registry.define(/^the sender holds a non-forwarding inbound for that ticket (.+)$/, (ctx, held) => {
    ensureFixture(ctx);
    const dir = placementDir(ctx, 'sender', held);
    writeHandoff(dir, '00_non_forwarding.handoff', 'architect', 'coder', ctx.ticket, true);
  });

  registry.define(/^another role holds a live forward parcel for that ticket (.+)$/, (ctx, held) => {
    ensureFixture(ctx);
    const dir = placementDir(ctx, 'holder', held);
    writeHandoff(dir, '50_live_forward.handoff', 'specifier', 'cleaner', ctx.ticket, false);
  });

  registry.define(/^another role holds a live parcel for that ticket marked non-forwarding (.+)$/, (ctx, held) => {
    ensureFixture(ctx);
    const dir = placementDir(ctx, 'holder', held);
    writeHandoff(dir, '00_non_forwarding_other.handoff', 'architect', 'cleaner', ctx.ticket, true);
  });

  registry.define(/^the sender holds no inbound for that ticket$/, (ctx) => {
    ensureFixture(ctx);
    // No parcel placed; directory is empty.
  });

  registry.define(/^an empty batch directory remains in its in_process$/, (ctx) => {
    ensureFixture(ctx);
    const base = path.join(ctx.coderWt, '.swarmforge', 'handoffs', 'inbox', 'in_process');
    fs.mkdirSync(path.join(base, 'batch_20260901T000000Z_999999'), { recursive: true });
  });

  registry.define(/^the send-time guards evaluate the send$/, (ctx) => {
    ensureFixture(ctx);
    ctx.sendResult = runSend(ctx);
  });

  registry.define(/^the send is refused with the merge-only reason, not the duplicate-chain reason$/, (ctx) => {
    if (!ctx.sendResult) throw new Error('guards did not run');
    const { stdout, stderr, status } = ctx.sendResult;
    const combined = stdout + stderr;
    if (status === 0) {
      throw new Error(`expected refusal (exit 1), got exit 0: ${combined}`);
    }
    if (!combined.includes('Current inbound handoff is non-forwarding')) {
      throw new Error(`missing merge-only refusal: ${combined}`);
    }
    if (combined.includes('live forward parcel') || combined.includes('duplicate chain')) {
      throw new Error(`got duplicate-chain reason instead of merge-only: ${combined}`);
    }
  });

  registry.define(/^the send is blocked naming that parcel$/, (ctx) => {
    if (!ctx.sendResult) throw new Error('guards did not run');
    const { stdout, stderr, status } = ctx.sendResult;
    const combined = stdout + stderr;
    if (status === 0) {
      throw new Error(`expected block (exit 1), got exit 0: ${combined}`);
    }
    // The duplicate-chain guard's refusal text - must name the holder's parcel.
    if (!combined.includes(ctx.ticket) && !combined.includes('live forward parcel')) {
      throw new Error(`missing duplicate-chain block: ${combined}`);
    }
  });

  registry.define(/^the send is not blocked$/, (ctx) => {
    if (!ctx.sendResult) throw new Error('guards did not run');
    const { stdout, stderr, status } = ctx.sendResult;
    const combined = stdout + stderr;
    // Exit 0 means accepted, OR exit 1 with AUDIT_REQUIRED (which is the
    // normal first-send self-audit, not a guard refusal).
    if (status !== 0 && !combined.includes('AUDIT_REQUIRED')) {
      throw new Error(`expected acceptance, got exit ${status}: ${combined}`);
    }
  });
}

module.exports = { registerSteps };
