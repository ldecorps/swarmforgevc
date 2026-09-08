'use strict';

// BL-1492: step handlers for "a stalled verdict restarts the daemon in
// place, and the full halt is the escalation". Drives the REAL
// handoffd_supervisor.bb respond-to-verdict! (decide-response +
// restart-daemon!/alarm-and-halt!) via bl1492RestartInPlaceCli.bb - never a
// reimplementation. halt-swarm! and the daemon start owner are stubbed
// inside the CLI so a real tmux kill or a real daemon (re)start is never
// reached; the alarm email is captured at the supervisor's own
// send-configured-alarm-email! adapter boundary.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, 'lib', 'bl1492RestartInPlaceCli.bb');
const BUDGET_WINDOW_MS = 600000;

const FEATURE = 'BL-1492 a stalled verdict restarts the daemon in place, and the full halt is the escalation';

function ensureCtx(ctx) {
  ctx.restartHistory = ctx.restartHistory || [];
  ctx.startOwnerFails = ctx.startOwnerFails || false;
  return ctx;
}

function runFixture(ctx, verdict) {
  ensureCtx(ctx);
  const input = JSON.stringify({
    verdict,
    restartHistory: ctx.restartHistory,
    startOwnerFails: ctx.startOwnerFails,
  });
  const result = spawnSync('bb', [CLI], {
    input,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `expected the fixture CLI to exit 0, got ${result.status}: ${result.stderr}`);
  ctx.result = JSON.parse(result.stdout.trim().split('\n').pop());
  return ctx.result;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture project root whose daemon start owner, alarm email and swarm halt are recorded, not performed$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(/^a supervisor whose restart budget is 2 restarts per 600000 ms$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(/^the supervisor has already restarted the daemon 2 times within the window$/, (ctx) => {
    ensureCtx(ctx);
    ctx.restartHistory = [
      { ageMs: 1000, result: 'succeeded' },
      { ageMs: 2000, result: 'succeeded' },
    ];
  });

  scoped(/^the daemon has since been healthy for longer than the window$/, (ctx) => {
    ensureCtx(ctx);
    ctx.restartHistory = ctx.restartHistory.map((h) => ({ ...h, ageMs: BUDGET_WINDOW_MS + 1000 }));
  });

  scoped(/^the daemon start owner fails$/, (ctx) => {
    ensureCtx(ctx);
    ctx.startOwnerFails = true;
  });

  scoped(/^the supervisor acts on a "([^"]+)" verdict$/, (ctx, verdict) => {
    runFixture(ctx, verdict);
  });

  scoped(/^the daemon start owner is invoked once$/, (ctx) => {
    assert.equal(ctx.result.startDaemonCount, 1,
      `expected the start owner to be invoked exactly once, got ${ctx.result.startDaemonCount}`);
  });

  scoped(/^the daemon start owner is not invoked$/, (ctx) => {
    assert.equal(ctx.result.startDaemonCount, 0,
      `expected the start owner never to be invoked, got ${ctx.result.startDaemonCount}`);
  });

  scoped(/^the swarm halt is never invoked$/, (ctx) => {
    assert.equal(ctx.result.haltCount, 0, `expected the swarm halt never to be invoked, got ${ctx.result.haltCount}`);
  });

  scoped(/^the swarm halt is invoked once$/, (ctx) => {
    assert.equal(ctx.result.haltCount, 1, `expected exactly one swarm halt, got ${ctx.result.haltCount}`);
  });

  scoped(/^one alarm email is sent naming a restart$/, (ctx) => {
    assert.equal(ctx.result.emailSubjects.length, 1,
      `expected exactly one alarm email, got ${JSON.stringify(ctx.result.emailSubjects)}`);
    assert.ok(ctx.result.emailSubjects[0].toLowerCase().includes('restart'),
      `expected the alarm email to name a restart, got: ${ctx.result.emailSubjects[0]}`);
  });

  scoped(/^the status file records a "([^"]+)" restart in restart_history$/, (ctx, outcome) => {
    const history = ctx.result.restartHistoryAfter || [];
    const last = history[history.length - 1];
    assert.ok(last, `expected restart_history to gain an entry, got ${JSON.stringify(history)}`);
    assert.equal(last.result, outcome, `expected the new entry's result to be "${outcome}", got ${JSON.stringify(last)}`);
  });

  scoped(/^the status file reads "([^"]+)"$/, (ctx, state) => {
    assert.equal(ctx.result.state, state, `expected status state "${state}", got ${JSON.stringify(ctx.result.state)}`);
  });
}

module.exports = { registerSteps };
