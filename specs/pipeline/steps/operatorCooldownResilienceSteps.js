'use strict';

// BL-305: step handlers for "The operator never false-freezes on a stale
// or unreadable usage-limit cooldown". Drives the REAL
// operator_lib.bb resolve-provider-state via
// operator_cooldown_resilience_acceptance_runner.bb (real Babashka,
// fixture inputs + injected clock, no real tmux/timer) - mirrors
// frontDeskSupervisorRecoverySteps.js's own execFileSync-a-real-bb-CLI
// pattern.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'operator_cooldown_resilience_acceptance_runner.bb');

const BOUNDED_FALLBACK_MS = 1800000; // 30 min
const PLAUSIBLE_MAX_MS = 21600000; // 6 hours
const NOW_MS = 64800000; // 6pm, day 0, UTC

function resolve(scenario) {
  const out = execFileSync('bb', [RUNNER, JSON.stringify(scenario)], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the operator runtime is deciding whether the provider is in a usage-limit cooldown$/, () => {
    // No fixture setup needed - each scenario's own Given builds its own
    // scenario object below.
  });

  // ── cooldown-resilience-01 ───────────────────────────────────────────
  registry.define(/^a usage-limit banner with a readable reset time that has not yet passed$/, (ctx) => {
    ctx.scenario = {
      limitedText: 'usage limit reached, resets 7:50pm',
      parsedResetMs: NOW_MS + 3600000, // 1h ahead - plausible, genuine
      resetRaw: 'resets 7:50pm',
      existingResetMs: null,
      existingResetRaw: null,
      nowMs: NOW_MS,
      boundedFallbackMs: BOUNDED_FALLBACK_MS,
      plausibleMaxMs: PLAUSIBLE_MAX_MS,
    };
  });

  registry.define(/^the runtime evaluates the provider state$/, (ctx) => {
    ctx.result = resolve(ctx.scenario);
  });

  registry.define(/^the operator stays frozen until that reset time$/, (ctx) => {
    if (ctx.result.state !== 'cooldown') {
      throw new Error(`expected the genuine reset to still freeze the operator, got state=${ctx.result.state}`);
    }
    if (ctx.result.resetMs !== ctx.scenario.parsedResetMs) {
      throw new Error(`expected the resolved reset to be the genuine parsed reset (${ctx.scenario.parsedResetMs}), got ${ctx.result.resetMs}`);
    }
  });

  // ── cooldown-resilience-02 ───────────────────────────────────────────
  registry.define(/^a usage-limit banner whose reset time is missing or implausibly far off$/, (ctx) => {
    ctx.scenario = {
      limitedText: 'usage limit reached',
      parsedResetMs: null,
      resetRaw: 'usage limit reached',
      existingResetMs: null,
      existingResetRaw: null,
      nowMs: NOW_MS,
      boundedFallbackMs: BOUNDED_FALLBACK_MS,
      plausibleMaxMs: PLAUSIBLE_MAX_MS,
    };
  });

  registry.define(/^the operator holds for only a bounded fallback window and then resumes$/, (ctx) => {
    if (ctx.result.state !== 'cooldown') {
      throw new Error(`expected an unreadable reset to still bound a cooldown, got state=${ctx.result.state}`);
    }
    const expectedResetMs = NOW_MS + BOUNDED_FALLBACK_MS;
    if (ctx.result.resetMs !== expectedResetMs) {
      throw new Error(`expected the bounded-fallback reset (${expectedResetMs}), got ${ctx.result.resetMs} - never an unbounded/nil-reset freeze`);
    }
    // "and then resumes": once now-ms reaches the bounded reset, a later
    // evaluation must resume - proves the reset is FINITE, not a nil that
    // can never elapse.
    const afterFallback = resolve({ ...ctx.scenario, existingResetMs: ctx.result.resetMs, existingResetRaw: ctx.result.resetRaw, nowMs: expectedResetMs });
    if (afterFallback.state !== 'available') {
      throw new Error(`expected the operator to resume once the bounded fallback window elapses, got state=${afterFallback.state}`);
    }
  });

  // ── cooldown-resilience-03 ───────────────────────────────────────────
  registry.define(/^a recorded cooldown whose reset time has passed while an old limit banner still lingers$/, (ctx) => {
    ctx.scenario = {
      limitedText: 'usage limit reached, resets 7:50pm',
      // the SAME stale text re-parsed/rolled to "tomorrow" - implausibly far off
      parsedResetMs: NOW_MS + 46800000,
      resetRaw: 'resets 7:50pm',
      existingResetMs: NOW_MS - 4800000, // recorded reset already in the past
      existingResetRaw: 'resets 7:50pm',
      nowMs: NOW_MS,
      boundedFallbackMs: BOUNDED_FALLBACK_MS,
      plausibleMaxMs: PLAUSIBLE_MAX_MS,
    };
  });

  registry.define(/^the operator resumes rather than re-freezing on the stale banner$/, (ctx) => {
    if (ctx.result.state !== 'available') {
      throw new Error(`expected the operator to resume once the recorded reset elapsed, got state=${ctx.result.state} (the stale banner must never re-freeze it)`);
    }
  });
}

module.exports = { registerSteps };
