const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildRecord,
  summarizeDurations,
  formatPropertyDurationVerdict,
  HALF_TIMEOUT_MS,
} = require('../scripts/recordPropertyDurationLib');
const { appendRecord } = require('../scripts/testDurationRecorderLib');

function mkTmp() {
  return mkTmpDir('sfvc-property-recorder-lib-');
}

// BL-1619 invariant 1 / scenario 01 ─────────────────────────────────────

test('buildRecord shapes a pass record with finished_at, file_count, result, duration_ms, work_ms, pole_ms, pole_file', () => {
  const rec = buildRecord({
    finishedAt: '2026-10-06T10:00:00.000Z',
    fileCount: 3,
    exitCode: 0,
    durationMs: 33000,
    workMs: 20000,
    poleMs: 12000,
    poleFile: 'test/foo.property.test.js',
  });
  assert.deepEqual(rec, {
    finished_at: '2026-10-06T10:00:00.000Z',
    file_count: 3,
    result: 'pass',
    duration_ms: 33000,
    work_ms: 20000,
    pole_ms: 12000,
    pole_file: 'test/foo.property.test.js',
  });
});

test('buildRecord shapes a fail record on a non-zero exit code', () => {
  const rec = buildRecord({
    finishedAt: '2026-10-06T10:00:00.000Z',
    fileCount: 3,
    exitCode: 1,
    durationMs: 33000,
    workMs: 20000,
    poleMs: 12000,
    poleFile: 'test/foo.property.test.js',
  });
  assert.equal(rec.result, 'fail');
});

test('appendRecord (the unit-lane recorder own, reused unchanged) writes one JSON line', () => {
  const dir = mkTmp();
  const logPath = path.join(dir, '.property-durations.jsonl');
  const rec = buildRecord({
    finishedAt: '2026-10-06T10:00:00.000Z',
    fileCount: 1,
    exitCode: 0,
    durationMs: 1000,
    workMs: 500,
    poleMs: 500,
    poleFile: 'test/a.property.test.js',
  });
  assert.equal(appendRecord(logPath, rec), true);
  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), rec);
});

// ── summarizeDurations (pure fold: work sum, pole, pole file) ──────────

test('summarizeDurations folds an empty list to zero work, zero pole, no pole file', () => {
  assert.deepEqual(summarizeDurations([]), { workMs: 0, poleMs: 0, poleFile: null });
});

test('summarizeDurations sums work and names the single slowest file as the pole', () => {
  const durations = [
    { file: 'test/a.property.test.js', durationMs: 3000 },
    { file: 'test/b.property.test.js', durationMs: 12000 },
    { file: 'test/c.property.test.js', durationMs: 5000 },
  ];
  assert.deepEqual(summarizeDurations(durations), {
    workMs: 20000,
    poleMs: 12000,
    poleFile: 'test/b.property.test.js',
  });
});

test('summarizeDurations keeps the FIRST file on an exact tie for the pole', () => {
  const durations = [
    { file: 'test/first.property.test.js', durationMs: 9000 },
    { file: 'test/second.property.test.js', durationMs: 9000 },
  ];
  assert.deepEqual(summarizeDurations(durations), {
    workMs: 18000,
    poleMs: 9000,
    poleFile: 'test/first.property.test.js',
  });
});

// ── formatPropertyDurationVerdict (BL-1619 scenario 02) ─────────────────

test('HALF_TIMEOUT_MS is half the lane baseline testTimeout (20s)', () => {
  assert.equal(HALF_TIMEOUT_MS, 10000);
});

test('the verdict names the pole file and its seconds, lists every file above the half-timeout threshold with its seconds, and prints the work sum and wall in seconds', () => {
  const durations = [
    { file: 'test/pole.property.test.js', durationMs: 12000 },
    { file: 'test/second.property.test.js', durationMs: 11000 },
    { file: 'test/third.property.test.js', durationMs: 10500 },
    { file: 'test/fast.property.test.js', durationMs: 2000 },
  ];
  const summary = summarizeDurations(durations);
  const verdict = formatPropertyDurationVerdict(summary, durations, HALF_TIMEOUT_MS, 15000);

  assert.match(verdict, /pole: test\/pole\.property\.test\.js \(12\.0s\)/);
  assert.match(verdict, /test\/pole\.property\.test\.js \(12\.0s\)/);
  assert.match(verdict, /test\/second\.property\.test\.js \(11\.0s\)/);
  assert.match(verdict, /test\/third\.property\.test\.js \(10\.5s\)/);
  assert.doesNotMatch(verdict, /test\/fast\.property\.test\.js/);
  assert.match(verdict, /work 35\.5s/);
  assert.match(verdict, /wall 15\.0s/);
});

test('the verdict reports no pole and no files above threshold on an empty run', () => {
  const summary = summarizeDurations([]);
  const verdict = formatPropertyDurationVerdict(summary, [], HALF_TIMEOUT_MS, 0);
  assert.match(verdict, /pole: none/);
  assert.match(verdict, /above 10\.0s: none/);
});

test('a file exactly at the half-timeout threshold is not listed as above it', () => {
  const durations = [
    { file: 'test/exactly-at-threshold.property.test.js', durationMs: HALF_TIMEOUT_MS },
    { file: 'test/just-above-threshold.property.test.js', durationMs: HALF_TIMEOUT_MS + 1 },
  ];
  const summary = summarizeDurations(durations);
  const verdict = formatPropertyDurationVerdict(summary, durations, HALF_TIMEOUT_MS, 11000);
  assert.doesNotMatch(verdict, /exactly-at-threshold/);
  assert.match(verdict, /just-above-threshold\.property\.test\.js \(10\.0s\)/);
});

test('a single fast file is its own pole but never listed above the threshold', () => {
  const durations = [{ file: 'test/fast.property.test.js', durationMs: 500 }];
  const summary = summarizeDurations(durations);
  const verdict = formatPropertyDurationVerdict(summary, durations, HALF_TIMEOUT_MS, 1000);
  assert.match(verdict, /pole: test\/fast\.property\.test\.js \(0\.5s\)/);
  assert.match(verdict, /above 10\.0s: none/);
});
