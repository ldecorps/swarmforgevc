const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  aggregateRotationDynamics,
  queryRotationDynamics,
  DEFAULT_THRASH_WINDOW_MS,
} = require('../out/metrics/rotationDynamics');
const {
  emitRotationEvent,
  readRotationEvents,
  whenRotationTelemetryIdle,
} = require('../out/metrics/rotationDynamicsStore');

test('aggregateRotationDynamics computes dwell shares and rotations per day', () => {
  const startMs = Date.parse('2026-08-27T10:00:00.000Z');
  const endMs = Date.parse('2026-08-27T12:00:00.000Z');
  const events = [
    { at: '2026-08-27T10:00:00.000Z', from: 'coder', to: 'cleaner', reason: 'handoff-forward' },
    { at: '2026-08-27T11:00:00.000Z', from: 'cleaner', to: 'coder', reason: 'rotate-home' },
  ];
  const agg = aggregateRotationDynamics(events, {
    startMs,
    endMs,
    homeRole: 'coder',
    thrashWindowMs: DEFAULT_THRASH_WINDOW_MS,
  });
  assert.ok(agg.dwellShares.cleaner > 0);
  assert.ok(agg.dwellShares.coder > 0);
  assert.equal(agg.ordinaryRotations, 2);
  assert.equal(agg.thrashRotations, 0);
  assert.equal(agg.strandedOffHomeMs, 60 * 60 * 1000);
  assert.ok(agg.rotationsPerDay > 0);
});

test('thrash rotations flip back within the thrash window', () => {
  const startMs = Date.parse('2026-08-27T10:00:00.000Z');
  const endMs = Date.parse('2026-08-27T11:00:00.000Z');
  const events = [
    { at: '2026-08-27T10:00:00.000Z', from: 'coder', to: 'cleaner', reason: 'chase' },
    { at: '2026-08-27T10:00:05.000Z', from: 'cleaner', to: 'coder', reason: 'chase' },
    { at: '2026-08-27T10:30:00.000Z', from: 'coder', to: 'architect', reason: 'handoff-forward' },
  ];
  const agg = aggregateRotationDynamics(events, {
    startMs,
    endMs,
    homeRole: 'coder',
    thrashWindowMs: 30_000,
  });
  assert.equal(agg.thrashRotations, 1);
  assert.equal(agg.ordinaryRotations, 2);
});

test('queryRotationDynamics returns NA for non-mono-router packs', () => {
  const result = queryRotationDynamics([], {
    startMs: 0,
    endMs: 1,
    homeRole: 'coder',
  }, false);
  assert.equal(result.applicable, false);
  assert.equal(result.aggregate, null);
});

test('emitRotationEvent appends one jsonl record', async () => {
  const root = mkTmpDir('bl596-');
  try {
    emitRotationEvent(root, {
      from: 'coder',
      to: 'cleaner',
      reason: 'handoff-forward',
      at: '2026-08-27T10:00:00.000Z',
    });
    await whenRotationTelemetryIdle();
    const events = readRotationEvents(root);
    assert.equal(events.length, 1);
    assert.equal(events[0].from, 'coder');
    assert.equal(events[0].to, 'cleaner');
    assert.equal(events[0].reason, 'handoff-forward');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
