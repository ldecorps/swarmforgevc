const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  listTestFiles,
  listPipelineTestFiles,
  PIPELINE_TEST_TIMEOUT_MS,
  buildPipelineTestArgs,
  buildRecord,
  appendRecord,
  computeFinalExitCode,
  GROUP_TIMEOUT_EXIT,
  GROUP_SIGNALLED_EXIT,
  groupRunExitCode,
  groupRunFailure,
  RUN_IN_OWN_GROUP_FLAG,
} = require('../scripts/testDurationRecorderLib');
const { spawnSync } = require('node:child_process');

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

// BL-2041
test('listPipelineTestFiles finds .test.js files recursively and excludes fixtures/', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'a.test.js'), '');
  fs.mkdirSync(path.join(dir, 'steps'));
  fs.writeFileSync(path.join(dir, 'steps', 'b.test.js'), '');
  fs.mkdirSync(path.join(dir, 'fixtures'));
  fs.writeFileSync(path.join(dir, 'fixtures', 'c.test.js'), '');
  fs.writeFileSync(path.join(dir, 'helpers.js'), '');

  assert.deepEqual(listPipelineTestFiles(dir), [path.join(dir, 'a.test.js'), path.join(dir, 'steps', 'b.test.js')]);
});

// BL-2041 D1 (QA bounce): node:test's own default per-test timeout is
// Infinity - buildPipelineTestArgs must thread a real --test-timeout flag,
// not just sit beside one.
test('buildPipelineTestArgs passes --test-timeout before the file list, defaulting to PIPELINE_TEST_TIMEOUT_MS', () => {
  assert.deepEqual(buildPipelineTestArgs(['/a.test.js', '/b.test.js']), [
    '--test',
    `--test-timeout=${PIPELINE_TEST_TIMEOUT_MS}`,
    '/a.test.js',
    '/b.test.js',
  ]);
  assert.deepEqual(buildPipelineTestArgs(['/a.test.js'], 500), ['--test', '--test-timeout=500', '/a.test.js']);
});

// BL-2041 D1 (QA bounce): the behavioral proof QA asked for - a file that
// never resolves must fail WITHIN the bound, naming the file, rather than
// hanging the lane the way a regression in bl1358MutantTimeCeiling.test.js's
// own deliberately-hanging fixture would without this flag.
test('a never-resolving pipeline test file fails within the bound and names the file, instead of hanging', () => {
  const dir = mkTmp();
  fs.writeFileSync(
    path.join(dir, 'hangs.test.js'),
    "const { test } = require('node:test');\n" +
      "test('never resolves', () => new Promise(() => { setInterval(() => {}, 1000); }));\n"
  );
  const files = listPipelineTestFiles(dir);
  const SHORT_TIMEOUT_MS = 500;
  const started = Date.now();
  const result = spawnSync(process.execPath, buildPipelineTestArgs(files, SHORT_TIMEOUT_MS), {
    encoding: 'utf8',
    timeout: 15_000,
  });
  const elapsedMs = Date.now() - started;
  assert.notEqual(result.status, 0, `expected a non-zero exit for a hung test, got 0:\n${result.stdout}${result.stderr}`);
  assert.ok(
    elapsedMs < 10_000,
    `expected the run to fail within the ${SHORT_TIMEOUT_MS}ms bound, not hang; took ${elapsedMs}ms`
  );
  const out = `${result.stdout}${result.stderr}`;
  assert.ok(out.includes('hangs.test.js'), `expected the output to name the hung file, got:\n${out}`);
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
    loadAvg5: 1.5,
    cores: 8,
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
    load_avg_5m: 1.5,
    cores: 8,
  });
});

// BL-1983: every duration record carries the load and core count it was
// measured at.
test('buildRecord carries load_avg_5m and cores independently of every other field', () => {
  const rec = buildRecord({
    finishedAt: '2026-10-05T07:23:42.000Z',
    testCount: 1161,
    exitCode: 0,
    durationMs: 391647,
    poleMs: 4800,
    workMs: 613108,
    newOffenders: 0,
    watchFiles: 0,
    budgetVerdict: 'ok',
    workBudgetVerdict: 'over-budget',
    loadAvg5: 15,
    cores: 20,
  });
  assert.equal(rec.load_avg_5m, 15);
  assert.equal(rec.cores, 20);
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

// BL-1599 hardening: the guard and the work ratchet must have DIFFERING
// non-zero values here, or a mutant swapping their priority (work wins
// over guard) survives - every other guard/work pairing above uses equal
// values and cannot tell the two branches apart.
test('computeFinalExitCode prefers the per-file guard exit code over the work ratchet when both are non-zero', () => {
  assert.equal(computeFinalExitCode(0, 2, 3), 2);
});

test('computeFinalExitCode omitting the work ratchet argument behaves exactly as the 2-arg call did', () => {
  assert.equal(computeFinalExitCode(1, 0), 1);
  assert.equal(computeFinalExitCode(0, 1), 1);
  assert.equal(computeFinalExitCode(0, 0), 0);
});

// ── BL-1910: a command run in its own process group leaves nothing behind ──

test('groupRunExitCode: a timeout wins, whatever the leader did after it', () => {
  assert.equal(groupRunExitCode({ timedOut: true, code: 0, signal: null }), GROUP_TIMEOUT_EXIT);
  assert.equal(groupRunExitCode({ timedOut: true, code: null, signal: 'SIGTERM' }), GROUP_TIMEOUT_EXIT);
});

test('groupRunExitCode: an exit code passes through; a signal the runner did not send is its own code', () => {
  assert.equal(groupRunExitCode({ timedOut: false, code: 0, signal: null }), 0);
  assert.equal(groupRunExitCode({ timedOut: false, code: 3, signal: null }), 3);
  assert.equal(groupRunExitCode({ timedOut: false, code: null, signal: 'SIGKILL' }), GROUP_SIGNALLED_EXIT);
});

test('groupRunFailure names the timeout, a stray signal, or nothing for a run that finished', () => {
  assert.match(groupRunFailure({ status: GROUP_TIMEOUT_EXIT, signal: null }, 21000), /timed out after 21000ms/);
  assert.match(groupRunFailure({ status: GROUP_SIGNALLED_EXIT, signal: null }, 21000), /killed by a signal/);
  assert.match(groupRunFailure({ status: null, signal: 'SIGKILL' }, 21000), /runner killed by signal SIGKILL/);
  assert.equal(groupRunFailure({ status: 0, signal: null }, 21000), null);
  assert.equal(groupRunFailure({ status: 1, signal: null }, 21000), null);
});

// The runner itself, end to end: a leader that forks a grandchild and then
// outlives the timeout. Every process carries a marker in its environment,
// and none may be alive when the runner returns.
function aliveWithMarker(marker) {
  const found = [];
  for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      if (fs.readFileSync(`/proc/${pid}/environ`, 'utf8').includes(marker)) {
        const state = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').pop().split(' ')[0];
        if (state !== 'Z') found.push(Number(pid));
      }
    } catch {
      /* gone, or not ours to read */
    }
  }
  return found;
}

const LIB = path.join(__dirname, '..', 'scripts', 'testDurationRecorderLib.js');
const linuxOnly = fs.existsSync('/proc/self/environ') ? test : test.skip;

linuxOnly('the runner kills the whole group on timeout and exits GROUP_TIMEOUT_EXIT, leaving no marked process', () => {
  const marker = `BL1910_UNIT_${process.pid}_${Date.now()}`;
  const leader = `require('child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'ignore' }); setTimeout(()=>{}, 60000);`;
  const res = spawnSync(process.execPath, [LIB, RUN_IN_OWN_GROUP_FLAG, '300', '200', process.execPath, '-e', leader], {
    encoding: 'utf8',
    env: { ...process.env, BL1910_MARKER: marker },
    timeout: 30000,
  });
  assert.equal(res.status, GROUP_TIMEOUT_EXIT, `${res.stdout}${res.stderr}`);
  assert.deepEqual(aliveWithMarker(marker), []);
});

linuxOnly('the runner passes a finished command\'s exit code through and leaves no marked process', () => {
  const marker = `BL1910_UNIT_${process.pid}_${Date.now()}_ok`;
  // The leader exits at once; the grandchild it forked would linger.
  const leader = `require('child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'ignore' }); process.exit(3);`;
  const res = spawnSync(process.execPath, [LIB, RUN_IN_OWN_GROUP_FLAG, '20000', '200', process.execPath, '-e', leader], {
    encoding: 'utf8',
    env: { ...process.env, BL1910_MARKER: marker },
    timeout: 30000,
  });
  assert.equal(res.status, 3, `${res.stdout}${res.stderr}`);
  assert.deepEqual(aliveWithMarker(marker), []);
});
