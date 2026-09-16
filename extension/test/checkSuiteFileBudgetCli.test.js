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
  NEW_POLE_REFUSAL_FRACTION,
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

// BL-378 no-single-file-bounds-the-suite-01, amended 2026-09-16: an
// unregistered file refuses only at or above 1.5x budget (a bare breach
// alone is watch - see the test below).
test('a file at or above 1.5x the budget fails the guard as a new pole', () => {
  const result = checkFileDurationBudget([{ file: 'test/slow.test.js', durationMs: 15000 }], 7000);
  assert.equal(result.passed, false);
  assert.equal(result.verdict, 'new-pole');
  assert.deepEqual(result.offenders, [{ file: 'test/slow.test.js', durationMs: 15000, budgetMs: 7000 }]);
});

// BL-1598 amendment (2026-09-16): a bare breach of the budget (over budget,
// but under 1.5x) is reported as watch, never refused - a snapshot gate
// that refuses on ordinary host-load jitter is red on day one.
test('a file over budget but under 1.5x is watch, not refused', () => {
  const result = checkFileDurationBudget([{ file: 'test/slow.test.js', durationMs: 8000 }], 7000);
  assert.equal(result.passed, true);
  assert.equal(result.verdict, 'watch');
  assert.equal(result.offenders.length, 0);
  assert.deepEqual(result.watchFiles, [{ file: 'test/slow.test.js', durationMs: 8000, budgetMs: 7000, kind: 'watch' }]);
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

// BL-378 no-single-file-bounds-the-suite-03, amended 2026-09-16: every
// new-pole offender (at or above 1.5x budget) is named, not just the
// first, and a lesser breach (over budget, under 1.5x) sorts into
// watchFiles instead of offenders.
test('every new-pole offender is named, not just the first, and a lesser breach is watch', () => {
  const result = checkFileDurationBudget(
    [
      { file: 'test/a.test.js', durationMs: 10 },
      { file: 'test/watch1.test.js', durationMs: 9000 },
      { file: 'test/slow2.test.js', durationMs: 12000 },
      { file: 'test/slow3.test.js', durationMs: 20000 },
    ],
    7000
  );
  assert.equal(result.passed, false);
  assert.deepEqual(result.offenders.map((o) => o.file), ['test/slow2.test.js', 'test/slow3.test.js']);
  assert.deepEqual(result.watchFiles.map((w) => w.file), ['test/watch1.test.js']);
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

test('main() fails and names the offender when a file is at or above 1.5x the budget', async () => {
  const root = mkTmp();
  const reportPath = writeReport(root, [
    { name: 'test/slow.test.js', startTime: 0, endTime: Math.ceil(PER_FILE_DURATION_BUDGET_MS * NEW_POLE_REFUSAL_FRACTION) },
  ]);

  const result = await runCli([reportPath]);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /test\/slow\.test\.js/);
  assert.match(result.stderr, /budget/);
});

test('main() passes but reports watch when a file is over budget but under 1.5x', async () => {
  const root = mkTmp();
  const reportPath = writeReport(root, [{ name: 'test/slow.test.js', startTime: 0, endTime: PER_FILE_DURATION_BUDGET_MS + 1000 }]);

  const result = await runCli([reportPath]);

  assert.equal(result.exitCode, undefined);
  assert.match(result.stdout, /watch/);
  assert.match(result.stdout, /test\/slow\.test\.js/);
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

test('the compiled CLI exits non-zero as a subprocess when a file is at or above 1.5x the budget', () => {
  const root = mkTmp();
  const reportPath = writeReport(root, [
    { name: 'test/slow.test.js', startTime: 0, endTime: Math.ceil(PER_FILE_DURATION_BUDGET_MS * NEW_POLE_REFUSAL_FRACTION) },
  ]);

  assert.throws(() => execFileSync('node', [CLI, reportPath], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] }));
});
