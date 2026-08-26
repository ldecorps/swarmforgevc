const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  main,
  classifySuiteDuration,
  buildSuiteBudgetVerdict,
  formatSuiteBudgetVerdict,
  SUITE_DURATION_BUDGET_MS,
} = require('../out/tools/check-suite-duration-budget');

const CLI = path.join(__dirname, '..', 'out', 'tools', 'check-suite-duration-budget.js');

// ── classifySuiteDuration (pure) — BL-445 unit-suite-below-10s-01's decision table ──

test('a run well under the budget is within-budget', () => {
  assert.equal(classifySuiteDuration(6000, 10000), 'within-budget');
});

test('a run just under the budget is within-budget', () => {
  assert.equal(classifySuiteDuration(9999, 10000), 'within-budget');
});

// The boundary belongs to "over budget": a run landing exactly on the target
// is not the guarantee the target is meant to give.
test('a run exactly at the budget is over-budget, not within', () => {
  assert.equal(classifySuiteDuration(10000, 10000), 'over-budget');
});

test('a run well over the budget is over-budget', () => {
  assert.equal(classifySuiteDuration(12963, 10000), 'over-budget');
});

test('classifySuiteDuration defaults to the 10-second operator target when no budget is given', () => {
  assert.equal(SUITE_DURATION_BUDGET_MS, 10000);
  assert.equal(classifySuiteDuration(9999), 'within-budget');
  assert.equal(classifySuiteDuration(10000), 'over-budget');
});

// ── buildSuiteBudgetVerdict (pure) ──────────────────────────────────────────

test('buildSuiteBudgetVerdict carries the measured duration and budget alongside the verdict', () => {
  const result = buildSuiteBudgetVerdict(12963, 10000);
  assert.deepEqual(result, { verdict: 'over-budget', durationMs: 12963, budgetMs: 10000 });
});

test('buildSuiteBudgetVerdict reports within-budget for a fast run', () => {
  const result = buildSuiteBudgetVerdict(6000, 10000);
  assert.deepEqual(result, { verdict: 'within-budget', durationMs: 6000, budgetMs: 10000 });
});

// ── formatSuiteBudgetVerdict (pure) — BL-445 unit-suite-below-10s-02 ────────

test('formatSuiteBudgetVerdict surfaces an over-budget run as an offender with its measured duration', () => {
  const text = formatSuiteBudgetVerdict(buildSuiteBudgetVerdict(12963, 10000));
  assert.match(text, /over budget/);
  assert.match(text, /13\.0s/);
  assert.match(text, /10\.0s/);
});

test('formatSuiteBudgetVerdict reports a within-budget run as OK, not an offender', () => {
  const text = formatSuiteBudgetVerdict(buildSuiteBudgetVerdict(6000, 10000));
  assert.match(text, /OK/);
  assert.doesNotMatch(text, /over budget/);
});

// ── main() (thin CLI wrapper, in-process) ───────────────────────────────────

// Runs the REAL main() in-process so in-process coverage/mutation can see
// its branches (the engineering article's CLI main()-thin-wrapper rule);
// mirrors check-suite-file-budget.ts's own checkSuiteFileBudgetCli.test.js.
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

test('main() surfaces an over-budget run but never fails the process (surface, not hard-fail)', async () => {
  const result = await runCli(['12963']);

  assert.equal(result.exitCode, undefined);
  assert.match(result.stdout, /over budget/);
  assert.match(result.stdout, /13\.0s/);
});

test('main() reports a within-budget run as OK', async () => {
  const result = await runCli(['6000']);

  assert.equal(result.exitCode, undefined);
  assert.match(result.stdout, /OK/);
});

test('main() with no duration argument prints usage and fails, never a crash', async () => {
  const result = await runCli([]);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Usage: node check-suite-duration-budget\.js/);
});

test('main() with a non-numeric duration argument prints usage and fails, never a crash', async () => {
  const result = await runCli(['not-a-number']);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Usage: node check-suite-duration-budget\.js/);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and surfaces an over-budget run', () => {
  const output = execFileSync('node', [CLI, '12963'], { encoding: 'utf8' });

  assert.match(output, /over budget/);
});

test('the compiled CLI exits zero as a subprocess even when over budget (surface, not hard-fail)', () => {
  // Must not throw: execFileSync throws only on a non-zero exit code.
  execFileSync('node', [CLI, '12963'], { encoding: 'utf8' });
});
