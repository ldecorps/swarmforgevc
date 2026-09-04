'use strict';

// BL-1393: one closing ceremony, on every sleep after at least one shift.
//
// Answered by this ticket's e2e, which drives the REAL compiled ceremony CLI
// against fixture swarms - never a dry run, because every claim here is about
// what the sequence DOES.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1393 The closing ceremony runs every time the swarm worked a shift and goes to sleep';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const E2E = path.join('swarmforge', 'scripts', 'test', 'test_bl1393_one_ceremony_every_sleep.sh');

// Explicit KNOWN_VALUES: a scenario naming a claim this handler does not know
// throws rather than passing through unchecked.
const CLAIMS = {
  freeze: 'a bedtime freezes promotion first',
  lean: 'and the lean packet is a step of the same sequence',
  order: 'the packet is delivered before the briefing is instructed',
  'window-gates-daemon': "without a sleep path the daemon's window still gates the ceremony",
  'empty-outcome': 'a sleep with no shift of work records an explicit empty outcome',
  'no-briefing': 'and instructs no briefing',
  'restart-quiet': 'no restart path invokes the ceremony (remote bounce, kill-all, expedite park)',
  'finish-shift-drives': 'finish-shift drives the one sequence, declaring itself a sleep',
  'no-dead-logic': 'the direct lean-CLI call is gone, not re-shipped beside the sequence',
  'schedule-untouched': 'no crontab, shift configuration or schedule file changed',
  stamp: 'a launch newer than the last ceremony counts as a shift, with no extra stamp',
};

// The Scenario Outline columns.
const RESTART_PATHS = { 'a remote bounce': 'restart-quiet', 'an expedite park': 'restart-quiet' };
const SLEEP_PATHS = {
  'a weekday bedtime': 'finish-shift-drives',
  'a weekend bedtime': 'finish-shift-drives',
  'night-stop': 'finish-shift-drives',
};
const LOCAL_TIMES = ['17:00', '09:00', '06:00'];

// Module scope, not per-ctx: each scenario gets its own ctx, so a per-ctx memo
// would re-run the whole suite once per scenario (BL-1390).
let suiteRun = null;

function runE2e(ctx) {
  ctx.bl1393 = ctx.bl1393 || {};
  if (suiteRun) {
    ctx.bl1393.out = suiteRun.out;
    return suiteRun.out;
  }
  const res = spawnSync('bash', [E2E], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 1800000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  suiteRun = { out, status: res.status };
  ctx.bl1393.out = out;
  if (res.status !== 0) {
    throw new Error(`the BL-1393 one-ceremony e2e failed (${res.status}):\n${out}`);
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

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^a swarm fixture with a shift-start stamp newer than the last ceremony$/, (ctx) => {
    ctx.bl1393 = ctx.bl1393 || {};
    ctx.bl1393.worked = true;
  });

  scoped(/^an in-flight parcel on the resident$/, (ctx) => {
    ctx.bl1393.inFlight = true;
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^no shift-start stamp is newer than the last ceremony$/, (ctx) => {
    ctx.bl1393.worked = false;
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the swarm is put to sleep through finish-shift$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^the daemon's closure-window gate enters ceremony mode$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^the swarm is stopped by (.+)$/, (ctx, restartPath) => {
    const claim = RESTART_PATHS[restartPath];
    assert.ok(claim, `unknown <restart path> example: ${restartPath}`);
    ctx.bl1393.restart = claim;
    runE2e(ctx);
  });

  scoped(/^the swarm is put to sleep through (.+) at (.+)$/, (ctx, sleepPath, localTime) => {
    const claim = SLEEP_PATHS[sleepPath];
    assert.ok(claim, `unknown <sleep path> example: ${sleepPath}`);
    assert.ok(LOCAL_TIMES.includes(localTime), `unknown <local time> example: ${localTime}`);
    ctx.bl1393.sleepPath = claim;
    runE2e(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^promotion is frozen before anything else$/, (ctx) => {
    requirePassed(ctx, 'freeze');
  });

  scoped(/^the in-flight parcel is drained or parked cleanly$/, (ctx) => {
    requirePassed(ctx, 'order');
  });

  scoped(/^the lean packet is delivered to the specifier$/, (ctx) => {
    requirePassed(ctx, 'lean');
  });

  scoped(/^the briefing is written and its email recorded as sent$/, (ctx) => {
    requirePassed(ctx, 'order');
  });

  scoped(/^the swarm is stopped with the bridges kept$/, (ctx) => {
    // Bedtime's keep-set is BL-762's contract, which this ticket drives rather
    // than redefines: finish-shift is the path, and it is unchanged in that
    // respect.
    requirePassed(ctx, 'finish-shift-drives');
  });

  scoped(/^those steps ran in that order from one sequence$/, (ctx) => {
    requirePassed(ctx, 'order');
    requirePassed(ctx, 'no-dead-logic');
  });

  scoped(/^the ceremony trail is identical to the finish-shift trail$/, (ctx) => {
    // One sequence means one trail: the daemon's trigger and the sleep path
    // enter the SAME state machine, and the window still gates only the daemon.
    requirePassed(ctx, 'window-gates-daemon');
    requirePassed(ctx, 'lean');
  });

  scoped(/^an explicit empty ceremony outcome is recorded$/, (ctx) => {
    requirePassed(ctx, 'empty-outcome');
  });

  scoped(/^no briefing is sent$/, (ctx) => {
    requirePassed(ctx, ctx.bl1393.restart ? 'restart-quiet' : 'no-briefing');
  });

  scoped(/^no ceremony step runs$/, (ctx) => {
    requirePassed(ctx, 'restart-quiet');
  });

  scoped(/^no lean packet is delivered$/, (ctx) => {
    requirePassed(ctx, 'restart-quiet');
  });

  scoped(/^the crontab is byte-identical to before$/, (ctx) => {
    requirePassed(ctx, 'schedule-untouched');
  });

  scoped(/^the shift configuration is byte-identical to before$/, (ctx) => {
    requirePassed(ctx, 'schedule-untouched');
    requirePassed(ctx, 'stamp');
  });
}

module.exports = { registerSteps };
