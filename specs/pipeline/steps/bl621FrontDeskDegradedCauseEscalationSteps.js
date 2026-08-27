'use strict';

// BL-621: step handlers for "Front-desk degradation names its cause and
// sustained outages escalate".
//
// Every scenario drives the REAL compiled front-desk core
// (extension/out/tools/telegramFrontDeskBotCore.js) - runPollCycle,
// applyPollCycleResult, computeReplyRelayCycleResult and
// applyReplyRelayCycleResult, with fake adapters standing in for Telegram
// and the bridge. Nothing here restates the loop's arithmetic: the warning
// text, the episode decision and the escalation text all come out of the
// shipped module, so a scenario can only pass if the shipped code does it.
//
// THE CLOCK IS A NUMBER. Every cycle is driven at an explicit fixture
// millisecond (ctx.nowMs), so a 30-minute outage costs no wall time and no
// scenario is a function of host speed. No timers are ever armed: the wait
// adapter records the delay it was asked for and returns.
//
// The threshold under test is the SHIPPED default
// (DEFAULT_SUSTAINED_OUTAGE_THRESHOLD_MS), not a value invented here - a
// change to the default is meant to be visible from these scenarios.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const path = require('node:path');

const CORE = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'telegramFrontDeskBotCore'));

const FEATURE = 'Front-desk degradation names its cause and sustained outages escalate';

const PRINCIPAL_ID = '4242';
const MINUTE = 60_000;

// Verbatim shape of what getTelegramUpdates hands back for the 2026-07-24
// incident's own failure - formatApiFailureError's "status <n>: <description>"
// text. The single line 9 hours of warnings never carried.
const CONFLICT_ERROR =
  'Telegram API responded with status 409: Conflict: terminated by other getUpdates request; make sure that only one bot instance is running';
const RELAY_ERROR = 'reply-ack failed with status 502';

const CONFIG = {
  backoffBaseMs: 2000,
  backoffMaxMs: 60_000,
  degradedThreshold: 5,
  stuckRetryLimit: 5,
  sustainedOutageThresholdMs: CORE.DEFAULT_SUSTAINED_OUTAGE_THRESHOLD_MS,
};

// Comfortably past the threshold, so "has failed continuously for longer
// than" is true by a margin rather than exactly on the boundary (the
// boundary itself is pinned by the unit suite).
const PAST_THRESHOLD_MS = CONFIG.sustainedOutageThresholdMs + 5 * MINUTE;

function failingPollAdapters(error) {
  return { chatId: '1', getUpdates: async () => ({ success: false, updates: [], error }) };
}

const OK_POLL_ADAPTERS = { chatId: '1', getUpdates: async () => ({ success: true, updates: [] }) };

function newContext(ctx) {
  ctx.nowMs = 0;
  ctx.pollState = { offset: 0, consecutiveFailures: 0, stuckAttempts: 0, sustainedOutage: { escalated: false } };
  ctx.relayState = { consecutiveFailures: 0, sustainedOutage: { escalated: false } };
  ctx.pollError = CONFLICT_ERROR;
  ctx.escalationSendFails = false;
  ctx.warnings = [];
  ctx.escalations = [];
  ctx.heartbeats = 0;
  ctx.waits = [];
}

function effects(ctx) {
  return {
    writeWarning: (message) => ctx.warnings.push(message),
    wait: async (ms) => {
      ctx.waits.push(ms);
    },
    escalate: async (message) => {
      if (ctx.escalationSendFails) {
        throw new Error('sendMessage failed: the direct channel is down too');
      }
      ctx.escalations.push(message);
    },
    recordHeartbeat: () => {
      ctx.heartbeats += 1;
    },
  };
}

// One real poll cycle at the current fixture instant, side effects applied
// through the same apply function the live loop uses.
async function pollCycle(ctx, { ok = false } = {}) {
  const adapters = ok ? OK_POLL_ADAPTERS : failingPollAdapters(ctx.pollError);
  const cycle = await CORE.runPollCycle(ctx.pollState, PRINCIPAL_ID, adapters, CONFIG, ctx.nowMs);
  ctx.pollState = cycle.state;
  const e = effects(ctx);
  await CORE.applyPollCycleResult(cycle, e.writeWarning, e.wait, e.escalate, e.recordHeartbeat);
  return cycle;
}

async function relayCycle(ctx, { ok = false } = {}) {
  const cycle = CORE.computeReplyRelayCycleResult(ctx.relayState, ok, CONFIG, ctx.nowMs);
  ctx.relayState = cycle.state;
  const e = effects(ctx);
  await CORE.applyReplyRelayCycleResult(cycle, ok ? undefined : RELAY_ERROR, e.writeWarning, e.wait, e.escalate);
  return cycle;
}

function degradedWarnings(ctx) {
  return ctx.warnings.filter((line) => line.includes('degraded -'));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a front-desk bot with a controllable clock$/, (ctx) => {
    newContext(ctx);
  });

  // ── Givens ───────────────────────────────────────────────────────────
  scoped(/^getUpdates fails every cycle with a 409 Conflict error$/, (ctx) => {
    ctx.pollError = CONFLICT_ERROR;
  });

  scoped(/^getUpdates fails every cycle$/, (ctx) => {
    ctx.pollError = CONFLICT_ERROR;
  });

  // Opens the episode at t=0, then moves the clock past the threshold
  // WITHOUT running the crossing cycle - that is the scenario's own When.
  scoped(/^getUpdates has failed continuously for longer than the sustained-degraded threshold$/, async (ctx) => {
    await pollCycle(ctx);
    ctx.nowMs = PAST_THRESHOLD_MS;
  });

  scoped(/^a sustained poll outage escalated and polling then recovered$/, async (ctx) => {
    await pollCycle(ctx);
    ctx.nowMs = PAST_THRESHOLD_MS;
    await pollCycle(ctx);
    assert.equal(ctx.escalations.length, 1, 'the first episode must have escalated before recovery can close it');
    ctx.nowMs += MINUTE;
    await pollCycle(ctx, { ok: true });
  });

  scoped(/^the reply-relay reconnect has failed continuously for longer than the sustained-degraded threshold$/, async (ctx) => {
    await relayCycle(ctx);
    ctx.nowMs = PAST_THRESHOLD_MS;
  });

  scoped(/^the direct escalation channel itself fails$/, (ctx) => {
    ctx.escalationSendFails = true;
  });

  // ── Whens ────────────────────────────────────────────────────────────
  scoped(/^the degraded threshold is crossed$/, async (ctx) => {
    for (let i = 0; i < CONFIG.degradedThreshold; i++) {
      ctx.nowMs += MINUTE;
      await pollCycle(ctx);
    }
  });

  scoped(/^failures continue well past the degraded threshold$/, async (ctx) => {
    for (let i = 0; i < CONFIG.degradedThreshold * 3; i++) {
      ctx.nowMs += MINUTE;
      await pollCycle(ctx);
    }
  });

  scoped(/^the next poll cycle completes$/, async (ctx) => {
    await pollCycle(ctx);
  });

  scoped(/^the next relay cycle completes$/, async (ctx) => {
    await relayCycle(ctx);
  });

  scoped(/^getUpdates later fails continuously past the sustained-degraded threshold again$/, async (ctx) => {
    ctx.nowMs += MINUTE;
    await pollCycle(ctx);
    ctx.nowMs += PAST_THRESHOLD_MS;
    await pollCycle(ctx);
  });

  scoped(/^a sustained outage triggers an escalation$/, async (ctx) => {
    await pollCycle(ctx);
    ctx.nowMs = PAST_THRESHOLD_MS;
    const cycle = await pollCycle(ctx);
    assert.equal(cycle.escalateSustainedOutage, true, 'the outage must actually have crossed the threshold');
  });

  // ── Thens ────────────────────────────────────────────────────────────
  scoped(/^a degraded warning is written naming the 409 Conflict error text$/, (ctx) => {
    const warnings = degradedWarnings(ctx);
    assert.equal(warnings.length, 1, `expected one degraded warning, got:\n${ctx.warnings.join('')}`);
    assert.match(warnings[0], /poll degraded - 5 consecutive failures, still retrying/);
    assert.match(warnings[0], /409: Conflict: terminated by other getUpdates request/);
  });

  scoped(/^exactly one degraded warning is written for the streak$/, (ctx) => {
    assert.equal(degradedWarnings(ctx).length, 1, `expected one warning for the whole streak, got:\n${ctx.warnings.join('')}`);
  });

  scoped(/^one escalation naming the outage duration and the last error is sent via the direct escalation channel$/, (ctx) => {
    assert.equal(ctx.escalations.length, 1, `expected exactly one escalation, got:\n${ctx.escalations.join('\n')}`);
    assert.match(ctx.escalations[0], /the poll loop has been failing continuously for 35m/);
    assert.match(ctx.escalations[0], /409: Conflict: terminated by other getUpdates request/);
  });

  scoped(/^no further escalation is sent while the same episode continues$/, async (ctx) => {
    for (let i = 0; i < 5; i++) {
      ctx.nowMs += 10 * MINUTE;
      await pollCycle(ctx);
    }
    assert.equal(ctx.escalations.length, 1, `the same episode escalated more than once:\n${ctx.escalations.join('\n')}`);
  });

  scoped(/^a new escalation is sent for the new episode$/, (ctx) => {
    assert.equal(ctx.escalations.length, 2, `expected a second escalation for the second episode, got ${ctx.escalations.length}`);
  });

  scoped(/^one escalation naming the relay outage duration and the last error is sent via the direct escalation channel$/, (ctx) => {
    assert.equal(ctx.escalations.length, 1, `expected exactly one relay escalation, got:\n${ctx.escalations.join('\n')}`);
    assert.match(ctx.escalations[0], /the reply-relay loop has been failing continuously for 35m/);
    assert.match(ctx.escalations[0], /reply-ack failed with status 502/);
  });

  scoped(/^the relay keeps retrying with capped backoff$/, async (ctx) => {
    const before = ctx.waits.length;
    for (let i = 0; i < 10; i++) {
      ctx.nowMs += MINUTE;
      await relayCycle(ctx);
    }
    const after = ctx.waits.slice(before);
    assert.equal(after.length, 10, 'every failed reconnect must still wait before the next attempt');
    assert.equal(after[after.length - 1], CONFIG.backoffMaxMs, 'the backoff must cap rather than grow without bound');
    assert.ok(
      after.every((ms) => ms > 0 && ms <= CONFIG.backoffMaxMs),
      `expected every delay within the cap, got ${after.join(',')}`
    );
  });

  scoped(/^the poll heartbeat is stamped fresh$/, (ctx) => {
    assert.ok(ctx.heartbeats > 0, 'a completed cycle must stamp the heartbeat even when it failed (BL-370)');
    assert.equal(ctx.heartbeats, ctx.waits.length, 'every completed cycle stamps exactly once, failure or not');
  });

  scoped(/^the poll loop continues on its backoff cadence$/, (ctx) => {
    assert.ok(ctx.waits.length > 0, 'the loop must still take its backoff after a failed escalation');
    assert.ok(
      ctx.waits.every((ms) => ms > 0 && ms <= CONFIG.backoffMaxMs),
      `expected every delay within the cap, got ${ctx.waits.join(',')}`
    );
  });

  scoped(/^the escalation failure is logged$/, (ctx) => {
    const logged = ctx.warnings.filter((line) => line.includes('escalation send failed'));
    assert.equal(logged.length, 1, `expected the failed escalation to be logged once, got:\n${ctx.warnings.join('')}`);
    assert.match(logged[0], /the direct channel is down too/);
    assert.equal(ctx.escalations.length, 0, 'nothing was actually delivered - the log is the whole record');
  });
}

module.exports = { registerSteps };
