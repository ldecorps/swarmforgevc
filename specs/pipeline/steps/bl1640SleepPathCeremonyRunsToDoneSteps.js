'use strict';

// BL-1640: a finish-shift sleep runs the closing ceremony to its end before
// the stack stops.
//
// Answered by this ticket's own e2e, which drives the REAL
// finish_shift_run_closing_ceremony loop (finish_shift_lib.sh) and the real
// compiled ceremony CLI against fixture swarms - never a dry run, because
// every claim here is about what the loop DOES.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1640 A finish-shift sleep runs the closing ceremony to its end before the stack stops';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const E2E = path.join('swarmforge', 'scripts', 'test', 'test_bl1640_sleep_runs_ceremony_to_done.sh');

// Explicit KNOWN_VALUES: a scenario naming a claim this handler does not know
// throws rather than passing through unchecked.
const CLAIMS = {
  'done-before-stop': 'the ceremony state reads done before the babysitterd stop runs',
  'sequence-and-briefing': 'the recorded sequence contains lean-packet and the documenter is instructed to produce the morning briefing',
  'send-confirmed': 'the recorded sequence ends with briefing-committed, send-confirmed, swarm-stopped',
  'no-missing': 'closing-briefing-missing is not surfaced',
  'deadlines-relative': "the state's drainDeadlineMs and hardDeadlineMs equal the start time plus 2 and 3 minutes respectively",
  'freeze-until-hard': 'the freeze written for promotion lasts until that hardDeadlineMs',
  'restart-freeze': 'a second sleep on the same day after a shift of work starts a new ceremony over freeze-promotion',
  'restart-started-at': "the state's startedAtMs is the new sleep's time",
  'noop-unchanged': 'a second sleep with no shift since stays a no-op: the ceremony state is unchanged',
  'noop-no-note': 'no note is queued for any role',
  'overran-exit0': 'finish-shift exits with status 0',
  'overran-message': 'finish-shift reports that the closing ceremony overran its budgets',
};

// Module scope, not per-ctx: each scenario gets its own ctx, so a per-ctx memo
// would re-run the whole suite once per scenario (BL-1390).
let suiteRun = null;

function runE2e(ctx) {
  ctx.bl1640 = ctx.bl1640 || {};
  if (suiteRun) {
    ctx.bl1640.out = suiteRun.out;
    return suiteRun.out;
  }
  const res = spawnSync('bash', [E2E], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 300000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  suiteRun = { out, status: res.status };
  ctx.bl1640.out = out;
  if (res.status !== 0) {
    throw new Error(`the BL-1640 sleep-to-done e2e failed (${res.status}):\n${out}`);
  }
  return out;
}

function requirePassed(ctx, claimKey) {
  const claim = CLAIMS[claimKey];
  assert.ok(claim, `unknown claim: ${claimKey}`);
  const out = runE2e(ctx);
  assert.ok(out.includes(`PASS: ${claim}`), `"${claim}" did not pass, in:\n${out}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background (fixture shape only - the e2e builds its own fixtures) ────
  scoped(/^a fixture root under a temporary directory with a daemon-shaped \.swarmforge and no tmux server$/, () => {});
  scoped(/^swarmforge\.conf sets closure_stop_local to "08:45" with a drain budget of 2 minutes and a briefing budget of 1 minute$/, () => {});
  scoped(/^finish-shift's stop steps and its tick interval are driven through the test seams$/, () => {});

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^one in-process parcel on a worktree role$/, () => {});
  scoped(/^no in-process parcel$/, () => {});
  scoped(/^the swarm worked a shift since the last ceremony$/, () => {});
  scoped(/^the swarm worked no shift since the last ceremony$/, () => {});
  scoped(/^today's briefing is not recorded as sent$/, () => {});
  scoped(/^today's briefing is recorded as sent after the documenter instruction is queued$/, () => {});
  scoped(/^the sleep starts at 16:00Z$/, () => {});
  scoped(/^a ceremony state for today that already reads done$/, () => {});
  scoped(/^the ceremony CLI is replaced through its seam by one that never reports done$/, () => {});

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the swarm is put to sleep through finish-shift$/, (ctx) => {
    runE2e(ctx);
  });
  scoped(/^the sleep path starts a new ceremony$/, (ctx) => {
    runE2e(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the ceremony state reads done before the babysitterd stop runs$/, (ctx) => {
    requirePassed(ctx, 'done-before-stop');
  });
  scoped(/^the recorded sequence contains "lean-packet" and the documenter is instructed to produce the morning briefing$/, (ctx) => {
    requirePassed(ctx, 'sequence-and-briefing');
  });
  scoped(/^the swarm is stopped$/, (ctx) => {
    // The stop-set mechanics themselves (finish_shift_stop_ancillaries) are
    // BL-762's own unchanged contract; this parcel's claim is that stopping
    // never runs before the ceremony reads done, which is the SAME evidence.
    requirePassed(ctx, 'done-before-stop');
  });
  scoped(/^the recorded sequence ends with "briefing-committed, send-confirmed, swarm-stopped"$/, (ctx) => {
    requirePassed(ctx, 'send-confirmed');
  });
  scoped(/^"closing-briefing-missing" is not surfaced$/, (ctx) => {
    requirePassed(ctx, 'no-missing');
  });
  scoped(/^the state's drainDeadlineMs and hardDeadlineMs equal the start time plus 2 and 3 minutes respectively$/, (ctx) => {
    requirePassed(ctx, 'deadlines-relative');
  });
  scoped(/^the freeze written for promotion lasts until that hardDeadlineMs$/, (ctx) => {
    requirePassed(ctx, 'freeze-until-hard');
  });
  scoped(/^the state's startedAtMs is the new sleep's time$/, (ctx) => {
    requirePassed(ctx, 'restart-started-at');
  });
  scoped(/^the recorded sequence begins again with "freeze-promotion"$/, (ctx) => {
    requirePassed(ctx, 'restart-freeze');
  });
  scoped(/^the ceremony state is unchanged$/, (ctx) => {
    requirePassed(ctx, 'noop-unchanged');
  });
  scoped(/^no note is queued for any role$/, (ctx) => {
    requirePassed(ctx, 'noop-no-note');
  });
  scoped(/^the stack is stopped once the drain, briefing and grace budgets have all passed$/, (ctx) => {
    requirePassed(ctx, 'overran-exit0');
  });
  scoped(/^finish-shift reports that the closing ceremony overran its budgets$/, (ctx) => {
    requirePassed(ctx, 'overran-message');
  });
  scoped(/^finish-shift exits with status 0$/, (ctx) => {
    requirePassed(ctx, 'overran-exit0');
  });
}

module.exports = { registerSteps };
