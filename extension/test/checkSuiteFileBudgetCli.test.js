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
  parseRegisterRows,
  openTicketIds,
  runGuardAgainstReport,
  formatGuardReport,
  printGuardReport,
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

// ── BL-1598 hardener pass: unit-lane coverage of the register/verdict logic.
// The register, verdict-computation, and report-formatting functions were
// already exercised by the acceptance suite (node's own test runner,
// specs/pipeline) and the property test (its own separate lane) - but
// Stryker's mutation run measures ONLY this vitest unit lane, so neither of
// those counted as coverage against it. A scoped stryker run against just
// this file (extension/vitest.bl1598.stryker.config.mjs) found 42 survived
// + 83 no-coverage mutants on exactly this logic before these tests were
// added.

// ── parseRegisterRows ────────────────────────────────────────────────────

test('parseRegisterRows returns an empty array for empty/falsy text', () => {
  assert.deepEqual(parseRegisterRows(''), []);
});

test('parseRegisterRows skips comment and blank lines', () => {
  const text = '# a comment\n\nfile.test.js\tBL-1\t2026-01-01\t9000\tnote\n   \n# another\n';
  const rows = parseRegisterRows(text);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { file: 'file.test.js', ticket: 'BL-1', firstSeen: '2026-01-01', measuredMs: 9000, note: 'note' });
});

test('parseRegisterRows joins a note containing tabs back together', () => {
  const rows = parseRegisterRows('f.test.js\tBL-1\t2026-01-01\t9000\tpart one\tpart two\n');
  assert.equal(rows[0].note, 'part one\tpart two');
});

test('parseRegisterRows parses multiple rows in file order', () => {
  const rows = parseRegisterRows('a.test.js\tBL-1\t2026-01-01\t1000\tn1\nb.test.js\tBL-2\t2026-01-02\t2000\tn2\n');
  assert.deepEqual(
    rows.map((r) => r.file),
    ['a.test.js', 'b.test.js']
  );
});

// ── openTicketIds ────────────────────────────────────────────────────────

test('openTicketIds names every BL-#### id under paused/ and active/, uppercased', () => {
  const root = mkTmp();
  fs.mkdirSync(path.join(root, 'paused'), { recursive: true });
  fs.mkdirSync(path.join(root, 'active'), { recursive: true });
  fs.writeFileSync(path.join(root, 'paused', 'bl-1-lowercase.yaml'), '');
  fs.writeFileSync(path.join(root, 'active', 'BL-2-uppercase.yaml'), '');

  const ids = openTicketIds(root);

  assert.deepEqual([...ids].sort(), ['BL-1', 'BL-2']);
});

test('openTicketIds ignores non-.yaml files and a missing subdirectory', () => {
  const root = mkTmp();
  fs.mkdirSync(path.join(root, 'active'), { recursive: true });
  fs.writeFileSync(path.join(root, 'active', 'BL-3.yaml'), '');
  fs.writeFileSync(path.join(root, 'active', 'BL-4.md'), '');
  // no paused/ directory at all

  const ids = openTicketIds(root);

  assert.deepEqual([...ids], ['BL-3']);
});

test('openTicketIds never names a done/ entry (not one of the two scanned subdirs)', () => {
  const root = mkTmp();
  fs.mkdirSync(path.join(root, 'done'), { recursive: true });
  fs.writeFileSync(path.join(root, 'done', 'BL-5.yaml'), '');

  const ids = openTicketIds(root);

  assert.equal(ids.size, 0);
});

test('openTicketIds requires the BL-#### id at the START of the filename, not merely present anywhere in it', () => {
  const root = mkTmp();
  fs.mkdirSync(path.join(root, 'active'), { recursive: true });
  // "BL-5" appears in the name but not at position 0 - must not be picked up.
  fs.writeFileSync(path.join(root, 'active', 'other-BL-5.yaml'), '');

  const ids = openTicketIds(root);

  assert.equal(ids.size, 0);
});

test('openTicketIds captures the FULL digit run of a multi-digit ticket number, not just its first digit', () => {
  const root = mkTmp();
  fs.mkdirSync(path.join(root, 'active'), { recursive: true });
  fs.writeFileSync(path.join(root, 'active', 'BL-1234-some-title.yaml'), '');

  const ids = openTicketIds(root);

  assert.deepEqual([...ids], ['BL-1234']);
});

test('openTicketIds silently skips a .yaml filename that does not match the BL-#### shape at all, never throwing', () => {
  const root = mkTmp();
  fs.mkdirSync(path.join(root, 'active'), { recursive: true });
  fs.writeFileSync(path.join(root, 'active', 'not-a-ticket-id.yaml'), '');
  fs.writeFileSync(path.join(root, 'active', 'BL-6.yaml'), '');

  const ids = openTicketIds(root);

  assert.deepEqual([...ids], ['BL-6']);
});

// ── checkFileDurationBudget: the register/openTickets decision table ─────

const OPEN = new Set(['BL-1']);

test('a registered pole (open ticket, over budget) is NOT an offender and reports as ok, not stale/unowned', () => {
  const durations = [{ file: 'f.test.js', durationMs: 9000 }];
  const register = [{ file: 'f.test.js', ticket: 'BL-1', firstSeen: '2026-01-01', measuredMs: 9000, note: '' }];

  const result = checkFileDurationBudget(durations, 7000, register, OPEN);

  assert.equal(result.passed, true);
  assert.equal(result.verdict, 'ok');
  assert.equal(result.offenders.length, 0);
  assert.equal(result.staleRows.length, 0);
  assert.equal(result.unownedRows.length, 0);
  assert.deepEqual(result.registeredPoles, [{ file: 'f.test.js', durationMs: 9000, budgetMs: 7000, kind: 'ok', ticket: 'BL-1' }]);
});

test('a row whose file now measures under 80% of budget is a stale-row, reported not refused', () => {
  const durations = [{ file: 'f.test.js', durationMs: 5000 }]; // 5000 < 0.8*7000=5600
  const register = [{ file: 'f.test.js', ticket: 'BL-1', firstSeen: '2026-01-01', measuredMs: 9000, note: '' }];

  const result = checkFileDurationBudget(durations, 7000, register, OPEN);

  // Amended 2026-09-16: a stale row is reported, never refused.
  assert.equal(result.passed, true);
  assert.equal(result.verdict, 'stale-row');
  assert.deepEqual(result.staleRows, [{ file: 'f.test.js', durationMs: 5000, budgetMs: 7000, kind: 'stale-row', ticket: 'BL-1' }]);
  assert.equal(result.registeredPoles.length, 0);
});

test('a row exactly AT the stale boundary (80% of budget) is not stale (boundary belongs to kept)', () => {
  const durations = [{ file: 'f.test.js', durationMs: 5600 }]; // exactly 0.8*7000
  const register = [{ file: 'f.test.js', ticket: 'BL-1', firstSeen: '2026-01-01', measuredMs: 9000, note: '' }];

  const result = checkFileDurationBudget(durations, 7000, register, OPEN);

  assert.equal(result.staleRows.length, 0);
  // Also not a registered pole (5600 is not > 7000) and not an offender
  // (it has a row) - this is the silent "kept, unreported" middle band.
  assert.equal(result.registeredPoles.length, 0);
  assert.equal(result.offenders.length, 0);
  assert.equal(result.passed, true);
});

test('a row exactly AT the budget (not strictly over it) is not a registered pole either - the middle band is exclusive on both ends', () => {
  const durations = [{ file: 'f.test.js', durationMs: 7000 }]; // exactly budgetMs, not > budgetMs
  const register = [{ file: 'f.test.js', ticket: 'BL-1', firstSeen: '2026-01-01', measuredMs: 9000, note: '' }];

  const result = checkFileDurationBudget(durations, 7000, register, OPEN);

  assert.equal(result.registeredPoles.length, 0);
  assert.equal(result.staleRows.length, 0);
  assert.equal(result.passed, true);
});

test('a row naming a ticket that is not open is an unowned-row refusal, even when the file is currently over budget', () => {
  const durations = [{ file: 'f.test.js', durationMs: 9000 }];
  const register = [{ file: 'f.test.js', ticket: 'BL-999', firstSeen: '2026-01-01', measuredMs: 9000, note: '' }];

  const result = checkFileDurationBudget(durations, 7000, register, OPEN);

  assert.equal(result.passed, false);
  assert.equal(result.verdict, 'unowned-row');
  assert.deepEqual(result.unownedRows, [{ file: 'f.test.js', durationMs: 9000, budgetMs: 7000, kind: 'unowned-row', ticket: 'BL-999' }]);
});

test('an unowned row whose file did not run this time falls back to the row\'s own measuredMs', () => {
  const durations = []; // file absent from this run's report
  const register = [{ file: 'f.test.js', ticket: 'BL-999', firstSeen: '2026-01-01', measuredMs: 8123, note: '' }];

  const result = checkFileDurationBudget(durations, 7000, register, OPEN);

  assert.equal(result.unownedRows[0].durationMs, 8123);
});

test('a registered (open, owned) row whose file did not run this time is silently skipped, not stale/pole/offender', () => {
  const durations = [];
  const register = [{ file: 'f.test.js', ticket: 'BL-1', firstSeen: '2026-01-01', measuredMs: 9000, note: '' }];

  const result = checkFileDurationBudget(durations, 7000, register, OPEN);

  assert.equal(result.staleRows.length, 0);
  assert.equal(result.registeredPoles.length, 0);
  assert.equal(result.passed, true);
  assert.equal(result.verdict, 'ok');
});

test('verdict priority: new-pole beats unowned-row and stale-row when several kinds occur together', () => {
  const durations = [
    { file: 'new.test.js', durationMs: 11000 }, // no row, at/above 1.5x budget - new-pole
    { file: 'unowned.test.js', durationMs: 9000 },
    { file: 'stale.test.js', durationMs: 5000 },
  ];
  const register = [
    { file: 'unowned.test.js', ticket: 'BL-999', firstSeen: '2026-01-01', measuredMs: 9000, note: '' },
    { file: 'stale.test.js', ticket: 'BL-1', firstSeen: '2026-01-01', measuredMs: 9000, note: '' },
  ];

  const result = checkFileDurationBudget(durations, 7000, register, OPEN);

  assert.equal(result.verdict, 'new-pole');
  assert.equal(result.offenders.length, 1);
  assert.equal(result.unownedRows.length, 1);
  assert.equal(result.staleRows.length, 1);
});

test('verdict priority: unowned-row beats stale-row when both occur with no new-pole', () => {
  const durations = [
    { file: 'unowned.test.js', durationMs: 9000 },
    { file: 'stale.test.js', durationMs: 5000 },
  ];
  const register = [
    { file: 'unowned.test.js', ticket: 'BL-999', firstSeen: '2026-01-01', measuredMs: 9000, note: '' },
    { file: 'stale.test.js', ticket: 'BL-1', firstSeen: '2026-01-01', measuredMs: 9000, note: '' },
  ];

  const result = checkFileDurationBudget(durations, 7000, register, OPEN);

  assert.equal(result.verdict, 'unowned-row');
});

// ── formatGuardReport ─────────────────────────────────────────────────────

test('formatGuardReport: an all-clean result produces no info and no failure lines', () => {
  const { infoLines, failureLines } = formatGuardReport({
    passed: true,
    verdict: 'ok',
    offenders: [],
    watchFiles: [],
    staleRows: [],
    unownedRows: [],
    registeredPoles: [],
  });
  assert.deepEqual(infoLines, []);
  assert.deepEqual(failureLines, []);
});

test('formatGuardReport: a registered pole produces exactly one info line naming the count and file, no failure lines', () => {
  const { infoLines, failureLines } = formatGuardReport({
    passed: true,
    verdict: 'ok',
    offenders: [],
    watchFiles: [],
    staleRows: [],
    unownedRows: [],
    registeredPoles: [{ file: 'f.test.js', durationMs: 9000, budgetMs: 7000, kind: 'ok', ticket: 'BL-1' }],
  });
  assert.equal(infoLines.length, 1);
  assert.match(infoLines[0], /^1 registered pole\(s\)/);
  assert.match(infoLines[0], /f\.test\.js/);
  assert.deepEqual(failureLines, []);
});

// Amended 2026-09-16: a stale row is reported (infoLines), never refused
// (failureLines) - only new-pole and unowned-row produce failure lines.
test('formatGuardReport: offenders and unowned rows each produce their OWN failure line; a stale row reports as info, not failure', () => {
  const { infoLines, failureLines } = formatGuardReport({
    passed: false,
    verdict: 'new-pole',
    offenders: [{ file: 'new.test.js', durationMs: 9000, budgetMs: 7000 }],
    watchFiles: [],
    staleRows: [{ file: 'stale.test.js', durationMs: 5000, budgetMs: 7000, kind: 'stale-row', ticket: 'BL-1' }],
    unownedRows: [{ file: 'unowned.test.js', durationMs: 9000, budgetMs: 7000, kind: 'unowned-row', ticket: 'BL-999' }],
    registeredPoles: [],
  });
  assert.equal(failureLines.length, 2);
  assert.match(failureLines[0], /new-pole offender/);
  assert.match(failureLines[0], /new\.test\.js/);
  assert.match(failureLines[1], /unowned register row/);
  assert.match(failureLines[1], /unowned\.test\.js: owner BL-999 is not open/);
  assert.equal(infoLines.length, 1);
  assert.match(infoLines[0], /stale register row/);
  assert.match(infoLines[0], /stale\.test\.js/);
});

test('formatGuardReport: multiple unowned rows are newline-joined, one per line, not glued together', () => {
  const { failureLines } = formatGuardReport({
    passed: false,
    verdict: 'unowned-row',
    offenders: [],
    watchFiles: [],
    staleRows: [],
    unownedRows: [
      { file: 'a.test.js', durationMs: 9000, budgetMs: 7000, kind: 'unowned-row', ticket: 'BL-1' },
      { file: 'b.test.js', durationMs: 9000, budgetMs: 7000, kind: 'unowned-row', ticket: 'BL-2' },
    ],
    registeredPoles: [],
  });
  assert.equal(failureLines.length, 1);
  assert.equal(failureLines[0].split('\n').length, 3); // count line + 2 rows, each its own line
  assert.match(failureLines[0], /a\.test\.js: owner BL-1 is not open\nb\.test\.js: owner BL-2 is not open/);
});

// ── printGuardReport ──────────────────────────────────────────────────────

function captureConsoleAndStderr(fn) {
  const originalLog = console.log;
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const stdout = [];
  const stderr = [];
  console.log = (chunk) => stdout.push(chunk);
  process.stderr.write = (chunk) => {
    stderr.push(chunk);
    return true;
  };
  try {
    fn();
    return { stdout: stdout.join('\n'), stderr: stderr.join('') };
  } finally {
    console.log = originalLog;
    process.stderr.write = originalStderrWrite;
  }
}

test('printGuardReport prints the OK summary line (with the real fileCount and budget seconds) when passed', () => {
  const { stdout, stderr } = captureConsoleAndStderr(() => {
    printGuardReport(
      { passed: true, verdict: 'ok', offenders: [], watchFiles: [], staleRows: [], unownedRows: [], registeredPoles: [] },
      3
    );
  });
  assert.match(stdout, /suite file budget OK: 3 files, all within 7\.0s/);
  assert.equal(stderr, '');
});

test('printGuardReport prints the registered-pole info line even on a passing run', () => {
  const { stdout } = captureConsoleAndStderr(() => {
    printGuardReport(
      {
        passed: true,
        verdict: 'ok',
        offenders: [],
        watchFiles: [],
        staleRows: [],
        unownedRows: [],
        registeredPoles: [{ file: 'f.test.js', durationMs: 9000, budgetMs: 7000, kind: 'ok', ticket: 'BL-1' }],
      },
      1
    );
  });
  assert.match(stdout, /registered pole/);
  assert.match(stdout, /suite file budget OK/);
});

// Amended 2026-09-16: a stale row reports as info (stdout), never a
// failure line - the "join separator" check now uses offenders + an
// unowned row, the two kinds that still refuse together.
test('printGuardReport on failure writes every failure line to stderr, newline-joined, prints a stale row as info, and prints no OK line', () => {
  const { stdout, stderr } = captureConsoleAndStderr(() => {
    printGuardReport(
      {
        passed: false,
        verdict: 'new-pole',
        offenders: [{ file: 'a.test.js', durationMs: 9000, budgetMs: 7000 }],
        watchFiles: [],
        staleRows: [{ file: 'b.test.js', durationMs: 5000, budgetMs: 7000, kind: 'stale-row', ticket: 'BL-1' }],
        unownedRows: [{ file: 'c.test.js', durationMs: 9000, budgetMs: 7000, kind: 'unowned-row', ticket: 'BL-999' }],
        registeredPoles: [],
      },
      2
    );
  });
  assert.match(stderr, /suite file budget exceeded:/);
  // Precise separator check (not [\s\S]*, which matches '' too): the
  // offender line's own trailing text is directly followed by a real
  // newline, then the unowned-row section's own leading text - proves
  // failureLines.join('\n'), never join('') gluing "budget1 unowned..." into
  // one run-on line.
  assert.match(stderr, /per-file budget\n1 unowned register row/);
  assert.doesNotMatch(stderr, /stale register row/);
  assert.match(stdout, /stale register row/);
  assert.doesNotMatch(stdout, /suite file budget OK/);
});

// ── runGuardAgainstReport (end-to-end: real report + real register file) ──

test('runGuardAgainstReport relativizes an ABSOLUTE report path against the register\'s repo root, and reads the register/openTickets for real', () => {
  const root = mkTmp();
  const extensionDir = path.join(root, 'extension');
  const backlogDir = path.join(root, 'backlog');
  fs.mkdirSync(path.join(extensionDir, 'test'), { recursive: true });
  fs.mkdirSync(path.join(backlogDir, 'active'), { recursive: true });
  fs.writeFileSync(path.join(backlogDir, 'active', 'BL-1.yaml'), '');

  const absoluteFile = path.join(extensionDir, 'test', 'slow.test.js');
  const reportPath = writeReport(root, [{ name: absoluteFile, startTime: 0, endTime: 9000 }]);
  const registerPath = path.join(backlogDir, 'suite-poles.tsv');
  // Real committed backlog/suite-poles.tsv rows are extension/-prefixed
  // (repo-root-relative) - registerPath's own repo root, which
  // runGuardAgainstReport derives as dirname(dirname(registerPath)).
  fs.writeFileSync(registerPath, 'extension/test/slow.test.js\tBL-1\t2026-01-01\t9000\tfixture\n');

  const { result, durations } = runGuardAgainstReport(reportPath, registerPath);

  assert.equal(durations[0].file, path.join('extension', 'test', 'slow.test.js'));
  assert.equal(result.passed, true);
  assert.equal(result.registeredPoles.length, 1);
});

// Amended 2026-09-16: with no register, an unregistered file still refuses
// as new-pole once it reaches 1.5x the budget (9000ms alone would now be
// watch - see the dedicated watch-band test above).
test('runGuardAgainstReport with no register path behaves like pre-BL-1598 at/above 1.5x the budget (a clear new-pole)', () => {
  const root = mkTmp();
  const reportPath = writeReport(root, [{ name: 'test/slow.test.js', startTime: 0, endTime: 15000 }]);

  const { result } = runGuardAgainstReport(reportPath);

  assert.equal(result.verdict, 'new-pole');
  assert.equal(result.offenders.length, 1);
});

test('runGuardAgainstReport with a register path whose file does not exist yet treats the register as empty', () => {
  const root = mkTmp();
  const backlogDir = path.join(root, 'backlog');
  fs.mkdirSync(backlogDir, { recursive: true });
  const reportPath = writeReport(root, [{ name: 'test/slow.test.js', startTime: 0, endTime: 15000 }]);
  const registerPath = path.join(backlogDir, 'suite-poles.tsv'); // never written

  const { result } = runGuardAgainstReport(reportPath, registerPath);

  assert.equal(result.verdict, 'new-pole');
});

// ── main() with a register path argument (argv[3]) ────────────────────────

test('main() accepts a register path as its 2nd argument and reports a registered pole as OK', async () => {
  const root = mkTmp();
  const backlogDir = path.join(root, 'backlog');
  fs.mkdirSync(path.join(backlogDir, 'active'), { recursive: true });
  fs.writeFileSync(path.join(backlogDir, 'active', 'BL-1.yaml'), '');
  const registerPath = path.join(backlogDir, 'suite-poles.tsv');
  fs.writeFileSync(registerPath, 'test/slow.test.js\tBL-1\t2026-01-01\t9000\tfixture\n');
  const reportPath = writeReport(root, [{ name: 'test/slow.test.js', startTime: 0, endTime: 9000 }]);

  const result = await runCli([reportPath, registerPath]);

  assert.equal(result.exitCode, undefined);
  assert.match(result.stdout, /suite file budget OK/);
  assert.match(result.stdout, /registered pole/);
});
