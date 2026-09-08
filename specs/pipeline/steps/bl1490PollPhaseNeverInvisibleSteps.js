'use strict';

// BL-1490: step handlers for "a poll-cycle phase is never invisible to the
// supervisor". Drives the REAL handoffd_supervisor.bb check!/evaluate-health
// and the REAL daemon_cycle_guard_lib.bb mark-tick-phase!/mark-tick-idle!
// through bl1490TickPhaseFixtureCli.bb - never a reimplementation. Per the
// ticket's own "how", handoffd.bb itself is never load-file'd here (that
// starts the daemon); this fixture stands in for its three per-tick phases
// with its own background "unit of work" thread, and halt-swarm! is stubbed
// inside the CLI so a real tmux kill/email is never reached.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, 'lib', 'bl1490TickPhaseFixtureCli.bb');

const FEATURE = 'BL-1490 a poll-cycle phase is never invisible to the supervisor';

function ensureCtx(ctx) {
  ctx.stallMs = ctx.stallMs || 30000;
  ctx.tickBudgetMs = ctx.tickBudgetMs || 60000;
  return ctx;
}

function runFixture(ctx, { pollIntervalMs, pollDurationMs }) {
  ensureCtx(ctx);
  const env = {
    ...process.env,
    SUPERVISOR_STALL_MS: String(ctx.stallMs),
    SUPERVISOR_TICK_BUDGET_MS: String(ctx.tickBudgetMs),
  };
  const input = JSON.stringify({
    phase: ctx.phase || null,
    units: ctx.units || 0,
    'unit-cost-ms': ctx.unitCostMs || 0,
    'freeze-after-first-unit': !!ctx.freezeAfterFirstUnit,
    'poll-interval-ms': pollIntervalMs,
    'poll-duration-ms': pollDurationMs,
    'outbox-age-ms': ctx.outboxAgeMs || null,
    'heartbeat-stale-ms': ctx.heartbeatStaleMs || null,
    'marker-idle': !!ctx.markerIdle,
  });
  const result = spawnSync('bb', [CLI], {
    input,
    env,
    encoding: 'utf8',
    timeout: pollDurationMs + 20000,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `expected the fixture CLI to exit 0, got ${result.status}: ${result.stderr}`);
  ctx.result = JSON.parse(result.stdout.trim().split('\n').pop());
  return ctx.result;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a supervisor whose stall threshold is (\d+) ms$/, (ctx, ms) => {
    ensureCtx(ctx);
    ctx.stallMs = Number(ms);
  });

  scoped(/^the daemon process is alive$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(/^a fixture daemon cycle whose "([^"]+)" phase completes (\d+) units of work each costing (\d+) ms$/,
    (ctx, phase, units, unitCostMs) => {
      ensureCtx(ctx);
      ctx.phase = phase;
      ctx.units = Number(units);
      ctx.unitCostMs = Number(unitCostMs);
      ctx.freezeAfterFirstUnit = false;
    });

  scoped(/^a fixture daemon cycle whose "delivery" phase freezes after its first unit of work$/, (ctx) => {
    ensureCtx(ctx);
    ctx.phase = 'delivery';
    // The feature text does not pin a per-unit cost for this scenario; a
    // small constant keeps the fixture's real-time freeze point close to
    // scenario 01's cadence without the acceptance run taking long.
    ctx.unitCostMs = 900;
    ctx.freezeAfterFirstUnit = true;
    // A per-tick budget small enough that "past the phase budget" (the When
    // step below) completes in seconds of real wall-clock time, not the
    // 60s production default.
    ctx.tickBudgetMs = 2500;
  });

  scoped(/^pending outbox mail older than the stall threshold$/, (ctx) => {
    ensureCtx(ctx);
    ctx.outboxAgeMs = ctx.stallMs + 500;
  });

  scoped(/^the heartbeat file has not been touched for (\d+) ms$/, (ctx, ms) => {
    ensureCtx(ctx);
    ctx.heartbeatStaleMs = Number(ms);
  });

  scoped(/^the sweep marker reads idle$/, (ctx) => {
    ensureCtx(ctx);
    ctx.markerIdle = true;
  });

  scoped(/^the supervisor evaluates health every (\d+) ms until the phase completes$/, (ctx, intervalMs) => {
    ensureCtx(ctx);
    const pollIntervalMs = Number(intervalMs);
    const pollDurationMs = ctx.units * ctx.unitCostMs + 1000;
    runFixture(ctx, { pollIntervalMs, pollDurationMs });
  });

  scoped(/^the supervisor evaluates health repeatedly past the phase budget$/, (ctx) => {
    ensureCtx(ctx);
    const pollIntervalMs = 300;
    const pollDurationMs = ctx.tickBudgetMs * 2 + 1000;
    runFixture(ctx, { pollIntervalMs, pollDurationMs });
  });

  scoped(/^the supervisor evaluates health once$/, (ctx) => {
    ensureCtx(ctx);
    runFixture(ctx, { pollIntervalMs: 500, pollDurationMs: 0 });
  });

  scoped(/^every health verdict reads "healthy"$/, (ctx) => {
    assert.equal(ctx.result.finalState, 'healthy',
      `expected every verdict to have stayed healthy, but the daemon was halted: ${JSON.stringify(ctx.result)}`);
  });

  scoped(/^the swarm halt is never invoked$/, (ctx) => {
    assert.equal(ctx.result.haltCount, 0, `expected no halt, got ${ctx.result.haltCount}`);
  });

  scoped(/^all (\d+) units of work completed$/, (ctx, n) => {
    assert.equal(ctx.result.unitsCompleted, Number(n),
      `expected all ${n} units to complete, got ${ctx.result.unitsCompleted}`);
  });

  scoped(/^the health verdict becomes "stalled"$/, (ctx) => {
    assert.equal(ctx.result.finalState, 'halted',
      `expected the verdict to eventually flip to stalled (halted), got ${JSON.stringify(ctx.result)}`);
  });

  scoped(/^the swarm halt is invoked once$/, (ctx) => {
    assert.equal(ctx.result.haltCount, 1, `expected exactly one halt, got ${ctx.result.haltCount}`);
  });

  scoped(/^the health verdict reads "stalled"$/, (ctx) => {
    assert.equal(ctx.result.finalState, 'halted',
      `expected the single evaluation to read stalled (halted), got ${JSON.stringify(ctx.result)}`);
  });
}

module.exports = { registerSteps };
