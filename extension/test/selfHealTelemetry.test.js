const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { aggregateSelfHealCounts } = require('../out/metrics/selfHealTelemetry');
const {
  emitSelfHealEvent,
  readSelfHealEvents,
  whenSelfHealTelemetryIdle,
} = require('../out/metrics/selfHealTelemetryStore');

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
  ];
  const agg = aggregateSelfHealCounts(events, {
    startMs: Date.parse('2026-08-27T09:00:00.000Z'),
    endMs: Date.parse('2026-08-27T12:00:00.000Z'),
    bucketMs: 60 * 60 * 1000,
  });
  assert.equal(agg['stale-build-recompile'].series.length, 2);
  assert.equal(agg['supervisor-respawn'].currentValue, 1);
});

test('emitSelfHealEvent appends one jsonl record', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl597-'));
  try {
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
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
