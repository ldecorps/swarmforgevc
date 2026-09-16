const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listTestFiles, buildRecord, appendRecord, computeFinalExitCode } = require('../scripts/testDurationRecorderLib');

function mkTmp() {
  return mkTmpDir('sfvc-recorder-lib-');
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
  const rec = buildRecord({
    finishedAt: '2026-07-03T10:00:00.000Z',
    testCount: 42,
    exitCode: 0,
    durationMs: 33000,
    poleMs: 4800,
    workMs: 120000,
    newOffenders: 0,
    watchFiles: 0,
    budgetVerdict: 'ok',
    workBudgetVerdict: 'ok',
  });
  assert.deepEqual(rec, {
    finished_at: '2026-07-03T10:00:00.000Z',
    test_count: 42,
    result: 'pass',
    duration_ms: 33000,
    pole_ms: 4800,
    work_ms: 120000,
    new_offenders: 0,
    watch_files: 0,
    budget_verdict: 'ok',
    work_budget_verdict: 'ok',
  });
});

test('buildRecord marks a non-zero exit code as fail', () => {
  const rec = buildRecord({
    finishedAt: '2026-07-03T10:00:00.000Z',
    testCount: 42,
    exitCode: 1,
    durationMs: 5000,
    poleMs: 5000,
    workMs: 5000,
    newOffenders: 0,
    watchFiles: 0,
    budgetVerdict: 'ok',
    workBudgetVerdict: 'ok',
  });
  assert.equal(rec.result, 'fail');
});

// BL-1598 unit-suite-pole-register-02: result (test outcome) and
// budget_verdict (the guard's own verdict) vary independently.
test('buildRecord keeps result and budget_verdict independent - a passing run can still carry a non-ok budget_verdict', () => {
  const rec = buildRecord({
    finishedAt: '2026-07-03T10:00:00.000Z',
    testCount: 1,
    exitCode: 0,
    durationMs: 1000,
    poleMs: 9000,
    workMs: 9000,
    newOffenders: 1,
    watchFiles: 0,
    budgetVerdict: 'new-pole',
    workBudgetVerdict: 'ok',
  });
  assert.equal(rec.result, 'pass');
  assert.equal(rec.budget_verdict, 'new-pole');
  assert.equal(rec.new_offenders, 1);
});

// BL-1598 amendment (2026-09-16): a watch verdict is reported (recorded on
// the row) but never fails the run.
test('buildRecord records watch_files independently of a passing exit code', () => {
  const rec = buildRecord({
    finishedAt: '2026-07-03T10:00:00.000Z',
    testCount: 1,
    exitCode: 0,
    durationMs: 1000,
    poleMs: 9000,
    workMs: 9000,
    newOffenders: 0,
    watchFiles: 1,
    budgetVerdict: 'watch',
    workBudgetVerdict: 'ok',
  });
  assert.equal(rec.result, 'pass');
  assert.equal(rec.budget_verdict, 'watch');
  assert.equal(rec.watch_files, 1);
});

// BL-1599: work_budget_verdict rides beside budget_verdict (BL-1598's
// per-file field), independent of it - a run can be a new-pole offender
// (per-file) while its summed work still reads ok, or vice versa.
test('buildRecord carries work_budget_verdict independently of budget_verdict', () => {
  const rec = buildRecord({
    finishedAt: '2026-07-03T10:00:00.000Z',
    testCount: 1,
    exitCode: 1,
    durationMs: 1000,
    poleMs: 9000,
    workMs: 620000,
    newOffenders: 0,
    watchFiles: 0,
    budgetVerdict: 'ok',
    workBudgetVerdict: 'over-budget',
  });
  assert.equal(rec.budget_verdict, 'ok');
  assert.equal(rec.work_budget_verdict, 'over-budget');
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

// BL-378: a real test failure always wins over the file-budget guard's own
// exit code, so the guard can never mask a genuine test failure.
test('computeFinalExitCode prefers a non-zero test exit code over the guard\'s', () => {
  assert.equal(computeFinalExitCode(1, 0), 1);
  assert.equal(computeFinalExitCode(2, 1), 2);
});

test('computeFinalExitCode falls back to the guard exit code when the tests passed', () => {
  assert.equal(computeFinalExitCode(0, 1), 1);
  assert.equal(computeFinalExitCode(0, 0), 0);
});

// BL-1599: the work ratchet's own exit code is a THIRD source, same
// precedence as the per-file guard - a real test failure always wins,
// then either budget-refusing source, never silently dropped when the
// caller omits it (defaults to 0, so every pre-BL-1599 2-arg call site
// keeps its exact prior behavior).
test('computeFinalExitCode falls back to the work ratchet exit code when tests and the per-file guard both passed', () => {
  assert.equal(computeFinalExitCode(0, 0, 1), 1);
  assert.equal(computeFinalExitCode(0, 0, 0), 0);
});

test('computeFinalExitCode prefers a non-zero test exit code over both the guard and the work ratchet', () => {
  assert.equal(computeFinalExitCode(2, 1, 1), 2);
});

test('computeFinalExitCode omitting the work ratchet argument behaves exactly as the 2-arg call did', () => {
  assert.equal(computeFinalExitCode(1, 0), 1);
  assert.equal(computeFinalExitCode(0, 1), 1);
  assert.equal(computeFinalExitCode(0, 0), 0);
});
