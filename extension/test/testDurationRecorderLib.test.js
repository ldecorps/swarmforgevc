const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listTestFiles, buildRecord, appendRecord } = require('../scripts/testDurationRecorderLib');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-recorder-lib-'));
}

test('listTestFiles returns only .test.js files, sorted', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'b.test.js'), '');
  fs.writeFileSync(path.join(dir, 'a.test.js'), '');
  fs.writeFileSync(path.join(dir, 'helpers.js'), '');
  fs.writeFileSync(path.join(dir, 'notes.txt'), '');

  assert.deepEqual(listTestFiles(dir), ['a.test.js', 'b.test.js']);
});

// BL-078 suite-duration-01
test('buildRecord shapes a pass record with finished_at, test_count, result, duration_ms', () => {
  const rec = buildRecord({ finishedAt: '2026-07-03T10:00:00.000Z', testCount: 42, exitCode: 0, durationMs: 33000 });
  assert.deepEqual(rec, {
    finished_at: '2026-07-03T10:00:00.000Z',
    test_count: 42,
    result: 'pass',
    duration_ms: 33000,
  });
});

test('buildRecord marks a non-zero exit code as fail', () => {
  const rec = buildRecord({ finishedAt: '2026-07-03T10:00:00.000Z', testCount: 42, exitCode: 1, durationMs: 5000 });
  assert.equal(rec.result, 'fail');
});

test('appendRecord writes one JSON line per call, appending to existing content', () => {
  const dir = mkTmp();
  const logPath = path.join(dir, '.test-durations.jsonl');
  appendRecord(logPath, { a: 1 });
  appendRecord(logPath, { a: 2 });

  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  assert.deepEqual(
    lines.map((l) => JSON.parse(l)),
    [{ a: 1 }, { a: 2 }]
  );
});

// BL-078 suite-duration-02
test('appendRecord swallows a write failure and reports it without throwing', () => {
  const dir = mkTmp();
  // A path whose parent directory does not exist cannot be written to.
  const logPath = path.join(dir, 'missing-subdir', '.test-durations.jsonl');
  assert.doesNotThrow(() => {
    const ok = appendRecord(logPath, { a: 1 });
    assert.equal(ok, false);
  });
});
