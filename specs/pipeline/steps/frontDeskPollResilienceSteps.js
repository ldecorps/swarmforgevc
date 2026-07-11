'use strict';

// BL-302: step handlers for "The front-desk bot's poll loop backs off and
// stays up when its Telegram poll connection fails". Drives the REAL
// compiled runPollCycle/runContainedLoop (telegramFrontDeskBotCore.ts)
// directly against fake in-memory adapters - no live Telegram, no
// network, no real timers (the pure decision functions never call sleep
// themselves; a fake `wait` is injected only for runContainedLoop).
const path = require('node:path');

const { runPollCycle, runContainedLoop } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'telegramFrontDeskBotCore'));

const PRINCIPAL_ID = 111;
const BACKOFF_CONFIG = { backoffBaseMs: 1000, backoffMaxMs: 30000, degradedThreshold: 5 };

function fakeAdapters(getUpdatesResult) {
  return {
    getUpdates: async () => getUpdatesResult,
    postToBridge: async () => true,
    subjectForTopic: () => undefined,
    openSubjectAndRecord: async () => 'SUP-1',
    backlogForTopic: () => undefined,
    postOperatorContext: async () => true,
    nextOffset: (updates, current) => current + updates.length,
  };
}

async function runCycles(ctx, count, success) {
  const results = [];
  for (let i = 0; i < count; i++) {
    const adapters = fakeAdapters(success ? { success: true, updates: [] } : { success: false, updates: [], error: 'network error' });
    const cycle = await runPollCycle(ctx.state, PRINCIPAL_ID, adapters, BACKOFF_CONFIG);
    ctx.state = cycle.state;
    results.push(cycle);
  }
  return results;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the front-desk bot is polling Telegram for inbound updates$/, (ctx) => {
    ctx.state = { offset: 0, consecutiveFailures: 0 };
  });

  // ── poll-resilience-01 ───────────────────────────────────────────────
  registry.define(/^the poll connection keeps failing$/, () => {
    // No fixture setup needed - runCycles(ctx, n, false) below drives it.
  });

  registry.define(/^one poll cycle fails and then a later one succeeds$/, async (ctx) => {
    ctx.failedCycles = await runCycles(ctx, 3, false);
    ctx.successCycle = (await runCycles(ctx, 1, true))[0];
  });

  registry.define(/^the failed cycle waits a bounded, growing delay before the next attempt$/, (ctx) => {
    const delays = ctx.failedCycles.map((c) => c.delayMs);
    if (delays.some((d) => d <= 0)) {
      throw new Error(`expected every failed cycle's delay to be positive (no tight-spin), got ${JSON.stringify(delays)}`);
    }
    for (let i = 1; i < delays.length; i++) {
      if (!(delays[i] > delays[i - 1])) {
        throw new Error(`expected the delay to grow across consecutive failures, got ${JSON.stringify(delays)}`);
      }
    }
  });

  registry.define(/^the successful cycle returns the delay to its floor$/, (ctx) => {
    if (ctx.successCycle.delayMs !== 0) {
      throw new Error(`expected the successful cycle's delay to be 0 (floor), got ${ctx.successCycle.delayMs}`);
    }
    if (ctx.successCycle.state.consecutiveFailures !== 0) {
      throw new Error(`expected consecutiveFailures to reset to 0, got ${ctx.successCycle.state.consecutiveFailures}`);
    }
  });

  // ── poll-resilience-02 ───────────────────────────────────────────────
  registry.define(/^the poll connection has failed many times in a row$/, async (ctx) => {
    await runCycles(ctx, BACKOFF_CONFIG.degradedThreshold - 1, false);
  });

  registry.define(/^the consecutive-failure threshold is crossed$/, async (ctx) => {
    ctx.crossingCycle = (await runCycles(ctx, 1, false))[0];
    ctx.afterCrossingCycle = (await runCycles(ctx, 1, false))[0];
  });

  registry.define(/^the bot raises a visible degraded warning and keeps retrying$/, (ctx) => {
    if (!ctx.crossingCycle.degradedWarning) {
      throw new Error('expected the degraded warning to fire on the threshold-crossing cycle');
    }
    if (!(ctx.afterCrossingCycle.delayMs > 0)) {
      throw new Error('expected retries to continue (a positive delay) past the threshold, not stop');
    }
  });

  // ── poll-resilience-03 ───────────────────────────────────────────────
  registry.define(/^the poll loop hits a fault$/, (ctx) => {
    ctx.poisonCalls = 0;
    ctx.poisonedStart = async () => {
      ctx.poisonCalls += 1;
      if (ctx.poisonCalls === 1) {
        throw new Error('poll socket dropped');
      }
    };
    ctx.tickTicks = 0;
    ctx.relayTicks = 0;
  });

  registry.define(/^the bot contains it$/, async (ctx) => {
    async function siblingLoop(counterName) {
      for (let i = 0; i < 3; i++) {
        ctx[counterName] += 1;
        await Promise.resolve();
      }
    }
    await Promise.all([
      runContainedLoop('poll', ctx.poisonedStart, async () => {}, 0, () => {}),
      runContainedLoop('concierge-tick', () => siblingLoop('tickTicks'), async () => {}, 0, () => {
        throw new Error('concierge tick should never fault in this scenario');
      }),
      runContainedLoop('reply-relay', () => siblingLoop('relayTicks'), async () => {}, 0, () => {
        throw new Error('reply relay should never fault in this scenario');
      }),
    ]);
  });

  registry.define(/^the concierge tick and the reply relay keep running$/, (ctx) => {
    if (ctx.tickTicks !== 3 || ctx.relayTicks !== 3) {
      throw new Error(`expected both sibling loops to run to completion undisturbed, got tickTicks=${ctx.tickTicks} relayTicks=${ctx.relayTicks}`);
    }
    if (ctx.poisonCalls !== 2) {
      throw new Error(`expected the poisoned loop to fault once then recover (2 calls total), got ${ctx.poisonCalls}`);
    }
  });
}

module.exports = { registerSteps };
