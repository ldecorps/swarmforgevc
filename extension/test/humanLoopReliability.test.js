'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const {
  aggregateOutcomeSuccessRate,
  aggregateTickDurationMean,
} = require('../out/metrics/humanLoopReliability');
const {
  emitApprovalTap,
  emitSteeringDelivery,
  emitPollHealth,
  emitTickDuration,
  emitHumanLoopRecord,
  whenHumanLoopIdle,
  readHumanLoopRecords,
  humanLoopLedgerPath,
} = require('../out/metrics/humanLoopReliabilityStore');

describe('BL-595 humanLoopReliability', () => {
  let root;

  beforeEach(() => {
    root = mkTmpDir('bl595-unit-');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('aggregates outcome success rate per window without reading files', () => {
    const records = [
      { at: '2026-08-25T10:00:00.000Z', series: 'approval-tap', outcome: 'recorded' },
      { at: '2026-08-25T10:00:30.000Z', series: 'approval-tap', outcome: 'repaint-failed' },
      { at: '2026-08-25T11:00:00.000Z', series: 'approval-tap', outcome: 'recorded' },
    ];
    const hour = 60 * 60 * 1000;
    const series = aggregateOutcomeSuccessRate(records, hour);
    assert.equal(series.length, 2);
    assert.equal(series[0].value, 0.5);
    assert.equal(series[1].value, 1);
  });

  it('aggregates tick duration mean per window', () => {
    const records = [
      { at: '2026-08-25T10:00:00.000Z', series: 'tick-duration', durationMs: 10 },
      { at: '2026-08-25T10:00:01.000Z', series: 'tick-duration', durationMs: 30 },
      { at: '2026-08-25T11:00:00.000Z', series: 'tick-duration', durationMs: 100 },
    ];
    const hour = 60 * 60 * 1000;
    const series = aggregateTickDurationMean(records, hour);
    assert.equal(series.length, 2);
    assert.equal(series[0].value, 20);
    assert.equal(series[1].value, 100);
  });

  it('appends records asynchronously and preserves earlier lines', async () => {
    emitApprovalTap(root, 'recorded', undefined, '2026-08-25T12:00:00.000Z');
    await whenHumanLoopIdle();
    emitSteeringDelivery(root, 'delivered', '2026-08-25T12:00:01.000Z');
    await whenHumanLoopIdle();
    const records = readHumanLoopRecords(root);
    assert.equal(records.length, 2);
    assert.equal(records[0].outcome, 'recorded');
    assert.equal(records[1].outcome, 'delivered');
    const file = humanLoopLedgerPath(root, '2026-08-25T12:00:00.000Z');
    assert.match(file, /human-loop-2026-08\.jsonl$/);
  });

  it('survives an unwritable log without throwing', async () => {
    const blocked = path.join(root, 'blocked');
    fs.mkdirSync(blocked);
    fs.chmodSync(blocked, 0o500);
    // Point ledger under a file-as-dir conflict: create a FILE where telemetry dir should be
    const badRoot = path.join(root, 'bad');
    fs.mkdirSync(path.join(badRoot, '.swarmforge'), { recursive: true });
    fs.writeFileSync(path.join(badRoot, '.swarmforge', 'telemetry'), 'not-a-dir');
    assert.doesNotThrow(() => emitTickDuration(badRoot, 42));
    await whenHumanLoopIdle();
    assert.doesNotThrow(() => emitApprovalTap(badRoot, 'recorded'));
    await whenHumanLoopIdle();
  });

  it('distinguishes drop reasons on silently-dropped taps', async () => {
    emitApprovalTap(root, 'silently-dropped', 'not-my-chat');
    emitApprovalTap(root, 'silently-dropped', 'not-principal');
    emitApprovalTap(root, 'silently-dropped', 'unrecognized-data');
    await whenHumanLoopIdle();
    const records = readHumanLoopRecords(root);
    assert.deepEqual(
      records.map((r) => r.reason),
      ['not-my-chat', 'not-principal', 'unrecognized-data']
    );
  });

  it('emits poll health and tick duration shapes', async () => {
    emitPollHealth(root, 'degraded');
    emitPollHealth(root, 'conflict-409');
    emitTickDuration(root, 17);
    await whenHumanLoopIdle();
    const records = readHumanLoopRecords(root);
    assert.equal(records.length, 3);
    assert.equal(records[0].series, 'poll-health');
    assert.equal(records[2].series, 'tick-duration');
    assert.equal(records[2].durationMs, 17);
  });
});
