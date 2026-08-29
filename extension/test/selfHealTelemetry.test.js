const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { aggregateSelfHealCounts } = require('../out/metrics/selfHealTelemetry');
const {
  emitSelfHealEvent,
  readSelfHealEvents,
  whenSelfHealTelemetryIdle,
} = require('../out/metrics/selfHealTelemetryStore');
const { mkTmpDir } = require('./helpers/tmpDir');

test('aggregateSelfHealCounts yields per-type bucket counts', () => {
  const events = [
    {
      type: 'stale-build-recompile',
      subject: 'front-desk-supervisor',
      reason: 'recompiling before respawn',
      at: '2026-08-27T10:00:00.000Z',
    },
    {
      type: 'stale-build-recompile',
      subject: 'front-desk-supervisor',
      reason: 'recompiling before respawn',
      at: '2026-08-27T11:00:00.000Z',
    },
    {
      type: 'supervisor-respawn',
      subject: 'front-desk-supervisor',
      reason: 'bounded restart',
      at: '2026-08-27T10:30:00.000Z',
    },
    {
      type: 'stale-build-recompile',
      subject: 'front-desk-supervisor',
      reason: 'outside window',
      at: '2026-08-26T08:00:00.000Z',
    },
  ];
  const agg = aggregateSelfHealCounts(events, {
    startMs: Date.parse('2026-08-27T09:00:00.000Z'),
    endMs: Date.parse('2026-08-27T12:00:00.000Z'),
    bucketMs: 60 * 60 * 1000,
  });
  assert.equal(agg['stale-build-recompile'].series.length, 2);
  assert.equal(agg['stale-build-recompile'].series.reduce((n, p) => n + p.value, 0), 2);
  assert.equal(agg['supervisor-respawn'].currentValue, 1);
});

test('emitSelfHealEvent appends one jsonl record', async () => {
  const root = mkTmpDir('bl597-');
  emitSelfHealEvent(root, {
    type: 'claim-heal',
    subject: 'handoffd',
    reason: 'resume orphaned in_process',
    at: '2026-08-27T10:00:00.000Z',
  });
  await whenSelfHealTelemetryIdle();
  const events = readSelfHealEvents(root);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'claim-heal');
  assert.equal(events[0].subject, 'handoffd');
  assert.equal(events[0].reason, 'resume orphaned in_process');
});

test('aggregateSelfHealCounts ignores events with invalid dates', () => {
  const events = [
    { type: 'test', subject: 's', reason: 'r', at: 'not-a-date' },
    { type: 'test', subject: 's', reason: 'r', at: '2026-08-27T10:00:00.000Z' },
  ];
  const agg = aggregateSelfHealCounts(events, {
    startMs: Date.parse('2026-08-27T00:00:00.000Z'),
    endMs: Date.parse('2026-08-27T23:59:59.999Z'),
  });
  assert.equal(agg['test'].series.reduce((n, p) => n + p.value, 0), 1);
});

test('aggregateSelfHealCounts excludes events outside the window', () => {
  const events = [
    { type: 'test', subject: 's', reason: 'r', at: '2026-08-26T23:59:59.999Z' },
    { type: 'test', subject: 's', reason: 'r', at: '2026-08-27T10:00:00.000Z' },
    { type: 'test', subject: 's', reason: 'r', at: '2026-08-28T00:00:00.000Z' },
  ];
  const agg = aggregateSelfHealCounts(events, {
    startMs: Date.parse('2026-08-27T00:00:00.000Z'),
    endMs: Date.parse('2026-08-27T23:59:59.999Z'),
  });
  assert.equal(agg['test'].series.reduce((n, p) => n + p.value, 0), 1);
});

test('aggregateSelfHealCounts uses default bucketMs of 24h', () => {
  const events = [
    { type: 'test', subject: 's', reason: 'r', at: '2026-08-27T10:00:00.000Z' },
    { type: 'test', subject: 's', reason: 'r', at: '2026-08-28T11:00:00.000Z' },
  ];
  const agg = aggregateSelfHealCounts(events, {
    startMs: Date.parse('2026-08-27T00:00:00.000Z'),
    endMs: Date.parse('2026-08-29T23:59:59.999Z'),
  });
  assert.equal(agg['test'].series.length, 2);
});

test('aggregateSelfHealCounts sorts buckets chronologically', () => {
  const events = [
    { type: 'test', subject: 's', reason: 'r', at: '2026-08-27T15:00:00.000Z' },
    { type: 'test', subject: 's', reason: 'r', at: '2026-08-27T10:00:00.000Z' },
    { type: 'test', subject: 's', reason: 'r', at: '2026-08-27T12:00:00.000Z' },
  ];
  const agg = aggregateSelfHealCounts(events, {
    startMs: Date.parse('2026-08-27T00:00:00.000Z'),
    endMs: Date.parse('2026-08-27T23:59:59.999Z'),
    bucketMs: 60 * 60 * 1000,
  });
  const series = agg['test'].series;
  assert.ok(new Date(series[0].periodStart) < new Date(series[1].periodStart));
  assert.ok(new Date(series[1].periodStart) < new Date(series[2].periodStart));
});

test('readSelfHealEvents returns empty array for non-existent directory', () => {
  const events = readSelfHealEvents('/nonexistent/path');
  assert.deepEqual(events, []);
});

test('readSelfHealEvents ignores malformed JSON lines', async () => {
  const root = mkTmpDir('bl597-malformed-');
  const ledgerPath = path.join(root, '.swarmforge', 'telemetry', 'self-heal-2026-08.jsonl');
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, 'not json\n{"type":"test","subject":"s","at":"2026-08-27T10:00:00.000Z"}\n');
  const events = readSelfHealEvents(root);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'test');
});

test('readSelfHealEvents ignores lines missing required fields', async () => {
  const root = mkTmpDir('bl597-missing-');
  const ledgerPath = path.join(root, '.swarmforge', 'telemetry', 'self-heal-2026-08.jsonl');
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, '{"subject":"s","at":"2026-08-27T10:00:00.000Z"}\n{"type":"test","subject":"s","at":"2026-08-27T10:00:00.000Z"}\n');
  const events = readSelfHealEvents(root);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'test');
});

test('readSelfHealEvents reads from multiple month files in order', async () => {
  const root = mkTmpDir('bl597-multi-');
  const dir = path.join(root, '.swarmforge', 'telemetry');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'self-heal-2026-07.jsonl'), '{"type":"test","subject":"s","reason":"july","at":"2026-07-15T10:00:00.000Z"}\n');
  fs.writeFileSync(path.join(dir, 'self-heal-2026-08.jsonl'), '{"type":"test","subject":"s","reason":"august","at":"2026-08-15T10:00:00.000Z"}\n');
  const events = readSelfHealEvents(root);
  assert.equal(events.length, 2);
  assert.equal(events[0].reason, 'july');
  assert.equal(events[1].reason, 'august');
});

test('readSelfHealEvents ignores non-ledger files', async () => {
  const root = mkTmpDir('bl597-ignore-');
  const dir = path.join(root, '.swarmforge', 'telemetry');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'self-heal-2026-08.jsonl'), '{"type":"test","subject":"s","at":"2026-08-15T10:00:00.000Z"}\n');
  fs.writeFileSync(path.join(dir, 'other-file.txt'), 'not a ledger\n');
  fs.writeFileSync(path.join(dir, 'self-heal-bad-format.jsonl'), '{"type":"bad","subject":"s","at":"2026-08-15T10:00:00.000Z"}\n');
  const events = readSelfHealEvents(root);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'test');
});

test('emitSelfHealEvent uses current time when at is not provided', async () => {
  const root = mkTmpDir('bl597-default-at-');
  const before = new Date();
  emitSelfHealEvent(root, {
    type: 'test',
    subject: 's',
    reason: 'r',
  });
  await whenSelfHealTelemetryIdle();
  const after = new Date();
  const events = readSelfHealEvents(root);
  assert.equal(events.length, 1);
  const eventTime = new Date(events[0].at);
  assert.ok(eventTime >= before && eventTime <= after);
});

test('readSelfHealEvents handles empty lines in ledger', async () => {
  const root = mkTmpDir('bl597-empty-lines-');
  const ledgerPath = path.join(root, '.swarmforge', 'telemetry', 'self-heal-2026-08.jsonl');
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, '\n\n{"type":"test","subject":"s","at":"2026-08-15T10:00:00.000Z"}\n\n');
  const events = readSelfHealEvents(root);
  assert.equal(events.length, 1);
});

test('aggregateSelfHealCounts includes events at window boundaries', () => {
  const events = [
    { type: 'test', subject: 's', reason: 'r', at: '2026-08-27T00:00:00.000Z' },
    { type: 'test', subject: 's', reason: 'r', at: '2026-08-27T23:59:59.999Z' },
  ];
  const agg = aggregateSelfHealCounts(events, {
    startMs: Date.parse('2026-08-27T00:00:00.000Z'),
    endMs: Date.parse('2026-08-27T23:59:59.999Z'),
    bucketMs: 60 * 60 * 1000,
  });
  assert.equal(agg['test'].series.reduce((n, p) => n + p.value, 0), 2);
});

test('aggregateSelfHealCounts excludes events just outside window boundaries', () => {
  const events = [
    { type: 'test', subject: 's', reason: 'r', at: '2026-08-26T23:59:59.998Z' },
    { type: 'test', subject: 's', reason: 'r', at: '2026-08-27T00:00:00.000Z' },
    { type: 'test', subject: 's', reason: 'r', at: '2026-08-27T23:59:59.999Z' },
    { type: 'test', subject: 's', reason: 'r', at: '2026-08-28T00:00:00.001Z' },
  ];
  const agg = aggregateSelfHealCounts(events, {
    startMs: Date.parse('2026-08-27T00:00:00.000Z'),
    endMs: Date.parse('2026-08-27T23:59:59.999Z'),
    bucketMs: 60 * 60 * 1000,
  });
  assert.equal(agg['test'].series.reduce((n, p) => n + p.value, 0), 2);
});

test('aggregateSelfHealCounts handles empty events array', () => {
  const agg = aggregateSelfHealCounts([], {
    startMs: Date.parse('2026-08-27T00:00:00.000Z'),
    endMs: Date.parse('2026-08-27T23:59:59.999Z'),
  });
  assert.deepEqual(agg, {});
});
