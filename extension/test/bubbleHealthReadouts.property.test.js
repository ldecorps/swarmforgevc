'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { buildBubbleHealthTrends } = require('../out/bridge/bubbleHealthCore');
const { computeCycleTime, computeVelocity } = require('../out/metrics/deliveryMetrics');

const NOW = Date.parse('2026-02-01T00:00:00Z');

function emptyStageDwell() {
  return {
    windowHours: 24,
    windowStartIso: '2026-01-31T00:00:00Z',
    windowEndIso: '2026-02-01T00:00:00Z',
    stages: [],
    bottleneck: null,
    unparseableCount: 0,
  };
}

test('BL-832 P1: every readout names a non-empty window label', () => {
  fc.assert(
    fc.property(fc.boolean(), fc.boolean(), (hasTickets, hasBottleneck) => {
      const lifecycles = hasTickets
        ? [{ ticketId: 'BL-1', specDateIso: '2026-01-20T00:00:00Z', closeDateIso: '2026-01-25T00:00:00Z' }]
        : [];
      const stageDwell = emptyStageDwell();
      if (hasBottleneck) {
        stageDwell.bottleneck = {
          role: 'coder',
          totalDwellMs: 1000,
          processingDwellMs: 800,
          multipleOverNext: 2,
        };
      }
      const payload = buildBubbleHealthTrends(
        {
          cycleTime: computeCycleTime(lifecycles, NOW),
          velocity: computeVelocity(lifecycles, NOW),
        },
        stageDwell,
        [],
        NOW
      );
      for (const readout of [payload.traverseTime, payload.velocity, payload.bottleneck, payload.rework]) {
        assert.ok(readout.windowLabel.length > 0);
      }
    }),
    { numRuns: 20 }
  );
});

test('BL-832 P2: absent observations never display zero', () => {
  const payload = buildBubbleHealthTrends(
    { cycleTime: computeCycleTime([], NOW), velocity: computeVelocity([], NOW) },
    emptyStageDwell(),
    [],
    NOW
  );
  for (const readout of [payload.traverseTime, payload.velocity, payload.bottleneck, payload.rework]) {
    assert.equal(readout.hasObservations, false);
    assert.notEqual(readout.displayValue, '0');
    assert.match(readout.displayValue, /No observations/);
  }
});

test('BL-832 P3: health payload uses deliveryMetrics cycleTime and velocity directly', () => {
  const lifecycles = [
    { ticketId: 'BL-9', specDateIso: '2026-01-10T00:00:00Z', closeDateIso: '2026-01-20T00:00:00Z' },
  ];
  const cycleTime = computeCycleTime(lifecycles, NOW);
  const velocity = computeVelocity(lifecycles, NOW);
  const payload = buildBubbleHealthTrends({ cycleTime, velocity }, emptyStageDwell(), [], NOW);
  assert.equal(payload.traverseTime.hasObservations, cycleTime.sampleCount > 0);
  assert.equal(payload.velocity.hasObservations, velocity.rollingWindowCount > 0);
});
