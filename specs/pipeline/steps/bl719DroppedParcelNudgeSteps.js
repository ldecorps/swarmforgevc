'use strict';

// BL-719: step handlers for the dropped-parcel-nudge feature. Drives the
// real chase_sweep_lib.bb + swarm_handoff.bb through
// dropped_parcel_sweep_harness.bb (a thin test-only wrapper mirroring
// handoffd.bb's own dropped-parcel-sweep!/nudge-coordinator-dropped-
// parcel! exactly) plus the existing dispatch_gap_sweep_harness.bb (BL-719
// dropped-parcel-nudge-04 asserts BL-222's sweep is unaffected) - never a
// live daemon or tmux session. Mirrors dispatchGapSteps.js's own posture.
//
// "the sweep runs" is a step TEXT shared with dispatchGapSteps.js, which
// registers it first (registry first-match). Rather than re-registering
// it here (ineffective/confusing under first-match), this file hooks in
// via ctx.droppedParcelSweepRunner - the SAME extension point
// stuckEscalationEmailSteps.js already established for its own
// ctx.stuckEscalationRunner (see dispatchGapSteps.js's "the sweep runs"
// handler).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const DROPPED_PARCEL_HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'dropped_parcel_sweep_harness.bb');
const DISPATCH_GAP_HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'dispatch_gap_sweep_harness.bb');

const ITEM_ID = 'BL-719';
// Small, fixed values so the harness never waits on real wall-clock time -
// only the fixture handoffs' own enqueued_at header (below) controls "old"
// vs "new" trail freshness.
const STALL_THRESHOLD_MS = 60000;
const COOLDOWN_MS = 60000;
const STALE_INSTANT = '2020-01-01T00:00:00.000000Z';
const freshInstant = () => new Date().toISOString();

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function ensureTargetPath(ctx) {
  if (!ctx.targetPath) {
    ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-dropped-parcel-'));
    git(ctx.targetPath, ['init', '-q']);
    git(ctx.targetPath, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  }
  return ctx.targetPath;
}

function coderWorktree(ctx) {
  return path.join(ctx.targetPath, '.worktrees', 'coder');
}

function writeRolesTsv(ctx) {
  const targetPath = ctx.targetPath;
  fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
  const rows = [
    ['coordinator', 'master', targetPath, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task'],
    ['coder', 'coder', coderWorktree(ctx), 'swarmforge-coder', 'Coder', 'claude', 'task'],
  ];
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), rows.map((r) => r.join('\t')).join('\n') + '\n');
}

function writeActiveItem(ctx) {
  const activeDir = path.join(ctx.targetPath, 'backlog', 'active');
  fs.mkdirSync(activeDir, { recursive: true });
  fs.writeFileSync(
    path.join(activeDir, `${ITEM_ID}-demo.yaml`),
    `id: ${ITEM_ID}\ntitle: "demo"\nstatus: todo\nassigned_to: coder\n`
  );
}

function writeHandoff(dir, basename, headers) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(path.join(dir, basename), lines.join('\n') + '\n\nbody\n');
}

function coderSentDir(ctx) {
  return path.join(coderWorktree(ctx), '.swarmforge', 'handoffs', 'sent');
}

function coderNewDir(ctx) {
  return path.join(coderWorktree(ctx), '.swarmforge', 'handoffs', 'inbox', 'new');
}

function coderInProcessDir(ctx) {
  return path.join(coderWorktree(ctx), '.swarmforge', 'handoffs', 'inbox', 'in_process');
}

function coordinatorOutboxDir(ctx) {
  return path.join(ctx.targetPath, '.swarmforge', 'handoffs', 'coordinator', 'outbox');
}

function cooldownStatePath(ctx) {
  return path.join(ctx.targetPath, '.swarmforge', 'daemon', 'dropped-parcel-nudge-cooldown.json');
}

function readCoordinatorOutbox(ctx) {
  const dir = coordinatorOutboxDir(ctx);
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.handoff'));
  } catch {
    files = [];
  }
  return files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
}

function listDroppedParcelNudges(ctx, itemId) {
  return readCoordinatorOutbox(ctx).filter((c) => new RegExp(`^message: ${itemId} no parcel in flight`, 'm').test(c));
}

function listQueuedTo(ctx, role) {
  return readCoordinatorOutbox(ctx).filter((c) => new RegExp(`^to: ${role}$`, 'm').test(c));
}

function registerSteps(registry) {
  registry.define(/^an item in backlog\/active\/ with an assigned_to$/, (ctx) => {
    ensureTargetPath(ctx);
    writeRolesTsv(ctx);
    writeActiveItem(ctx);
    // Established here (Background runs before every scenario's own
    // Given/When) so it is set regardless of which scenario follows -
    // see the file header comment on the ctx.droppedParcelSweepRunner
    // extension point.
    ctx.droppedParcelSweepRunner = () => {
      ctx.droppedParcelSweepOutput = execFileSync(
        'bb',
        [DROPPED_PARCEL_HARNESS, ctx.targetPath, String(STALL_THRESHOLD_MS), String(COOLDOWN_MS)],
        { encoding: 'utf8' }
      );
      // BL-719 dropped-parcel-nudge-04 requires BL-222's own sweep to run
      // unaffected in the SAME tick - real daemon wiring runs both.
      ctx.dispatchGapSweepOutput = execFileSync('bb', [DISPATCH_GAP_HARNESS, ctx.targetPath], { encoding: 'utf8' });
    };
  });

  registry.define(/^the sweep runs on the existing chase cadence$/, () => {
    // Non-behavioral gate (BL-719 required_wiring): pin that
    // dropped-parcel-sweep! is wired into the SAME cadence conditional as
    // chase-sweep!/dispatch-gap-sweep! in handoffd.bb, not a standalone
    // timer - mirrors dispatchGapSteps.js's own cadence check exactly.
    const src = fs.readFileSync(path.join(SWARMFORGE_SCRIPTS, 'handoffd.bb'), 'utf8');
    const cadenceBlock = src.split('chase-sweep-every-cycles))')[1] || '';
    if (!/dropped-parcel-sweep!/.test(cadenceBlock)) {
      throw new Error('expected dropped-parcel-sweep! to share chase-sweep!\'s existing cadence, not a separate timeout');
    }
  });

  registry.define(/^a handoff trail already mentions the item$/, (ctx) => {
    writeHandoff(coderSentDir(ctx), '00_trail.handoff', {
      from: 'coder',
      to: 'cleaner',
      type: 'git_handoff',
      task: `${ITEM_ID}-demo`,
      commit: '0000000000',
      enqueued_at: STALE_INSTANT,
    });
  });

  registry.define(/^no handoff trail mentions the item at all$/, () => {
    // No-op: the Background fixture starts with zero dispatch trail.
  });

  registry.define(/^no parcel for the item sits in any role's new or in_process$/, () => {
    // No-op: the fixture starts with empty new/in_process mailboxes.
  });

  registry.define(/^a parcel for the item sits in a role's (new|in_process)$/, (ctx, state) => {
    const dir = state === 'new' ? coderNewDir(ctx) : coderInProcessDir(ctx);
    writeHandoff(dir, '00_live.handoff', {
      from: 'documenter',
      to: 'coder',
      type: 'git_handoff',
      task: `${ITEM_ID}-demo`,
      commit: '1111111111',
    });
  });

  registry.define(/^the item's newest trail event is older than the stall threshold$/, () => {
    // No-op: "a handoff trail already mentions the item" already stamped
    // the trail file with STALE_INSTANT (2020), well past STALL_THRESHOLD_MS.
  });

  registry.define(/^the item's newest trail event is newer than the stall threshold$/, (ctx) => {
    // Overwrite the trail file's timestamp to "now" - fresh, not stale.
    writeHandoff(coderSentDir(ctx), '00_trail.handoff', {
      from: 'coder',
      to: 'cleaner',
      type: 'git_handoff',
      task: `${ITEM_ID}-demo`,
      commit: '0000000000',
      enqueued_at: freshInstant(),
    });
  });

  registry.define(/^a prior nudge for the item was sent inside the cooldown window$/, (ctx) => {
    ensureTargetPath(ctx);
    fs.mkdirSync(path.dirname(cooldownStatePath(ctx)), { recursive: true });
    fs.writeFileSync(cooldownStatePath(ctx), JSON.stringify({ [ITEM_ID]: Date.now() }));
  });

  registry.define(/^the coordinator receives a note naming the item as having no parcel in flight$/, (ctx) => {
    const nudges = listDroppedParcelNudges(ctx, ITEM_ID);
    if (nudges.length === 0) {
      throw new Error(`expected a dropped-parcel nudge naming ${ITEM_ID}, got sweep output: ${ctx.droppedParcelSweepOutput}`);
    }
    if (!nudges.some((c) => /^to: coordinator$/m.test(c))) {
      throw new Error(`expected the nudge addressed to the coordinator, got: ${nudges.join('\n---\n')}`);
    }
  });

  registry.define(/^the sweep writes no assigned_to, routes nothing, and moves no backlog file$/, (ctx) => {
    const activeFile = path.join(ctx.targetPath, 'backlog', 'active', `${ITEM_ID}-demo.yaml`);
    if (!fs.existsSync(activeFile)) {
      throw new Error(`expected ${activeFile} to remain in backlog/active/ - the sweep must never move a backlog file`);
    }
    const content = fs.readFileSync(activeFile, 'utf8');
    if (!/^assigned_to: coder$/m.test(content)) {
      throw new Error(`expected assigned_to to remain unchanged, got: ${content}`);
    }
    const routedToCoder = [coderNewDir(ctx), coderInProcessDir(ctx)].flatMap((dir) => {
      try {
        return fs.readdirSync(dir).filter((f) => f.endsWith('.handoff'));
      } catch {
        return [];
      }
    });
    if (routedToCoder.length > 0) {
      throw new Error(`expected the sweep to route nothing to coder, found: ${routedToCoder.join(', ')}`);
    }
  });

  registry.define(/^the sweep sends no nudge for the item$/, (ctx) => {
    const nudges = listDroppedParcelNudges(ctx, ITEM_ID);
    if (nudges.length > 0) {
      throw new Error(`expected no dropped-parcel nudge for ${ITEM_ID}, got: ${nudges.join('\n---\n')}`);
    }
  });

  registry.define(/^the dispatch-gap sweep auto-routes the item as it did before$/, (ctx) => {
    // dispatch_gap_sweep_harness.bb's auto-route! (no commit arg) falls
    // back to the legacy soft `note` (message header), not a git_handoff
    // (task header) - match either, same as dispatchGapSteps.js's own
    // listQueuedNotesFor check.
    const routed = listQueuedTo(ctx, 'coder').filter(
      (c) => new RegExp(`task: ${ITEM_ID}`).test(c) || new RegExp(`^message: ${ITEM_ID} `, 'm').test(c)
    );
    if (routed.length === 0) {
      throw new Error(`expected the dispatch-gap sweep to still auto-route ${ITEM_ID} to coder, got: ${ctx.dispatchGapSweepOutput}`);
    }
  });
}

module.exports = { registerSteps };
