const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  main,
  classifySuiteDuration,
  buildSuiteBudgetVerdict,
  formatSuiteBudgetVerdict,
  SUITE_DURATION_BUDGET_MS,
  classifySuiteWork,
  deriveExpectedWallMs,
  buildSuiteWorkVerdict,
  formatSuiteWorkVerdict,
  SUITE_WORK_BUDGET_MS,
  SUITE_WORK_TOLERANCE,
  OPERATOR_WALL_CEILING_MS,
  isUnderHostLoad,
  decideSuiteWorkExit,
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

// ── classifySuiteWork / deriveExpectedWallMs / buildSuiteWorkVerdict (pure)
// ── BL-1599 unit-suite-work-ratchet-01's whole decision table ──────────────

test('BL-1599: the committed budget is the delegated number, the wall budget stays unchanged', () => {
  assert.equal(SUITE_WORK_BUDGET_MS, 550000);
  assert.equal(SUITE_DURATION_BUDGET_MS, 10000);
});

const WORK_RATCHET_TABLE = [
  { work: 540000, forks: 9, pole: 69900, verdict: 'ok', exitNonZero: false, wall: 69900, distance: 56900 },
  { work: 90000, forks: 9, pole: 5000, verdict: 'ok', exitNonZero: false, wall: 10000, distance: 0 },
  { work: 590000, forks: 10, pole: 5000, verdict: 'over-tolerance', exitNonZero: false, wall: 59000, distance: 46000 },
  { work: 620000, forks: 1, pole: 69900, verdict: 'over-budget', exitNonZero: true, wall: 620000, distance: 607000 },
];

for (const { work, forks, pole, verdict, exitNonZero, wall, distance } of WORK_RATCHET_TABLE) {
  test(`classifySuiteWork/deriveExpectedWallMs: work=${work} forks=${forks} pole=${pole} -> ${verdict}`, () => {
    assert.equal(classifySuiteWork(work, SUITE_WORK_BUDGET_MS, SUITE_WORK_TOLERANCE), verdict);
    assert.equal(deriveExpectedWallMs(work, forks, pole), wall);
  });

  test(`buildSuiteWorkVerdict: work=${work} forks=${forks} pole=${pole} carries the verdict, wall and distance, exit non-zero=${exitNonZero}`, () => {
    const result = buildSuiteWorkVerdict(work, forks, pole);
    assert.equal(result.verdict, verdict);
    assert.equal(result.expectedWallMs, wall);
    assert.equal(result.distanceMs, distance);
    assert.equal(result.verdict === 'over-budget', exitNonZero);
  });
}

test('classifySuiteWork: the boundary (exactly the budget) is ok, not over-tolerance', () => {
  assert.equal(classifySuiteWork(550000, 550000, 0.1), 'ok');
});

test('classifySuiteWork: exactly the tolerance ceiling (budget * 1.1) is over-tolerance, not over-budget', () => {
  assert.equal(classifySuiteWork(605000, 550000, 0.1), 'over-tolerance');
});

test('deriveExpectedWallMs: an invalid fork count (0, negative, NaN) falls back to 1 fork rather than dividing by zero', () => {
  assert.equal(deriveExpectedWallMs(90000, 0, 5000), 90000);
  assert.equal(deriveExpectedWallMs(90000, -1, 5000), 90000);
  assert.equal(deriveExpectedWallMs(90000, NaN, 5000), 90000);
});

test('formatSuiteWorkVerdict prints work, forks, slowest file, derived wall and the distance to the operator ceiling', () => {
  const text = formatSuiteWorkVerdict(buildSuiteWorkVerdict(620000, 1, 69900));
  assert.equal(OPERATOR_WALL_CEILING_MS, 13000);
  assert.match(text, /620\.0s/);
  assert.match(text, /1 fork/);
  assert.match(text, /69\.9s/);
  assert.match(text, /620\.0s/);
  assert.match(text, /607\.0s/);
});

test('formatSuiteWorkVerdict reports ok without refusal language', () => {
  const text = formatSuiteWorkVerdict(buildSuiteWorkVerdict(540000, 9, 69900));
  assert.doesNotMatch(text, /refus/i);
});

test('formatSuiteWorkVerdict names an over-budget run as refused', () => {
  const text = formatSuiteWorkVerdict(buildSuiteWorkVerdict(620000, 1, 69900));
  assert.match(text, /refus/i);
});

// BL-1599 hardening: exact full-string pins, singular fork, ok verdict.
// workS/wallS are equal here by construction (forks=1) - the plural
// fixture below gives them DISTINCT values so an arithmetic mutant on
// either cannot hide behind the other's matching substring, the same
// collision that let workS's `/1000`->`*1000` mutant survive against
// the loose /620\.0s/ regex above (wallS happened to render the same
// text). An exact assert.equal pins every field, including the label
// ('ok', not forced true/false or emptied) and the singular "1 fork".
test('formatSuiteWorkVerdict: exact text for an ok verdict, one fork (singular)', () => {
  const text = formatSuiteWorkVerdict(buildSuiteWorkVerdict(100000, 1, 40000, 550000, 0.1));
  assert.equal(
    text,
    'suite work ok: 100.0s work (budget 550.0s, 1 fork, slowest file 40.0s) -> expected wall 100.0s, 87.0s from the 13.0s operator ceiling'
  );
});

// Plural forks, and work/wall/pole/distance all distinct decimal strings
// so each field's arithmetic mutant (/1000 -> *1000) breaks the exact
// match on its own, unmasked by a sibling field's coincidentally-matching
// substring.
test('formatSuiteWorkVerdict: exact text for an ok verdict, seven forks (plural)', () => {
  const text = formatSuiteWorkVerdict(buildSuiteWorkVerdict(300000, 7, 25000, 550000, 0.1));
  assert.equal(
    text,
    'suite work ok: 300.0s work (budget 550.0s, 7 forks, slowest file 25.0s) -> expected wall 42.9s, 29.9s from the 13.0s operator ceiling'
  );
});

// Exercises the over-tolerance branch at all (BL-1599's NoCoverage
// survivor: no prior test ever produced this verdict, so the 'over
// tolerance' string literal itself had zero coverage) and pins the
// label text exactly, discriminating it from both 'ok' and 'REFUSED'.
test('formatSuiteWorkVerdict: exact text for an over-tolerance verdict', () => {
  const text = formatSuiteWorkVerdict(buildSuiteWorkVerdict(590000, 10, 5000, 550000, 0.1));
  assert.equal(
    text,
    'suite work over tolerance: 590.0s work (budget 550.0s, 10 forks, slowest file 5.0s) -> expected wall 59.0s, 46.0s from the 13.0s operator ceiling'
  );
});

// ── isUnderHostLoad / decideSuiteWorkExit (pure) — BL-1983 ──────────────────

test('isUnderHostLoad: the threshold is half the logical cores, at or above counts as loaded', () => {
  assert.equal(isUnderHostLoad(10, 20), true);
  assert.equal(isUnderHostLoad(9.9, 20), false);
  assert.equal(isUnderHostLoad(15, 20), true);
});

test('isUnderHostLoad: zero cores never reads as loaded (no divide-by-zero true)', () => {
  assert.equal(isUnderHostLoad(5, 0), false);
});

// Pins the ticket's own Scenario Outline table (the-ratchet-exit-depends-
// on-the-load-01) via classifySuiteWork's real verdict, not a restated one.
for (const [work, load, exit, marks] of [
  [613108, 15, 0, true],
  [613108, 10, 0, true],
  [613108, 9.9, 1, false],
  [540000, 2, 0, false],
]) {
  test(`decideSuiteWorkExit: work=${work} load=${load} on a 20-core host -> exit ${exit}, marks=${marks}`, () => {
    const verdict = classifySuiteWork(work);
    const decision = decideSuiteWorkExit(verdict, load, 20);
    assert.equal(decision.exitCode, exit);
    assert.equal(decision.unmeasuredUnderLoad, marks);
  });
}

test('decideSuiteWorkExit: a run below the load threshold gets exactly BL-1599\'s verdict and exit code (the declared invariant)', () => {
  // over-budget, under-tolerance, and ok all stand unchanged under a quiet host.
  assert.deepEqual(decideSuiteWorkExit('over-budget', 1, 20), { exitCode: 1, unmeasuredUnderLoad: false });
  assert.deepEqual(decideSuiteWorkExit('over-tolerance', 1, 20), { exitCode: 0, unmeasuredUnderLoad: false });
  assert.deepEqual(decideSuiteWorkExit('ok', 1, 20), { exitCode: 0, unmeasuredUnderLoad: false });
});

test('decideSuiteWorkExit: ok and over-tolerance are never marked, even at high load', () => {
  assert.deepEqual(decideSuiteWorkExit('ok', 20, 20), { exitCode: 0, unmeasuredUnderLoad: false });
  assert.deepEqual(decideSuiteWorkExit('over-tolerance', 20, 20), { exitCode: 0, unmeasuredUnderLoad: false });
});

test('formatSuiteWorkVerdict: an over-budget run under host load is marked, not REFUSED, and exits 0', () => {
  const text = formatSuiteWorkVerdict(buildSuiteWorkVerdict(613108, 1, 69900), 15, 20);
  assert.match(text, /^suite work unmeasured under host load:/);
  assert.doesNotMatch(text, /REFUSED/);
  assert.match(text, /5m load 15\.0 >= half of 20 cores/);
});

test('formatSuiteWorkVerdict: the same over-budget run below the load threshold still reads REFUSED', () => {
  const text = formatSuiteWorkVerdict(buildSuiteWorkVerdict(613108, 1, 69900), 9.9, 20);
  assert.match(text, /^suite work REFUSED:/);
  assert.doesNotMatch(text, /unmeasured under host load/);
});

test('formatSuiteWorkVerdict: omitting load/cores prints exactly as before BL-1983 (every pre-existing call site)', () => {
  const withLoad = formatSuiteWorkVerdict(buildSuiteWorkVerdict(300000, 7, 25000), 1, 20);
  const withoutLoad = formatSuiteWorkVerdict(buildSuiteWorkVerdict(300000, 7, 25000));
  assert.equal(withLoad, withoutLoad);
  assert.doesNotMatch(withoutLoad, /unmeasured under host load/);
});

// BL-1983 hardening: loadAvg5 and cores are two INDEPENDENTLY optional
// parameters in the type signature, but every real caller passes both or
// neither (they come from the same os.loadavg()/os.cpus() read). `undefined`
// cannot discriminate a dropped `typeof X === 'number'` guard here:
// isUnderHostLoad's own `cores > 0` check already reads false for an
// undefined cores/loadAvg5, so the guard and its removal agree on that
// input - the guard's actual job is rejecting a value that is NOT a number
// but WOULD coerce truthily through `>=`, e.g. the numeric string "15"
// (`"15" >= 10` is `true` by JS's numeric coercion). Pin that shape: a
// non-number-typed but arithmetically-passing load/cores value must never
// mark, exactly like a clean `undefined`. (Closes 4 Stryker survivors at
// check-suite-duration-budget.js:140.)
test('formatSuiteWorkVerdict: a numeric-STRING loadAvg5 never marks, even though it would coerce past the threshold', () => {
  const v = buildSuiteWorkVerdict(613108, 1, 69900);
  assert.equal(isUnderHostLoad('15', 20), true, 'sanity: a numeric string DOES coerce truthily through isUnderHostLoad');
  const text = formatSuiteWorkVerdict(v, '15', 20);
  assert.equal(text, formatSuiteWorkVerdict(v));
  assert.match(text, /^suite work REFUSED:/);
  assert.doesNotMatch(text, /unmeasured under host load/);
});

test('formatSuiteWorkVerdict: a numeric-STRING cores never marks, even though it would coerce past the threshold', () => {
  const v = buildSuiteWorkVerdict(613108, 1, 69900);
  assert.equal(isUnderHostLoad(15, '20'), true, 'sanity: a numeric string DOES coerce truthily through isUnderHostLoad');
  const text = formatSuiteWorkVerdict(v, 15, '20');
  assert.equal(text, formatSuiteWorkVerdict(v));
  assert.match(text, /^suite work REFUSED:/);
  assert.doesNotMatch(text, /unmeasured under host load/);
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
