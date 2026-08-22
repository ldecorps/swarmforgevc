'use strict';

// BL-678: step handlers for "Batch claim progress sidecar". Drives the REAL
// production/test-harness scripts, never a re-derived approximation:
//   - ready_for_next_batch.bb (the real production claim path) claims two
//     fixture parcels for real - proving invariant 1 (sidecar written the
//     instant a batch item is claimed) end to end.
//   - batch_claim_progress_cli.bb's mark-progress/retire subcommands drive
//     the same pure batch_claim_progress_lib.bb functions production code
//     uses, with an injectable clock/commit.
//   - batch_claim_progress_sweep_harness.bb mirrors handoffd.bb's own
//     batch-claim-progress-sweep!/nudge-coordinator-batch-claim-suspect!
//     exactly (same chase_sweep_lib.bb functions, same real swarm_handoff.
//     bb send path) - "the chase sweep runs" exercises the real mechanism.
//     Mirrors bl719DroppedParcelNudgeSteps.js's own posture exactly.
//
// Scenarios 3/4's Given directly sets the sidecar's own lastProgressAtMs to
// a controlled offset from "now" (the Background's "injected clock and
// sidecar paths" language) rather than sleeping real wall-clock time -
// deterministic, no flakiness.
//
// done_with_current_batch.bb is deliberately NOT used for scenario 5
// (retirement): its run-ready! re-execs the REAL ready_for_next_batch.sh,
// which `cd`s to the real repo's own scripts dir before resolving the
// worktree root from cwd - unsafe to drive against a fixture root when the
// process invoking it lives inside a real, currently-in-use role worktree
// (see batch_claim_progress_cli.bb's own "retire" doc comment). The CLI's
// "retire" subcommand calls the exact same handoff-lib/remove-sidecars-of!
// done_with_current_batch.bb calls, without that unsafe exec chain.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const READY_BATCH_BB = path.join(SWARMFORGE_SCRIPTS, 'ready_for_next_batch.bb');
const CLI = path.join(SWARMFORGE_SCRIPTS, 'batch_claim_progress_cli.bb');
const SWEEP_HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'batch_claim_progress_sweep_harness.bb');

const COOLDOWN_MS = 60000;

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
}

function writeHandoff(dir, basename, headers) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(path.join(dir, basename), lines.join('\n') + '\n\nbody\n');
}

function batchWorktree(ctx) {
  return path.join(ctx.targetPath, '.worktrees', 'batchrole');
}

function batchNewDir(ctx) {
  return path.join(batchWorktree(ctx), '.swarmforge', 'handoffs', 'inbox', 'new');
}

function batchInProcessDir(ctx) {
  return path.join(batchWorktree(ctx), '.swarmforge', 'handoffs', 'inbox', 'in_process');
}

function coordinatorOutboxDir(ctx) {
  return path.join(ctx.targetPath, '.swarmforge', 'handoffs', 'coordinator', 'outbox');
}

function findBatchDir(ctx) {
  const dir = batchInProcessDir(ctx);
  const entries = fs.readdirSync(dir).filter((e) => e.startsWith('batch_'));
  if (entries.length !== 1) {
    throw new Error(`expected exactly one batch_* dir under ${dir}, found: ${entries.join(', ')}`);
  }
  return path.join(dir, entries[0]);
}

function sidecarPathFor(handoffPath) {
  return `${handoffPath}.batch-claim-progress.json`;
}

function readSidecar(handoffPath) {
  return JSON.parse(fs.readFileSync(sidecarPathFor(handoffPath), 'utf8'));
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

function ensureFixture(ctx) {
  if (ctx.targetPath) return;
  ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl678-'));
  git(ctx.targetPath, ['init', '-q']);
  git(ctx.targetPath, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  const wt = batchWorktree(ctx);
  git(ctx.targetPath, ['worktree', 'add', '-q', '-b', 'batchrole', wt]);

  const rolesTsv = [
    ['batchrole', 'batchrole', wt, 'swarmforge-batchrole', 'Batchrole', 'claude', 'batch'],
    ['coordinator', 'master', ctx.targetPath, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task'],
  ]
    .map((r) => r.join('\t'))
    .join('\n') + '\n';
  fs.mkdirSync(path.join(ctx.targetPath, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(wt, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(ctx.targetPath, '.swarmforge', 'roles.tsv'), rolesTsv);
  fs.writeFileSync(path.join(wt, '.swarmforge', 'roles.tsv'), rolesTsv);

  // Two equal-priority parcels so a single claim batches both together -
  // basenames sort deterministically ("first" before "second").
  // Distinct ticket ids (not just distinct basenames) so a suspect note can
  // be checked to name the RIGHT parcel specifically - extract-ticket-id
  // pulls only the leading "BL-<digits>" token, so "BL-678 first ..." and
  // "BL-678-first ..." would extract identically; two different ids avoid
  // that ambiguity.
  writeHandoff(batchNewDir(ctx), '10_first.handoff', {
    id: 't1',
    from: 'specifier',
    to: 'batchrole',
    recipient: 'batchrole',
    priority: '50',
    type: 'note',
    message: 'BL-678 first batch item',
    created_at: '2026-07-01T00:00:00Z',
  });
  writeHandoff(batchNewDir(ctx), '20_second.handoff', {
    id: 't2',
    from: 'specifier',
    to: 'batchrole',
    recipient: 'batchrole',
    priority: '50',
    type: 'note',
    message: 'BL-679 second batch item',
    created_at: '2026-07-01T00:00:00Z',
  });

  // The REAL production claim path - proves invariant 1 end to end.
  execFileSync('bb', [READY_BATCH_BB], { cwd: wt, env: { ...process.env, SWARMFORGE_ROLE: 'batchrole' } });

  const batchDir = findBatchDir(ctx);
  ctx.firstParcelPath = path.join(batchDir, '10_first.handoff');
  ctx.secondParcelPath = path.join(batchDir, '20_second.handoff');
}

function registerSteps(registry) {
  registry.define(/^a batch role claims two parcels with injected clock and sidecar paths$/, (ctx) => {
    ensureFixture(ctx);
  });

  // ── batch-claim-progress-sidecar-01 ──────────────────────────────────────
  registry.define(/^the batch claim completes$/, () => {
    // No-op: the Background already performed the real claim.
  });

  registry.define(
    /^each claimed parcel has a sidecar naming the owner role, parcel id, and claim instant$/,
    (ctx) => {
      for (const [label, p] of [
        ['first', ctx.firstParcelPath],
        ['second', ctx.secondParcelPath],
      ]) {
        if (!fs.existsSync(sidecarPathFor(p))) {
          throw new Error(`expected the ${label} parcel's sidecar to exist at claim time: ${sidecarPathFor(p)}`);
        }
        const sidecar = readSidecar(p);
        if (sidecar.ownerRole !== 'batchrole') {
          throw new Error(`expected the ${label} parcel's sidecar to name owner role "batchrole", got: ${JSON.stringify(sidecar)}`);
        }
        if (!sidecar.parcelId) {
          throw new Error(`expected the ${label} parcel's sidecar to name a parcel id, got: ${JSON.stringify(sidecar)}`);
        }
        if (typeof sidecar.claimAtMs !== 'number') {
          throw new Error(`expected the ${label} parcel's sidecar to record a claim instant, got: ${JSON.stringify(sidecar)}`);
        }
      }
    }
  );

  // ── batch-claim-progress-sidecar-02 ──────────────────────────────────────
  registry.define(/^the batch role makes progress on the first parcel$/, (ctx) => {
    const before = readSidecar(ctx.firstParcelPath);
    const laterMs = before.claimAtMs + 5000;
    execFileSync('bb', [CLI, 'mark-progress', ctx.firstParcelPath, 'cccccccccc', String(laterMs)]);
  });

  registry.define(/^the first parcel's sidecar last-progress instant is later than its claim instant$/, (ctx) => {
    const sidecar = readSidecar(ctx.firstParcelPath);
    if (!(sidecar.lastProgressAtMs > sidecar.claimAtMs)) {
      throw new Error(`expected lastProgressAtMs > claimAtMs, got: ${JSON.stringify(sidecar)}`);
    }
  });

  // ── batch-claim-progress-sidecar-03/04 ───────────────────────────────────
  registry.define(
    /^a claimed parcel whose sidecar progress is (fresher|older) than the staleness threshold$/,
    (ctx, freshness) => {
      const sidecar = readSidecar(ctx.firstParcelPath);
      const nowMs = Date.now();
      // Injected clock: directly set the sidecar's own last-progress
      // instant to a controlled offset from "now" - deterministic, no
      // real-wall-clock sleep needed.
      sidecar.lastProgressAtMs = freshness === 'fresher' ? nowMs - 10_000 : nowMs - 10_000_000;
      fs.writeFileSync(sidecarPathFor(ctx.firstParcelPath), JSON.stringify(sidecar));
      // Threshold set so the fresher case is comfortably under it (1h) and
      // the older case is comfortably over it (10s) - same sidecar offsets
      // above, different threshold per scenario.
      ctx.stalenessMs = freshness === 'fresher' ? 3_600_000 : 10_000;
    }
  );

  registry.define(/^the chase sweep runs$/, (ctx) => {
    ctx.sweepOutput = execFileSync('bb', [SWEEP_HARNESS, ctx.targetPath, String(ctx.stalenessMs), String(COOLDOWN_MS)], {
      encoding: 'utf8',
    });
  });

  registry.define(/^the parcel is not re-forwarded, not re-delivered, and not surfaced as suspect$/, (ctx) => {
    if (!fs.existsSync(ctx.firstParcelPath)) {
      throw new Error(`expected the parcel to remain claimed in in_process, but it is gone: ${ctx.firstParcelPath}`);
    }
    const redelivered = path.join(batchNewDir(ctx), path.basename(ctx.firstParcelPath));
    if (fs.existsSync(redelivered)) {
      throw new Error(`expected no re-delivery to inbox/new, but found: ${redelivered}`);
    }
    const suspectNotes = readCoordinatorOutbox(ctx).filter((c) => /batch claim stale/.test(c));
    if (suspectNotes.length > 0) {
      throw new Error(`expected no suspect surface note for a fresh-progress parcel, got: ${suspectNotes.join('\n---\n')}`);
    }
  });

  registry.define(
    /^the coordinator receives a suspect surface line naming the parcel and its progress age$/,
    (ctx) => {
      const suspectNotes = readCoordinatorOutbox(ctx).filter((c) => /batch claim stale/.test(c));
      if (suspectNotes.length === 0) {
        throw new Error(`expected a batch-claim-progress suspect note, got sweep output: ${ctx.sweepOutput}`);
      }
      if (!suspectNotes.some((c) => /^to: coordinator$/m.test(c))) {
        throw new Error(`expected the suspect note addressed to the coordinator, got: ${suspectNotes.join('\n---\n')}`);
      }
      if (!suspectNotes.some((c) => /^message: BL-678 /m.test(c))) {
        throw new Error(`expected the suspect note to name the first parcel's id (BL-678), got: ${suspectNotes.join('\n---\n')}`);
      }
      if (suspectNotes.some((c) => /BL-679/.test(c))) {
        throw new Error(`expected the suspect note to name only the first parcel, not the second (BL-679), got: ${suspectNotes.join('\n---\n')}`);
      }
    }
  );

  registry.define(/^the parcel remains claimed in in_process with no copy in inbox new$/, (ctx) => {
    if (!fs.existsSync(ctx.firstParcelPath)) {
      throw new Error(`expected the stale-but-live parcel to remain claimed in in_process: ${ctx.firstParcelPath}`);
    }
    const redelivered = path.join(batchNewDir(ctx), path.basename(ctx.firstParcelPath));
    if (fs.existsSync(redelivered)) {
      throw new Error(`expected no re-delivery to inbox/new even when stale, but found: ${redelivered}`);
    }
  });

  // ── batch-claim-progress-sidecar-05 ──────────────────────────────────────
  registry.define(/^the batch role completes the first parcel$/, (ctx) => {
    execFileSync('bb', [CLI, 'retire', ctx.firstParcelPath]);
  });

  registry.define(/^the first parcel's sidecar no longer reads as an active claim$/, (ctx) => {
    if (fs.existsSync(sidecarPathFor(ctx.firstParcelPath))) {
      throw new Error(`expected the first parcel's sidecar to be retired (gone), but it still exists: ${sidecarPathFor(ctx.firstParcelPath)}`);
    }
  });
}

module.exports = { registerSteps };
