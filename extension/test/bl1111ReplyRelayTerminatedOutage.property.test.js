'use strict';

// BL-1111 declared invariants (coder first authorship — BL-654):
//
// 1. A reply-relay connection that can recover under a healthy network does
//    so before the sustained-outage alert threshold (transport errors use a
//    short reconnect cap so the window is not burned waiting).
// 2. A sustained terminated outage raises exactly one sustained-outage alert
//    for that window, naming the last error.
//
// Non-vacuity: ordinary (non-transport) errors still use the full backoff
// max; deleting the transport cap would fail invariant 1's timing budget.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const path = require('node:path');
const {
  computeReplyRelayCycleResult,
  isReplyRelayHealthy,
  isReplyRelayTransportError,
  replyRelayReconnectBackoffMs,
  REPLY_RELAY_TRANSPORT_BACKOFF_MAX_MS,
  DEFAULT_SUSTAINED_OUTAGE_THRESHOLD_MS,
} = require('../out/tools/telegramFrontDeskBotCore');

const CONFIG = {
  backoffBaseMs: 2000,
  backoffMaxMs: 60_000,
  degradedThreshold: 5,
  stuckRetryLimit: 5,
  sustainedOutageThresholdMs: DEFAULT_SUSTAINED_OUTAGE_THRESHOLD_MS,
};

const TRANSPORT = ['terminated', 'TypeError: fetch failed', 'fetch failed'];
const ORDINARY = ['reply-ack failed with status 502', 'socket hang up elsewhere'];

test('BL-1111/BL-654 invariant 1: transport reconnect recovers before sustained threshold', () => {
  fc.assert(
    fc.property(fc.integer({ min: 5, max: 80 }), fc.constantFrom(...TRANSPORT), (failures, err) => {
      let state = { consecutiveFailures: 0, sustainedOutage: { escalated: false } };
      let now = 0;
      for (let i = 0; i < failures; i++) {
        const cycle = computeReplyRelayCycleResult(state, false, CONFIG, now, err);
        assert.ok(cycle.delayMs <= REPLY_RELAY_TRANSPORT_BACKOFF_MAX_MS);
        state = cycle.state;
        now += cycle.delayMs;
      }
      if (now >= CONFIG.sustainedOutageThresholdMs) return; // vacuous for this draw
      const recovered = computeReplyRelayCycleResult(state, true, CONFIG, now);
      assert.equal(recovered.state.consecutiveFailures, 0);
      assert.equal(isReplyRelayHealthy(recovered.state), true);
      assert.equal(recovered.escalateSustainedOutage, false);
    }),
    { numRuns: 40 }
  );
});

test('BL-1111/BL-654 invariant 2: sustained terminated escalates once and names the error', () => {
  fc.assert(
    fc.property(fc.constantFrom(...TRANSPORT), (err) => {
      let state = { consecutiveFailures: 0, sustainedOutage: { escalated: false } };
      state = computeReplyRelayCycleResult(state, false, CONFIG, 0, err).state;
      const past = CONFIG.sustainedOutageThresholdMs + 1;
      const first = computeReplyRelayCycleResult(state, false, CONFIG, past, err);
      assert.equal(first.escalateSustainedOutage, true);
      assert.equal(first.state.lastError, err);
      const second = computeReplyRelayCycleResult(first.state, false, CONFIG, past + 60_000, err);
      assert.equal(second.escalateSustainedOutage, false);
    }),
    { numRuns: 20 }
  );
});

test('BL-1111 non-vacuity: ordinary errors keep the full backoff max', () => {
  fc.assert(
    fc.property(fc.constantFrom(...ORDINARY), (err) => {
      assert.equal(isReplyRelayTransportError(err), false);
      const delay = replyRelayReconnectBackoffMs(30, CONFIG, err);
      assert.equal(delay, CONFIG.backoffMaxMs);
    }),
    { numRuns: 10 }
  );
});
