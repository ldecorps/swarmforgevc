'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  deriveTicketDecisionLatency,
  partitionDecisionLatencies,
  aggregateDecisionLatency,
} = require('../out/metrics/humanDecisionLatency');

test('BL-600 P1: pending asks never produce a latencyMs (only openAgeMs)', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 9999 }), fc.integer({ min: 1000, max: 1_000_000 }), (n, nowMs) => {
      const d = deriveTicketDecisionLatency({ ticketId: `BL-${n}`, gate: 'approve', askAtMs: 1000 }, nowMs);
      assert.equal(d.latencyMs, undefined);
      assert.ok(typeof d.openAgeMs === 'number');
    }),
    { numRuns: 30 }
  );
});

test('BL-600 P2: decided latency equals verdict minus ask', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 1_000_000 }),
      fc.integer({ min: 0, max: 1_000_000 }),
      (askOffset, delay) => {
        const askAtMs = 1000 + askOffset;
        const verdictAtMs = askAtMs + delay;
        const d = deriveTicketDecisionLatency(
          { ticketId: 'BL-1', gate: 'amend', askAtMs, verdictAtMs },
          verdictAtMs + 1
        );
        assert.equal(d.latencyMs, delay);
        assert.equal(d.openAgeMs, undefined);
      }
    ),
    { numRuns: 40 }
  );
});

test('BL-600 P3: open waits are excluded from decided partition counts', () => {
  fc.assert(
    fc.property(fc.integer({ min: 5000, max: 50_000 }), (nowMs) => {
      const { decided, openWaits } = partitionDecisionLatencies(
        [
          { ticketId: 'BL-open', gate: 'approve', askAtMs: 1000 },
          { ticketId: 'BL-done', gate: 'approve', askAtMs: 1000, verdictAtMs: 4000 },
        ],
        nowMs
      );
      assert.equal(decided.length, 1);
      assert.equal(openWaits.length, 1);
      const agg = aggregateDecisionLatency(decided, openWaits, nowMs);
      assert.equal(agg.openWaits.length, 1);
    }),
    { numRuns: 20 }
  );
});
