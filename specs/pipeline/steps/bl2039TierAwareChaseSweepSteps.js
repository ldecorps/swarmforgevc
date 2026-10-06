'use strict';

// BL-2039: step handlers for "The chase sweep never chases a seat over a
// parcel its tier refuses"
// (specs/features/BL-2039-the-chase-sweep-never-chases-a-seat-over-a-parcel-its-tier-refuses.feature).
//
// Drives the REAL chase_sweep_lib.bb (run-sweep! -> sweep-role-inbox! ->
// decide-item-action/item-tier-eligible?/idle-eligible-sibling) via
// chase_sweep_test_runner.bb - the SAME real fake-adapter (calls.log)
// harness test_chase_sweep.sh and BL-1652's own acceptance handler already
// use - never a reimplementation of the tier decision. Fixtures under
// mkdtemp, never this checkout's mailboxes (BL-1390).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CHASE_SWEEP_RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'chase_sweep_test_runner.bb');

const FEATURE = 'BL-2039 The chase sweep never chases a seat over a parcel its tier refuses';

const CHASE_TIMEOUT_S = 30;
const STUCK_TIMEOUT_S = 60;
const MAX_CHASES = 3;
const NOW_MS = 1759000000 * 1000;
// Past chaseTimeoutSeconds AND already chased three times, per the
// Background - and comfortably past stuckInProcessTimeoutSeconds so the
// item reaches decide-stale-item-action's "no recent pane activity" branch
// (the "coder's pane is quiet" Given), same convention as BL-1652's own
// handler.
const STALE_MTIME_S = NOW_MS / 1000 - CHASE_TIMEOUT_S - 5;
const LAST_ACTIVITY_MS = NOW_MS - 700 * 1000;
const TICKET_ID = 'BL-2022';

function mkRoot() {
  const root = trackedTmpRoot('sfvc-bl2039-');
  for (const sub of ['inbox/new', 'inbox/in_process', 'inbox/completed', 'inbox/abandoned', '.swarmforge', 'swarmforge', 'backlog/active']) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
  return root;
}

function writeConf(root, { coderTier, coder2Tier }) {
  const lines = [
    `window coder claude coder --model claude-sonnet-5 --seat-tier ${coderTier}`,
    `window coder@2 claude coder2 --model claude-opus-5 --seat-tier ${coder2Tier}`,
    '',
  ];
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), lines.join('\n'));
}

function writeRolesTsv(root) {
  const coder2Worktree = path.join(root, 'wt-coder2');
  fs.mkdirSync(path.join(coder2Worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  const rows = [
    `coder\tcoder\t${root}\tswarmforge-coder\tCoder\tclaude\ttask`,
    `coder@2\tcoder2\t${coder2Worktree}\tswarmforge-coder2\tCoder2\tclaude\ttask`,
    '',
  ];
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), rows.join('\n'));
  return coder2Worktree;
}

function writeTicket(root, mutationCost) {
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', `${TICKET_ID}-fixture-ticket.yaml`),
    `id: ${TICKET_ID}\ntitle: "fixture ticket"\nmutation_cost: ${mutationCost}\nstatus: active\n`
  );
}

function writeWorkNote(root) {
  const file = path.join(root, 'inbox', 'new', '01_work_note.handoff');
  fs.writeFileSync(
    file,
    `id: n01\nfrom: coordinator\nto: coder\npriority: 10\ntype: note\nmessage: Work ${TICKET_ID}\ncreated_at: 2026-10-06T08:00:00Z\n\nWork ${TICKET_ID}: merge main first, then read backlog/active\n`
  );
  const stamp = new Date(STALE_MTIME_S * 1000);
  fs.utimesSync(file, stamp, stamp);
  fs.writeFileSync(`${file}.chase.json`, JSON.stringify({ chaseCount: MAX_CHASES }));
  return file;
}

function markCoder2Busy(coder2Worktree) {
  fs.writeFileSync(
    path.join(coder2Worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process', 'held.handoff'),
    'id: h01\nfrom: specifier\nto: coder@2\npriority: 50\ntype: git_handoff\ntask: BL-9999\ncommit: 0123456789\n\nhi\n'
  );
}

function runSweep(ctx) {
  const result = spawnSync(
    'bb',
    [CHASE_SWEEP_RUNNER, ctx.root, String(NOW_MS), 'unknown', String(LAST_ACTIVITY_MS), 'coder'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        CHASE_TIMEOUT_SECONDS: String(CHASE_TIMEOUT_S),
        STUCK_TIMEOUT_SECONDS: String(STUCK_TIMEOUT_S),
        MAX_CHASES: String(MAX_CHASES),
      },
    }
  );
  if (result.status !== 0) {
    throw new Error(`chase_sweep_test_runner.bb failed (status ${result.status}): ${result.stderr}`);
  }
  const logPath = path.join(ctx.root, 'calls.log');
  ctx.callsLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture root whose coder stage has an easy-tier seat coder and a hard-tier seat coder@2 on different models$/,
    (ctx) => {
      ctx.root = mkRoot();
      writeConf(ctx.root, { coderTier: 'easy', coder2Tier: 'hard' });
      ctx.coder2Worktree = writeRolesTsv(ctx.root);
    }
  );

  scoped(
    /^a Work note for an active ticket in the coder stage queue, past the chase timeout and already chased three times$/,
    (ctx) => {
      ctx.itemFile = writeWorkNote(ctx.root);
    }
  );

  scoped(/^the coder seat's liveness reads unknown and its pane is quiet$/, () => {
    // Baked into runSweep's own fixed liveness="unknown" argument and the
    // LAST_ACTIVITY_MS comfortably past stuckInProcessTimeoutSeconds -
    // nothing to set per-scenario.
  });

  scoped(/^the ticket's mutation_cost is (low|medium|high)$/, (ctx, cost) => {
    writeTicket(ctx.root, cost);
  });

  scoped(/^the coder@2 seat has nothing in progress$/, () => {
    // The default fixture (writeRolesTsv) already creates an EMPTY
    // in_process dir for coder@2 - nothing to do; named explicitly so a
    // later scenario can mark it busy instead without changing this one.
  });

  scoped(/^the coder@2 seat is declared easy-tier too$/, (ctx) => {
    writeConf(ctx.root, { coderTier: 'easy', coder2Tier: 'easy' });
  });

  scoped(/^the daemon's chase sweep runs once on the fixture root$/, (ctx) => {
    runSweep(ctx);
  });

  scoped(/^no respawn is triggered for coder$/, (ctx) => {
    const lines = ctx.callsLog.split('\n').filter((l) => /^respawn coder$/.test(l));
    if (lines.length !== 0) {
      throw new Error(`expected no respawn for coder, got calls.log:\n${ctx.callsLog}`);
    }
  });

  scoped(/^exactly one respawn is triggered for coder$/, (ctx) => {
    const lines = ctx.callsLog.split('\n').filter((l) => /^respawn coder$/.test(l));
    if (lines.length !== 1) {
      throw new Error(`expected exactly one respawn for coder, got ${lines.length}. calls.log:\n${ctx.callsLog}`);
    }
  });

  scoped(/^no wake is sent to coder$/, (ctx) => {
    const lines = ctx.callsLog.split('\n').filter((l) => /^wake-up coder$/.test(l));
    if (lines.length !== 0) {
      throw new Error(`expected no wake sent to coder, got calls.log:\n${ctx.callsLog}`);
    }
  });

  scoped(/^a wake is sent to coder@2$/, (ctx) => {
    const lines = ctx.callsLog.split('\n').filter((l) => /^wake-up coder@2$/.test(l));
    if (lines.length !== 1) {
      throw new Error(`expected exactly one wake sent to coder@2, got ${lines.length}. calls.log:\n${ctx.callsLog}`);
    }
  });

  scoped(/^the Work note is still in the coder stage queue with no dead-letter marker$/, (ctx) => {
    if (!fs.existsSync(ctx.itemFile)) {
      throw new Error(`expected the Work note to still be in inbox/new/, it is gone: ${ctx.itemFile}`);
    }
    if (fs.existsSync(`${ctx.itemFile}.dead`)) {
      throw new Error(`expected no dead-letter marker for the Work note, found one`);
    }
  });

  scoped(/^the Work note carries a dead-letter marker$/, (ctx) => {
    if (fs.existsSync(ctx.itemFile)) {
      throw new Error(`expected the Work note to have been moved to a dead-letter marker, it is still in inbox/new/: ${ctx.itemFile}`);
    }
    if (!fs.existsSync(`${ctx.itemFile}.dead`)) {
      throw new Error(`expected a dead-letter marker at ${ctx.itemFile}.dead, found none. calls.log:\n${ctx.callsLog}`);
    }
  });
}

module.exports = { registerSteps };
