const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { computeSuiteDuration, DEFAULT_SUITE_WARN_SECONDS } = require('../out/metrics/swarmMetrics');

// BL-078: aggregates the .test-durations.jsonl recorder log across the main
// checkout and every role worktree into one latest/mean/sampleCount view,
// flagging creep before it throttles the whole pipeline (BL-060 lesson).

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-suite-duration-'));
}

function writeLog(worktreePath, records) {
  const dir = path.join(worktreePath, 'extension');
  fs.mkdirSync(dir, { recursive: true });
  const lines = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, '.test-durations.jsonl'), lines);
}

function record(finishedAt, durationMs) {
  return { finished_at: finishedAt, test_count: 1000, result: 'pass', duration_ms: durationMs };
}

// BL-078 suite-duration-05
test('no logs anywhere returns a null placeholder state, never NaN', () => {
  const targetPath = mkTmp();
  const result = computeSuiteDuration(targetPath, []);
  assert.deepEqual(result, { latestMs: null, meanMs: null, sampleCount: 0, warn: false });
});

test('aggregates records across the main checkout and every role worktree', () => {
  const targetPath = mkTmp();
  const coderWt = mkTmp();
  const cleanerWt = mkTmp();

  writeLog(targetPath, [record('2026-07-03T10:00:00Z', 30000)]);
  writeLog(coderWt, [record('2026-07-03T11:00:00Z', 40000)]);
  writeLog(cleanerWt, [record('2026-07-03T12:00:00Z', 50000)]);

  const roles = [
    { role: 'coder', worktreePath: coderWt },
    { role: 'cleaner', worktreePath: cleanerWt },
  ];
  const result = computeSuiteDuration(targetPath, roles);

  assert.equal(result.sampleCount, 3);
  assert.equal(result.latestMs, 50000, 'latest is the most recent record across ALL logs, not just one worktree');
  assert.equal(result.meanMs, 40000);
});

test('the rolling mean only covers the last N runs (default 20), oldest dropped', () => {
  const targetPath = mkTmp();
  const records = [];
  for (let i = 0; i < 25; i++) {
    records.push(record(`2026-07-01T00:${String(i).padStart(2, '0')}:00Z`, 10000));
  }
  // 5 oldest runs are much slower; they must fall outside the 20-run window.
  records[0] = record('2026-07-01T00:00:00Z', 1000000);
  writeLog(targetPath, records);

  const result = computeSuiteDuration(targetPath, []);
  assert.equal(result.sampleCount, 20);
  assert.equal(result.meanMs, 10000, 'the outlier at position 0 (oldest) must be outside the last-20 window');
});

test('malformed lines are skipped, never crash the aggregation', () => {
  const targetPath = mkTmp();
  const dir = path.join(targetPath, 'extension');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.test-durations.jsonl'),
    'not json\n' + JSON.stringify(record('2026-07-03T10:00:00Z', 33000)) + '\n{"finished_at": "bogus", "duration_ms": 5}\n'
  );

  const result = computeSuiteDuration(targetPath, []);
  assert.equal(result.sampleCount, 1);
  assert.equal(result.latestMs, 33000);
});

// BL-078 suite-duration-04
test('warn triggers when the latest run exceeds the absolute threshold', () => {
  const targetPath = mkTmp();
  writeLog(targetPath, [
    record('2026-07-03T10:00:00Z', 35000),
    record('2026-07-03T10:01:00Z', 35000),
    record('2026-07-03T10:02:00Z', 150000),
  ]);
  const result = computeSuiteDuration(targetPath, [], DEFAULT_SUITE_WARN_SECONDS * 1000);
  assert.equal(result.warn, true);
});

test('warn stays false when the latest run is under threshold and near the mean', () => {
  const targetPath = mkTmp();
  writeLog(targetPath, [
    record('2026-07-03T10:00:00Z', 35000),
    record('2026-07-03T10:01:00Z', 35000),
    record('2026-07-03T10:02:00Z', 33000),
  ]);
  const result = computeSuiteDuration(targetPath, [], DEFAULT_SUITE_WARN_SECONDS * 1000);
  assert.equal(result.warn, false);
});

test('warn triggers on relative creep (latest > 2x mean) even under a generous absolute threshold', () => {
  const targetPath = mkTmp();
  writeLog(targetPath, [
    record('2026-07-03T10:00:00Z', 50000),
    record('2026-07-03T10:01:00Z', 50000),
    record('2026-07-03T10:02:00Z', 130000),
  ]);
  const result = computeSuiteDuration(targetPath, [], 1000 * 1000 /* generous absolute threshold */);
  assert.equal(result.warn, true, '130s is more than 2x the 100s->prior mean, must warn regardless of absolute threshold');
});

test('a single sampled run never self-triggers the 2x-mean warn', () => {
  const targetPath = mkTmp();
  writeLog(targetPath, [record('2026-07-03T10:00:00Z', 90000)]);
  const result = computeSuiteDuration(targetPath, [], DEFAULT_SUITE_WARN_SECONDS * 1000);
  assert.equal(result.warn, false, '90s is under the 120s absolute threshold and mean==latest for one sample');
});
