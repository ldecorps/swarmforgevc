'use strict';

// BL-499: step handlers for "the chase sweep never re-chases an already-
// completed handoff still lingering in new/". Drives the REAL compiled
// chase_sweep_lib.bb (run-sweep!) via chase_sweep_test_runner.bb - the
// SAME fixed-clock, fake-adapter (calls.log) sweep harness
// test_chase_sweep.sh already uses, mirroring sidecarNoOrphanSteps.js's
// own "standalone sweep fixture, no live tmux/daemon" pattern. No
// hand-rolled substitute for the real dedup/reap decision.
//
// Three step texts collide byte-for-byte with mailboxIntakeSteps.js
// (BL-218's own dequeue-path acceptance) - a DIFFERENT mechanism/ctx shape
// entirely (a real git worktree + ready_for_next_task.bb, vs this
// feature's standalone dir + chase_sweep_test_runner.bb), so all three are
// registered via defineScoped against this feature's own name
// (stepRegistry.js's BL-425 convention) rather than either silently
// winning over the other; every other step below is unique text and stays
// a plain define.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const SWEEP_RUNNER = path.join(SCRIPTS_DIR, 'test', 'chase_sweep_test_runner.bb');
const FEATURE_NAME = 'the chase sweep never re-chases an already-completed handoff still lingering in new/';

// A fixed clock (matching test_chase_sweep.sh's own NOW_MS) - file mtimes
// are stamped against it explicitly rather than real wall-clock time.
const NOW_MS = 1751500000 * 1000;
const CHASE_TIMEOUT_SECONDS = 30;
const STUCK_TIMEOUT_SECONDS = 60;
const MAX_CHASES = 3;
const STALE_MTIME_MS = NOW_MS - (CHASE_TIMEOUT_SECONDS + 5) * 1000;
const IDLE_LAST_ACTIVITY_MS = NOW_MS - (STUCK_TIMEOUT_SECONDS + 100) * 1000;

function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl499-'));
  for (const sub of ['new', 'in_process', 'completed', 'abandoned']) {
    fs.mkdirSync(path.join(root, 'inbox', sub), { recursive: true });
  }
  return root;
}

function writeHandoff(filePath) {
  fs.writeFileSync(filePath, 'id: t\nfrom: specifier\nto: coder\npriority: 50\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n');
}

function runSweep(root, liveness, lastActivityMs) {
  execFileSync('bb', [SWEEP_RUNNER, root, String(NOW_MS), liveness, String(lastActivityMs)], {
    encoding: 'utf8',
    env: { ...process.env, CHASE_TIMEOUT_SECONDS: String(CHASE_TIMEOUT_SECONDS), STUCK_TIMEOUT_SECONDS: String(STUCK_TIMEOUT_SECONDS), MAX_CHASES: String(MAX_CHASES) },
  });
}

function readCallsLog(root) {
  const logPath = path.join(root, 'calls.log');
  return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a role mailbox with new\/, in_process\/, completed\/, and abandoned\/$/,
    (ctx) => {
      ctx.root = mkFixture();
      ctx.handoffPath = path.join(ctx.root, 'inbox', 'new', '00_item.handoff');
    },
    FEATURE_NAME
  );

  registry.define(/^a stale copy sits in new\/ with an mtime older than the chase timeout$/, (ctx) => {
    writeHandoff(ctx.handoffPath);
    const stamp = new Date(STALE_MTIME_MS);
    fs.utimesSync(ctx.handoffPath, stamp, stamp);
  });

  // ── chase-sweep-terminal-dup-01 (Scenario Outline) ──────────────────────
  registry.defineScoped(
    /^a handoff whose id already exists in (completed|abandoned)\/$/,
    (ctx, state) => {
      writeHandoff(path.join(ctx.root, 'inbox', state, '00_item.handoff'));
    },
    FEATURE_NAME
  );

  registry.define(/^the recipient role has recent activity$/, (ctx) => {
    ctx.liveness = 'alive';
    ctx.lastActivityMs = NOW_MS;
  });

  registry.define(/^the chase sweep runs for the role$/, (ctx) => {
    runSweep(ctx.root, ctx.liveness, ctx.lastActivityMs);
    ctx.callsLog = readCallsLog(ctx.root);
  });

  registry.define(/^no wake-up is sent for the stale copy and its chase count is not incremented$/, (ctx) => {
    if (/wake-up/.test(ctx.callsLog)) {
      throw new Error(`expected no wake-up call for a terminal duplicate, got calls.log:\n${ctx.callsLog}`);
    }
    if (fs.existsSync(ctx.handoffPath + '.chase.json')) {
      throw new Error('expected no .chase.json sidecar written (chaseCount never incremented) for a reaped duplicate');
    }
  });

  registry.define(/^the stale copy is reaped from new\/ and never promoted to in_process\/$/, (ctx) => {
    if (fs.existsSync(ctx.handoffPath)) {
      throw new Error(`expected the stale duplicate reaped (removed) from new/, still present: ${ctx.handoffPath}`);
    }
    const inProcess = fs.readdirSync(path.join(ctx.root, 'inbox', 'in_process'));
    if (inProcess.length !== 0) {
      throw new Error(`expected nothing promoted to in_process/, found: ${JSON.stringify(inProcess)}`);
    }
  });

  registry.define(/^the reap is recorded as an auditable "already-processed" line$/, (ctx) => {
    if (!/^telemetry already-processed coder 00_item\.handoff/m.test(ctx.callsLog)) {
      throw new Error(`expected an auditable "already-processed" telemetry line, got calls.log:\n${ctx.callsLog}`);
    }
  });

  // ── chase-sweep-terminal-dup-02 ──────────────────────────────────────────
  registry.define(/^the recipient role is idle with the stale copy's chase count already at the dead-letter threshold$/, (ctx) => {
    fs.writeFileSync(ctx.handoffPath + '.chase.json', JSON.stringify({ chaseCount: MAX_CHASES }));
    ctx.liveness = 'alive';
    ctx.lastActivityMs = IDLE_LAST_ACTIVITY_MS;
  });

  registry.define(/^the stale copy is not dead-lettered$/, (ctx) => {
    if (/dead-letter/.test(ctx.callsLog)) {
      throw new Error(`expected no dead-letter call for a terminal duplicate, even from an idle role at the chase-count cap, got calls.log:\n${ctx.callsLog}`);
    }
    if (fs.existsSync(ctx.handoffPath + '.dead')) {
      throw new Error('expected no .dead file created for a reaped duplicate');
    }
  });

  // ── chase-sweep-terminal-dup-03 (regression guard) ──────────────────────
  registry.defineScoped(
    /^a handoff in new\/ whose id is in neither completed\/ nor abandoned\/$/,
    (ctx) => {
      // The Background already wrote the stale copy into new/ with no
      // completed/abandoned counterpart - this step just documents the
      // precondition (both dirs stay empty, the fixture's own default).
      const completed = fs.readdirSync(path.join(ctx.root, 'inbox', 'completed'));
      const abandoned = fs.readdirSync(path.join(ctx.root, 'inbox', 'abandoned'));
      if (completed.length !== 0 || abandoned.length !== 0) {
        throw new Error('fixture bug: expected completed/ and abandoned/ both empty for the regression-guard scenario');
      }
    },
    FEATURE_NAME
  );

  registry.define(/^the handoff is chased and a wake-up is sent for it$/, (ctx) => {
    if (!/^wake-up coder$/m.test(ctx.callsLog)) {
      throw new Error(`expected a wake-up call for a genuinely stuck handoff, got calls.log:\n${ctx.callsLog}`);
    }
  });

  registry.define(/^its chase count is incremented$/, (ctx) => {
    const sidecar = JSON.parse(fs.readFileSync(ctx.handoffPath + '.chase.json', 'utf8'));
    if (sidecar.chaseCount !== 1) {
      throw new Error(`expected chaseCount incremented to 1, got: ${JSON.stringify(sidecar)}`);
    }
  });

  // ── chase-sweep-terminal-dup-04 ──────────────────────────────────────────
  registry.define(/^the stale copy in new\/ has a "\.chase\.json" sidecar beside it$/, (ctx) => {
    fs.writeFileSync(ctx.handoffPath + '.chase.json', JSON.stringify({ chaseCount: 2, lastChasedAtMs: NOW_MS - 999999 }));
  });

  registry.define(/^no "\.chase\.json" sidecar for it remains in new\/$/, (ctx) => {
    if (fs.existsSync(ctx.handoffPath + '.chase.json')) {
      throw new Error('expected no orphaned .chase.json sidecar left behind after the reap');
    }
  });
}

module.exports = { registerSteps };
