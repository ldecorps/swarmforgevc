const assert = require('node:assert/strict');
const {
  resolveContextFullness,
  estimateProxyFullnessPercent,
} = require('../out/swarm/contextFullness');

// --- resolveContextFullness (BL-141 context-clear-75-03) ---

test('uses telemetry when a backend reports context usage', () => {
  const result = resolveContextFullness(82, 10);
  assert.equal(result.percent, 82);
  assert.equal(result.source, 'telemetry');
});

test('falls back to the proxy metric when telemetry is unavailable (null)', () => {
  const result = resolveContextFullness(null, 40);
  assert.equal(result.percent, 40);
  assert.equal(result.source, 'proxy');
});

test('clamps a telemetry value above 100 to 100', () => {
  const result = resolveContextFullness(140, 0);
  assert.equal(result.percent, 100);
  assert.equal(result.source, 'telemetry');
});

test('clamps a negative telemetry value to 0', () => {
  const result = resolveContextFullness(-5, 0);
  assert.equal(result.percent, 0);
  assert.equal(result.source, 'telemetry');
});

// --- estimateProxyFullnessPercent (deterministic pane-history proxy) ---

test('estimateProxyFullnessPercent is 0 for an empty pane history', () => {
  assert.equal(estimateProxyFullnessPercent(0, 1000), 0);
});

test('estimateProxyFullnessPercent is 100 once line count reaches the configured full-line count', () => {
  assert.equal(estimateProxyFullnessPercent(1000, 1000), 100);
});

test('estimateProxyFullnessPercent scales linearly below the full-line count', () => {
  assert.equal(estimateProxyFullnessPercent(750, 1000), 75);
});

test('estimateProxyFullnessPercent clamps above the full-line count to 100, not more', () => {
  assert.equal(estimateProxyFullnessPercent(5000, 1000), 100);
});

test('estimateProxyFullnessPercent treats a non-positive full-line count as always-full (100)', () => {
  assert.equal(estimateProxyFullnessPercent(10, 0), 100);
});
