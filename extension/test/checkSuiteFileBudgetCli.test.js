const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  main,
  extractFileDurations,
  checkFileDurationBudget,
  formatBudgetOffenders,
  PER_FILE_DURATION_BUDGET_MS,
} = require('../out/tools/check-suite-file-budget');

const CLI = path.join(__dirname, '..', 'out', 'tools', 'check-suite-file-budget.js');

function mkTmp() {
  return mkTmpDir('sfvc-suite-file-budget-');
}

function writeReport(root, testResults) {
  const reportPath = path.join(root, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ testResults }));
  return reportPath;
}

// ── extractFileDurations (pure) ──────────────────────────────────────────

test('extractFileDurations computes each file\'s duration from its own start/end time', () => {
  const durations = extractFileDurations({
    testResults: [
      { name: 'test/a.test.js', startTime: 1000, endTime: 1500 },
      { name: 'test/b.test.js', startTime: 2000, endTime: 2050 },
    ],
  });
  assert.deepEqual(durations, [
    { file: 'test/a.test.js', durationMs: 500 },
    { file: 'test/b.test.js', durationMs: 50 },
  ]);
});

test('extractFileDurations returns an empty array for a report with no test files', () => {
  assert.deepEqual(extractFileDurations({ testResults: [] }), []);
});

// ── checkFileDurationBudget (pure) — BL-378's own 3-way decision table ──

// BL-378 no-single-file-bounds-the-suite-01
test('a file over the budget fails the guard', () => {
  const result = checkFileDurationBudget([{ file: 'test/slow.test.js', durationMs: 8000 }], 7000);
  assert.equal(result.passed, false);
  assert.deepEqual(result.offenders, [{ file: 'test/slow.test.js', durationMs: 8000, budgetMs: 7000 }]);
});

// BL-378 no-single-file-bounds-the-suite-02
test('every file within budget passes', () => {
  const result = checkFileDurationBudget(
    [
      { file: 'test/a.test.js', durationMs: 10 },
      { file: 'test/b.test.js', durationMs: 6999 },
    ],
    7000
  );
  assert.equal(result.passed, true);
  assert.deepEqual(result.offenders, []);
});

// A file whose duration lands EXACTLY on the budget is not itself over it
// (the boundary belongs to "within budget", not "exceeds").
test('a file exactly at the budget passes, not fails', () => {
  const result = checkFileDurationBudget([{ file: 'test/exact.test.js', durationMs: 7000 }], 7000);
  assert.equal(result.passed, true);
});

// BL-378 no-single-file-bounds-the-suite-03
test('every offender is named, not just the first', () => {
  const result = checkFileDurationBudget(
    [
      { file: 'test/a.test.js', durationMs: 10 },
      { file: 'test/slow1.test.js', durationMs: 9000 },
      { file: 'test/slow2.test.js', durationMs: 12000 },
    ],
    7000
  );
  assert.equal(result.passed, false);
  assert.deepEqual(result.offenders.map((o) => o.file), ['test/slow1.test.js', 'test/slow2.test.js']);
});

// ── formatBudgetOffenders (pure) ──────────────────────────────────────────

test('formatBudgetOffenders names the offending file, its duration, and the budget it broke', () => {
  const text = formatBudgetOffenders([{ file: 'test/slow.test.js', durationMs: 8200, budgetMs: 7000 }]);
  assert.match(text, /test\/slow\.test\.js/);
  assert.match(text, /8\.2s/);
  assert.match(text, /7\.0s/);
});

test('formatBudgetOffenders lists every offender on its own line', () => {
  const text = formatBudgetOffenders([
    { file: 'test/slow1.test.js', durationMs: 9000, budgetMs: 7000 },
    { file: 'test/slow2.test.js', durationMs: 12000, budgetMs: 7000 },
  ]);
  const lines = text.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /slow1/);
  assert.match(lines[1], /slow2/);
});

// ── main() (thin CLI wrapper, in-process) — BL-378 no-single-file-bounds-the-suite-04 ──

// Runs the REAL main() in-process against a real fixture report path, so
// in-process coverage and mutation tooling can see the branches a
// subprocess-only smoke test cannot (the engineering article's CLI
// main()-thin-wrapper rule; mirrors queueStatusCli.test.js's own seam).
// main() reads process.argv/writes via console.log/process.stderr.write,
// so all three are stubbed and restored in finally.
async function runCli(args) {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const originalLog = console.log;
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const stdout = [];
  const stderr = [];
  console.log = (chunk) => {
    stdout.push(chunk);
  };
  process.stderr.write = (chunk) => {
    stderr.push(chunk);
    return true;
  };
  process.exitCode = undefined;
  try {
    process.argv = ['node', CLI, ...args];
    await main();
    return { stdout: stdout.join('\n'), stderr: stderr.join(''), exitCode: process.exitCode };
  } finally {
    console.log = originalLog;
    process.stderr.write = originalStderrWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
}

test('main() passes and reports the file count when every file is within budget', async () => {
  const root = mkTmp();
  const reportPath = writeReport(root, [{ name: 'test/a.test.js', startTime: 0, endTime: 10 }]);

  const result = await runCli([reportPath]);

  assert.equal(result.exitCode, undefined);
  assert.match(result.stdout, /suite file budget OK: 1 files/);
});

test('main() fails and names the offender when a file exceeds the budget', async () => {
  const root = mkTmp();
  const reportPath = writeReport(root, [{ name: 'test/slow.test.js', startTime: 0, endTime: PER_FILE_DURATION_BUDGET_MS + 1000 }]);

  const result = await runCli([reportPath]);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /test\/slow\.test\.js/);
  assert.match(result.stderr, /budget/);
});

test('main() with no report path argument prints usage and fails, never a crash', async () => {
  const result = await runCli([]);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Usage: node check-suite-file-budget\.js/);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const root = mkTmp();
  const reportPath = writeReport(root, [{ name: 'test/a.test.js', startTime: 0, endTime: 10 }]);

  const output = execFileSync('node', [CLI, reportPath], { encoding: 'utf8' });

  assert.match(output, /suite file budget OK: 1 files/);
});

test('the compiled CLI exits non-zero as a subprocess when a file exceeds the budget', () => {
  const root = mkTmp();
  const reportPath = writeReport(root, [{ name: 'test/slow.test.js', startTime: 0, endTime: PER_FILE_DURATION_BUDGET_MS + 1000 }]);

  assert.throws(() => execFileSync('node', [CLI, reportPath], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] }));
});
