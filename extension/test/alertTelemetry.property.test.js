'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  aggregateFalsePositiveRate,
  aggregateFalsePositiveRateByType,
} = require('../out/metrics/alertTelemetry');
const {
  emitAlertVerdict,
  evaluateAlertWithTelemetry,
  readAlertRecords,
  whenAlertTelemetryIdle,
} = require('../out/metrics/alertTelemetryStore');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

test('aggregateFalsePositiveRate computes per-window rate', () => {
  const hour = 60 * 60 * 1000;
  const series = aggregateFalsePositiveRate(
    [
      { at: '2026-08-25T10:00:00.000Z', alertType: 'AGENT_EXITED', verdict: 'false-positive', fired: true },
      { at: '2026-08-25T10:30:00.000Z', alertType: 'AGENT_EXITED', verdict: 'actionable', fired: true },
      { at: '2026-08-25T11:00:00.000Z', alertType: 'AGENT_EXITED', verdict: 'false-positive', fired: true },
    ],
    hour
  );
  assert.equal(series[0].value, 0.5);
  assert.equal(series[1].value, 1);
});

test('aggregateFalsePositiveRateByType groups by alert type', () => {
  const hour = 60 * 60 * 1000;
  const byType = aggregateFalsePositiveRateByType(
    [
      { at: '2026-08-25T10:00:00.000Z', alertType: 'AGENT_EXITED', verdict: 'false-positive', fired: true },
      { at: '2026-08-25T10:05:00.000Z', alertType: 'active-backlog-depth', verdict: 'false-positive', fired: true },
    ],
    hour
  );
  assert.equal(byType.AGENT_EXITED[0].value, 1);
  assert.equal(byType['active-backlog-depth'][0].value, 1);
});

test('aggregateFalsePositiveRate ignores records where fired is false', () => {
  const hour = 60 * 60 * 1000;
  const series = aggregateFalsePositiveRate(
    [
      { at: '2026-08-25T10:00:00.000Z', alertType: 'AGENT_EXITED', verdict: 'false-positive', fired: false },
      { at: '2026-08-25T10:30:00.000Z', alertType: 'AGENT_EXITED', verdict: 'actionable', fired: true },
    ],
    hour
  );
  assert.equal(series.length, 1);
  assert.equal(series[0].value, 0);
});

test('evaluateAlertWithTelemetry does not change evaluation result', async () => {
  const root = mkTmpDir('bl598-unit-');
  const out = evaluateAlertWithTelemetry(root, 'operator-actionable', 'actionable', () => 42);
  assert.equal(out, 42);
  await whenAlertTelemetryIdle();
  const records = readAlertRecords(root);
  assert.equal(records.length, 1);
  assert.equal(records[0].alertType, 'operator-actionable');
});

test('emit survives unwritable telemetry path', async () => {
  const root = mkTmpDir('bl598-bad-');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'telemetry'), 'not-a-dir');
  assert.doesNotThrow(() => emitAlertVerdict(root, 'AGENT_EXITED', 'false-positive'));
  await whenAlertTelemetryIdle();
});
