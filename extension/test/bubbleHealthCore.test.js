'use strict';

const assert = require('node:assert/strict');
const {
  buildBubbleHealthTrends,
  reworkBreakdownByRole,
  readoutByFeatureName,
  HEALTH_REWORK_WINDOW_DAYS,
} = require('../out/bridge/bubbleHealthCore');
const { computeCycleTime, computeVelocity } = require('../out/metrics/deliveryMetrics');
const { DEFAULT_STAGE_DWELL_WINDOW_HOURS } = require('../out/metrics/stageDwell');

const NOW = Date.parse('2026-02-01T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function lifecycle(id, specIso, closeIso) {
  return { ticketId: id, specDateIso: specIso, closeDateIso: closeIso };
}

function emptyStageDwell() {
  return {
    windowHours: DEFAULT_STAGE_DWELL_WINDOW_HOURS,
    windowStartIso: new Date(NOW - DEFAULT_STAGE_DWELL_WINDOW_HOURS * 3600000).toISOString(),
    windowEndIso: new Date(NOW).toISOString(),
    stages: [],
    bottleneck: null,
    unparseableCount: 0,
  };
}

test('buildBubbleHealthTrends reports traverse and velocity from delivery metrics', () => {
  const lifecycles = [
    lifecycle('BL-1', '2026-01-20T00:00:00Z', '2026-01-25T00:00:00Z'),
    lifecycle('BL-2', '2026-01-22T00:00:00Z', '2026-01-28T00:00:00Z'),
  ];
  const deliveryMetrics = {
    cycleTime: computeCycleTime(lifecycles, NOW),
    velocity: computeVelocity(lifecycles, NOW),
  };
  const payload = buildBubbleHealthTrends(deliveryMetrics, emptyStageDwell(), [], NOW);
  assert.equal(payload.traverseTime.hasObservations, true);
  assert.match(payload.traverseTime.displayValue, /median/);
  assert.equal(payload.velocity.hasObservations, true);
  assert.match(payload.velocity.displayValue, /closed/);
});

test('reworkBreakdownByRole attributes bounces separately by role', () => {
  const windowEnd = NOW;
  const windowStart = NOW - HEALTH_REWORK_WINDOW_DAYS * DAY_MS;
  const records = [
    { ticketId: 'BL-1', completedAtMs: NOW - DAY_MS, bounced: true, bouncedFromRole: 'qa', ticketClass: 'low' },
    { ticketId: 'BL-2', completedAtMs: NOW - DAY_MS, bounced: true, bouncedFromRole: 'architect', ticketClass: 'low' },
    { ticketId: 'BL-3', completedAtMs: NOW - DAY_MS, bounced: false, bouncedFromRole: null, ticketClass: 'low' },
  ];
  const breakdown = reworkBreakdownByRole(records, windowStart, windowEnd);
  assert.equal(breakdown.length, 2);
  assert.deepEqual(
    breakdown.map((row) => row.role).sort(),
    ['architect', 'qa']
  );
});

test('empty samples read as absent not zero', () => {
  const deliveryMetrics = {
    cycleTime: computeCycleTime([], NOW),
    velocity: computeVelocity([], NOW),
  };
  const payload = buildBubbleHealthTrends(deliveryMetrics, emptyStageDwell(), [], NOW);
  for (const key of ['traverseTime', 'velocity', 'bottleneck', 'rework']) {
    const readout = payload[key];
    assert.equal(readout.hasObservations, false);
    assert.equal(readout.displayValue, 'No observations');
    assert.notEqual(readout.displayValue, '0');
  }
});

test('readoutByFeatureName maps scenario labels', () => {
  const deliveryMetrics = {
    cycleTime: computeCycleTime([], NOW),
    velocity: computeVelocity([], NOW),
  };
  const payload = buildBubbleHealthTrends(deliveryMetrics, emptyStageDwell(), [], NOW);
  assert.equal(readoutByFeatureName(payload, 'traverse time').id, 'traverse-time');
  assert.equal(readoutByFeatureName(payload, 'rework rate').id, 'rework');
});
