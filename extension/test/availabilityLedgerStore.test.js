const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  availabilityTelemetryDir,
  availabilityLedgerFileForMonth,
  appendAvailabilityRecord,
} = require('../out/metrics/availabilityLedgerStore');

function mkTmp() {
  return mkTmpDir('bl823-availability-store-');
}

function readLines(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

test('availabilityTelemetryDir points at .swarmforge/telemetry', () => {
  const root = mkTmp();
  assert.equal(availabilityTelemetryDir(root), path.join(root, '.swarmforge', 'telemetry'));
});

test('availabilityLedgerFileForMonth names the monthly jsonl file by convention', () => {
  const root = mkTmp();
  assert.equal(
    availabilityLedgerFileForMonth(root, '2026-08'),
    path.join(root, '.swarmforge', 'telemetry', 'availability-2026-08.jsonl')
  );
});

test('appendAvailabilityRecord appends one {ts,event,class,source} line to the month file matching the ts', () => {
  const root = mkTmp();
  appendAvailabilityRecord(root, 'pause-start', 'control-pause', 'test-source', '2026-08-06T01:00:00Z');
  const lines = readLines(availabilityLedgerFileForMonth(root, '2026-08'));
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], {
    ts: '2026-08-06T01:00:00Z',
    event: 'pause-start',
    class: 'control-pause',
    source: 'test-source',
  });
});

test('appendAvailabilityRecord is append-only across multiple calls, never rewriting prior lines', () => {
  const root = mkTmp();
  appendAvailabilityRecord(root, 'stop', 'swarm-stop', 'kill_pipeline_swarm.sh', '2026-08-06T01:00:00Z');
  appendAvailabilityRecord(root, 'start', 'swarm-stop', 'start-swarm.sh', '2026-08-06T02:00:00Z');
  const lines = readLines(availabilityLedgerFileForMonth(root, '2026-08'));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].event, 'stop');
  assert.equal(lines[1].event, 'start');
});

test('appendAvailabilityRecord routes each record to the ledger file matching its own month', () => {
  const root = mkTmp();
  appendAvailabilityRecord(root, 'stop', 'swarm-stop', 'test', '2026-08-31T23:00:00Z');
  appendAvailabilityRecord(root, 'start', 'swarm-stop', 'test', '2026-09-01T01:00:00Z');
  assert.equal(readLines(availabilityLedgerFileForMonth(root, '2026-08')).length, 1);
  assert.equal(readLines(availabilityLedgerFileForMonth(root, '2026-09')).length, 1);
});

test('appendAvailabilityRecord defaults ts to now when omitted', () => {
  const root = mkTmp();
  const before = Date.now();
  appendAvailabilityRecord(root, 'pause-start', 'control-pause', 'test');
  const after = Date.now();
  const [record] = readLines(availabilityLedgerFileForMonth(root, new Date().toISOString().slice(0, 7)));
  const recordedMs = Date.parse(record.ts);
  assert.ok(recordedMs >= before && recordedMs <= after, `expected ts within [${before}, ${after}], got ${record.ts}`);
});

// BL-823 invariant 1 + scenario 05: a ledger write failure never blocks,
// fails, or alters the operation it observes. A directory sitting at the
// exact ledger file path is the established, portable way this codebase
// simulates a real, unmocked write failure (EISDIR) - see
// topicDeletion.test.js's "real EISDIR, not mocked" convention. chmod is
// deliberately not used (engineering rule: never chmod for failure sim).
test('appendAvailabilityRecord swallows a write failure (EISDIR) and never throws', () => {
  const root = mkTmp();
  const blockedFile = availabilityLedgerFileForMonth(root, '2026-08');
  fs.mkdirSync(blockedFile, { recursive: true }); // a directory where a file is expected
  assert.doesNotThrow(() => {
    appendAvailabilityRecord(root, 'pause-start', 'control-pause', 'test', '2026-08-06T01:00:00Z');
  });
});

test('appendAvailabilityRecord returns undefined (no result to consume) whether or not the write succeeded', () => {
  const root = mkTmp();
  const blockedFile = availabilityLedgerFileForMonth(root, '2026-08');
  fs.mkdirSync(blockedFile, { recursive: true });
  const result = appendAvailabilityRecord(root, 'stop', 'swarm-stop', 'test', '2026-08-06T01:00:00Z');
  assert.equal(result, undefined);
});
