'use strict';

// BL-1111: step handlers for "reply-relay must not sit on terminated for a
// sustained outage window".
//
// Drives the REAL compiled front-desk core (computeReplyRelayCycleResult /
// applyReplyRelayCycleResult / isReplyRelayHealthy) with a fixture clock —
// same shape as BL-621. No live Telegram/network.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const path = require('node:path');

const CORE = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'telegramFrontDeskBotCore'));

const FEATURE = 'BL-1111 reply-relay must not sit on terminated for a sustained outage window';

const CONFIG = {
  backoffBaseMs: 2000,
  backoffMaxMs: 60_000,
  degradedThreshold: 5,
  stuckRetryLimit: 5,
  sustainedOutageThresholdMs: CORE.DEFAULT_SUSTAINED_OUTAGE_THRESHOLD_MS,
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the Telegram front-desk bot owns the reply-relay loop$/, (ctx) => {
    ctx.config = CONFIG;
    ctx.nowMs = 1_000_000;
    ctx.relayState = { consecutiveFailures: 0, sustainedOutage: { escalated: false } };
    ctx.escalations = [];
    ctx.waits = [];
  });

  scoped(/^the reply-relay connection is terminated$/, (ctx) => {
    ctx.lastError = 'terminated';
    const cycle = CORE.computeReplyRelayCycleResult(ctx.relayState, false, ctx.config, ctx.nowMs, ctx.lastError);
    ctx.relayState = cycle.state;
    ctx.nowMs += cycle.delayMs;
  });

  scoped(/^the reconnect path runs under a healthy network$/, (ctx) => {
    const episodeStart = ctx.nowMs;
    // Spend transport-capped backoff time still inside the sustained window,
    // then a healthy reconnect succeeds — the recovery the 31m outage lacked.
    const budget = ctx.config.sustainedOutageThresholdMs - 5 * 60_000;
    while (ctx.nowMs - episodeStart < budget) {
      const cycle = CORE.computeReplyRelayCycleResult(ctx.relayState, false, ctx.config, ctx.nowMs, 'terminated');
      assert.equal(cycle.escalateSustainedOutage, false, 'must not escalate before the threshold');
      ctx.relayState = cycle.state;
      ctx.nowMs += cycle.delayMs;
    }
    const recovered = CORE.computeReplyRelayCycleResult(ctx.relayState, true, ctx.config, ctx.nowMs);
    ctx.relayState = recovered.state;
    ctx.episodeStart = episodeStart;
  });

  scoped(/^the relay is delivering again before the sustained-outage alert threshold$/, (ctx) => {
    assert.equal(ctx.relayState.consecutiveFailures, 0);
    assert.equal(CORE.isReplyRelayHealthy(ctx.relayState), true);
    assert.ok(
      ctx.nowMs - ctx.episodeStart < ctx.config.sustainedOutageThresholdMs,
      'recovery clock must stay inside the sustained window'
    );
  });

  scoped(/^the reply-relay has been failing continuously past the sustained threshold$/, (ctx) => {
    ctx.lastError = 'terminated';
    ctx.relayState = CORE.computeReplyRelayCycleResult(
      ctx.relayState,
      false,
      ctx.config,
      ctx.nowMs,
      ctx.lastError
    ).state;
    ctx.nowMs += ctx.config.sustainedOutageThresholdMs + 60_000;
  });

  scoped(/^the supervisor evaluates the outage$/, async (ctx) => {
    const cycle = CORE.computeReplyRelayCycleResult(ctx.relayState, false, ctx.config, ctx.nowMs, ctx.lastError);
    ctx.relayState = cycle.state;
    ctx.cycle = cycle;
    await CORE.applyReplyRelayCycleResult(
      cycle,
      ctx.lastError,
      () => {},
      async () => {},
      async (message) => ctx.escalations.push(message)
    );
    // A later cycle in the same episode must not re-alert.
    const again = CORE.computeReplyRelayCycleResult(
      ctx.relayState,
      false,
      ctx.config,
      ctx.nowMs + 60_000,
      ctx.lastError
    );
    ctx.secondEscalate = again.escalateSustainedOutage;
  });

  scoped(/^exactly one sustained-outage alert is raised for that outage window$/, (ctx) => {
    assert.equal(ctx.escalations.length, 1);
    assert.equal(ctx.secondEscalate, false);
  });

  scoped(/^the alert names the last error$/, (ctx) => {
    assert.match(ctx.escalations[0], /terminated/);
  });

  scoped(/^the last relay error is fetch failed$/, (ctx) => {
    ctx.healthReport = { consecutiveFailures: 2, lastError: 'fetch failed' };
  });

  scoped(/^the supervisor reports relay health$/, (ctx) => {
    ctx.healthy = CORE.isReplyRelayHealthy(ctx.healthReport);
  });

  scoped(/^the relay is not reported healthy$/, (ctx) => {
    assert.equal(ctx.healthy, false);
  });
}

module.exports = { registerSteps };
