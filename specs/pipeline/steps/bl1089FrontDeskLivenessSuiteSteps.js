'use strict';

// BL-1089: step handlers for "The front-desk liveness suite gates the
// guarantee it names".
//
// Scenarios 01 and 05 drive the REAL shell suite
// (test_front_desk_supervisor_liveness.sh) and grep its PASS lines — same
// pattern as frontDeskLivenessMeansListeningSteps.js (BL-370).
//
// Scenarios 02–04 pin BL-1035's own-heartbeat / grace semantics via the pure
// poll-heartbeat-stale? predicate (pinned clock, no supervisor process), so
// the suite's repaired fixture cannot go green by emptying that guard.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const FEATURE = 'The front-desk liveness suite gates the guarantee it names';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'front_desk_supervisor_lib.bb');
const LIVENESS_TEST = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_front_desk_supervisor_liveness.sh'
);

const STALL_MS = 1000;
const GRACE_MS = 90000;
const SPAWN_AT = 500000;

function runLivenessTest(ctx) {
  if (ctx.livenessOutput) return ctx.livenessOutput;
  const result = spawnSync('bash', [LIVENESS_TEST], { encoding: 'utf8', timeout: 120000 });
  ctx.livenessOutput = (result.stdout || '') + (result.stderr || '');
  ctx.livenessExit = result.status;
  return ctx.livenessOutput;
}

function expectPass(output, label) {
  if (!output.includes(`ok   - ${label}`)) {
    throw new Error(`expected "ok   - ${label}" in liveness suite output, got:\n${output}`);
  }
}

function predicateStale({ heartbeat, now }) {
  const hb = heartbeat === null ? 'nil' : String(heartbeat);
  const out = execFileSync(
    'bb',
    [
      '-e',
      `(require '[babashka.fs :as fs])
(load-file "${LIB}")
(println (front-desk-supervisor-lib/poll-heartbeat-stale? ${hb} ${now} ${STALL_MS} ${SPAWN_AT} ${GRACE_MS}))`,
    ],
    { encoding: 'utf8' }
  );
  return out.trim() === 'true';
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a front-desk supervisor watching a bot that holds a live process$/, (ctx) => {
    ctx.spawnAt = SPAWN_AT;
    ctx.heartbeat = null;
    ctx.now = SPAWN_AT;
  });

  // ── scenario 01 + 05 (shell suite) ───────────────────────────────────
  scoped(/^the bot has completed a poll since it started$/, (ctx) => {
    ctx.livenessOutput = runLivenessTest(ctx);
  });

  scoped(/^nothing further has been polled for longer than the stall window$/, (ctx) => {
    ctx.livenessOutput = ctx.livenessOutput || runLivenessTest(ctx);
  });

  scoped(/^the supervisor checks the bot$/, (ctx) => {
    if (ctx.usePredicate) {
      ctx.verdict = predicateStale({ heartbeat: ctx.heartbeat, now: ctx.now });
      return;
    }
    ctx.livenessOutput = ctx.livenessOutput || runLivenessTest(ctx);
  });

  scoped(/^the bot is declared stalled$/, (ctx) => {
    if (ctx.usePredicate) {
      assert.equal(ctx.verdict, true, 'predicate must report stalled');
      return;
    }
    expectPass(
      ctx.livenessOutput || runLivenessTest(ctx),
      "front-desk-liveness-01: a stopped-listening bot is reported as stalled, never plain 'running'"
    );
  });

  scoped(/^the stall is recorded with the window it exceeded$/, (ctx) => {
    expectPass(ctx.livenessOutput || runLivenessTest(ctx), 'the stall is logged');
  });

  scoped(/^a bot that stops listening again after every restart$/, (ctx) => {
    ctx.livenessOutput = runLivenessTest(ctx);
  });

  scoped(/^the supervisor checks it repeatedly$/, (ctx) => {
    ctx.livenessOutput = ctx.livenessOutput || runLivenessTest(ctx);
  });

  scoped(/^it is restarted no more times than its configured attempt cap allows$/, (ctx) => {
    expectPass(
      ctx.livenessOutput || runLivenessTest(ctx),
      'front-desk-liveness-04: repeated stalls stop restarting at the cap (gives up)'
    );
  });

  scoped(/^once the cap is spent the failure is escalated to the human$/, (ctx) => {
    expectPass(
      ctx.livenessOutput || runLivenessTest(ctx),
      'front-desk-liveness-04: the failure is escalated to the human (logged loudly)'
    );
  });

  // ── scenarios 02–04 (pure predicate) ─────────────────────────────────
  scoped(/^the bot has not completed a poll since it started$/, (ctx) => {
    ctx.usePredicate = true;
    ctx.heartbeat = null;
  });

  scoped(/^it is still inside its startup grace$/, (ctx) => {
    ctx.usePredicate = true;
    ctx.now = SPAWN_AT + Math.floor(GRACE_MS / 2);
  });

  scoped(/^the only recorded poll was completed before the bot started$/, (ctx) => {
    ctx.usePredicate = true;
    ctx.heartbeat = SPAWN_AT - STALL_MS - 1;
    assert.ok(ctx.heartbeat < SPAWN_AT);
  });

  scoped(/^its startup grace has passed$/, (ctx) => {
    ctx.usePredicate = true;
    ctx.now = SPAWN_AT + GRACE_MS + 1;
  });

  scoped(/^the bot is not declared stalled$/, (ctx) => {
    assert.ok(ctx.usePredicate, 'not-stalled assertion is predicate-scoped');
    ctx.verdict = predicateStale({ heartbeat: ctx.heartbeat, now: ctx.now });
    assert.equal(ctx.verdict, false, 'predicate must report not stalled');
  });
}

module.exports = { registerSteps };
