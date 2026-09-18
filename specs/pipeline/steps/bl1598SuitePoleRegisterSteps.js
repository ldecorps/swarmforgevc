'use strict';

// BL-1598: step handlers for "the unit suite pole register makes the
// per-file gate green". Scenarios 01 and 02 drive the REAL pure functions
// (checkFileDurationBudget, buildRecord/computeFinalExitCode) with injected
// fixtures, in milliseconds (BL-1541 shape) - never a subprocess, never a
// hand-copied decision table. Scenario 03 (the committed register's own
// 2026-09-16 census pin) was retired by BL-1633 (BL-1006, 2026-09-18): a
// row draining as its file's pole is fixed is the register's own designed
// mechanism, so a fixed row count/name-list goes stale by construction -
// see BL-1633's evidence for the retirement's own record.
//
// Scenario 01's <report>/<register> Examples columns are narrative English
// ("one file measures 9000 ms", "names that file with an open owner"), so
// this handler maps them through an explicit KNOWN_VALUES lookup (the
// engineering article's Scenario Outline rule) rather than parsing them -
// exactly the 6 combinations the ticket's own Examples table declares
// (amended 2026-09-16 on QA's Article 4.2 hold: watch/1.5x/stale-reports),
// and nothing else. An unknown token throws rather than passing through.

const assert = require('node:assert/strict');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'extension', 'out');
const { checkFileDurationBudget } = require(path.join(OUT_DIR, 'tools', 'check-suite-file-budget'));
const {
  buildRecord,
  computeFinalExitCode,
} = require(path.join(REPO_ROOT, 'extension', 'scripts', 'testDurationRecorderLib'));

const BUDGET_MS = 7000;

const FEATURE = 'BL-1598 The unit suite pole register makes the per-file gate green';

// -- Scenario 01: <report> -> {durations, focusFile} -----------------------

const REPORT_FIXTURES = {
  'one file measures 9000 ms': () => ({
    durations: [{ file: 'test/slow.test.js', durationMs: 9000 }],
    focusFile: 'test/slow.test.js',
  }),
  'one file measures 11000 ms': () => ({
    durations: [{ file: 'test/slow.test.js', durationMs: 11000 }],
    focusFile: 'test/slow.test.js',
  }),
  'every file measures under 5000 ms': () => ({
    durations: [
      { file: 'test/a.test.js', durationMs: 3000 },
      { file: 'test/b.test.js', durationMs: 4500 },
    ],
    focusFile: 'test/a.test.js',
  }),
  'every file measures under 7000 ms': () => ({
    durations: [{ file: 'test/quick.test.js', durationMs: 100 }],
    focusFile: null,
  }),
};

function reportFixture(token) {
  if (!Object.prototype.hasOwnProperty.call(REPORT_FIXTURES, token)) {
    throw new Error(`unknown <report> token: "${token}"`);
  }
  return REPORT_FIXTURES[token]();
}

// -- Scenario 01: <register> -> {rows, openTickets} -------------------------

const REGISTER_FIXTURES = {
  'names that file with an open owner': (focusFile) => ({
    rows: [{ file: focusFile, ticket: 'BL-9001', firstSeen: '2026-01-01', measuredMs: 9000, note: 'fixture' }],
    openTickets: new Set(['BL-9001']),
    ticket: 'BL-9001',
  }),
  'is empty': () => ({ rows: [], openTickets: new Set(), ticket: null }),
  'names one of them with an open owner': (focusFile) => ({
    rows: [{ file: focusFile, ticket: 'BL-9003', firstSeen: '2026-01-01', measuredMs: 4800, note: 'fixture' }],
    openTickets: new Set(['BL-9003']),
    ticket: 'BL-9003',
  }),
  'names that file with a closed or absent owner': (focusFile) => ({
    rows: [{ file: focusFile, ticket: 'BL-9002', firstSeen: '2026-01-01', measuredMs: 9000, note: 'fixture' }],
    openTickets: new Set(), // BL-9002 deliberately absent from the open set
    ticket: 'BL-9002',
  }),
};

function registerFixture(token, focusFile) {
  if (!Object.prototype.hasOwnProperty.call(REGISTER_FIXTURES, token)) {
    throw new Error(`unknown <register> token: "${token}"`);
  }
  return REGISTER_FIXTURES[token](focusFile);
}

// -- Scenario 01: <verdict> -> assertion against the real result -----------

const VERDICT_CHECKS = {
  'ok, the file reported as a registered pole': (result, ctx) => {
    assert.equal(result.verdict, 'ok');
    assert.equal(result.passed, true);
    assert.ok(
      result.registeredPoles.some((p) => p.file === ctx.focusFile),
      `expected ${ctx.focusFile} among registeredPoles, got ${JSON.stringify(result.registeredPoles)}`
    );
  },
  'watch naming the file and 9000 ms, exit 0': (result, ctx) => {
    assert.equal(result.verdict, 'watch');
    assert.equal(result.passed, true);
    assert.ok(
      result.watchFiles.some((w) => w.file === ctx.focusFile && w.durationMs === 9000),
      `expected ${ctx.focusFile} at 9000ms among watchFiles, got ${JSON.stringify(result.watchFiles)}`
    );
  },
  'new-pole naming the file and 11000 ms': (result, ctx) => {
    assert.equal(result.verdict, 'new-pole');
    assert.equal(result.passed, false);
    assert.ok(
      result.offenders.some((o) => o.file === ctx.focusFile && o.durationMs === 11000),
      `expected ${ctx.focusFile} at 11000ms among offenders, got ${JSON.stringify(result.offenders)}`
    );
  },
  'stale-row reported naming that file, exit 0': (result, ctx) => {
    assert.equal(result.verdict, 'stale-row');
    assert.equal(result.passed, true);
    assert.ok(
      result.staleRows.some((r) => r.file === ctx.focusFile),
      `expected ${ctx.focusFile} among staleRows, got ${JSON.stringify(result.staleRows)}`
    );
  },
  'unowned-row naming the file and its owner': (result, ctx) => {
    assert.equal(result.verdict, 'unowned-row');
    assert.equal(result.passed, false);
    assert.ok(
      result.unownedRows.some((r) => r.file === ctx.focusFile && r.ticket === ctx.registerTicket),
      `expected ${ctx.focusFile} owned by ${ctx.registerTicket} among unownedRows, got ${JSON.stringify(result.unownedRows)}`
    );
  },
  ok: (result) => {
    assert.equal(result.verdict, 'ok');
    assert.equal(result.passed, true);
    assert.equal(result.offenders.length, 0);
    assert.equal(result.watchFiles.length, 0);
    assert.equal(result.staleRows.length, 0);
    assert.equal(result.unownedRows.length, 0);
    assert.equal(result.registeredPoles.length, 0);
  },
};

function verdictCheck(token) {
  if (!Object.prototype.hasOwnProperty.call(VERDICT_CHECKS, token)) {
    throw new Error(`unknown <verdict> token: "${token}"`);
  }
  return VERDICT_CHECKS[token];
}

// -- Scenario 02: <exit> -> assertion -----------------------------------

function assertExit(token, actual) {
  if (token === 'non-zero') {
    assert.notEqual(actual, 0, `expected a non-zero exit code, got ${actual}`);
    return;
  }
  assert.equal(actual, Number(token));
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // -- Scenario 01 (Outline) -------------------------------------------
  scoped(/^a per-file duration report where (.+)$/, (ctx, token) => {
    const { durations, focusFile } = reportFixture(token);
    ctx.bl1598durations = durations;
    ctx.bl1598focusFile = focusFile;
  });

  scoped(/^a pole register that (.+)$/, (ctx, token) => {
    const { rows, openTickets, ticket } = registerFixture(token, ctx.bl1598focusFile);
    ctx.bl1598rows = rows;
    ctx.bl1598openTickets = openTickets;
    ctx.bl1598registerTicket = ticket;
  });

  scoped(/^the per-file budget guard runs with a 7000 ms budget$/, (ctx) => {
    ctx.bl1598result = checkFileDurationBudget(ctx.bl1598durations, BUDGET_MS, ctx.bl1598rows, ctx.bl1598openTickets);
  });

  scoped(/^the verdict is (.+)$/, (ctx, token) => {
    verdictCheck(token)(ctx.bl1598result, { focusFile: ctx.bl1598focusFile, registerTicket: ctx.bl1598registerTicket });
  });

  // -- Scenario 02 (Outline) -------------------------------------------
  scoped(/^a test exit code of (\d+) and a guard verdict of ([\w-]+)$/, (ctx, testExit, verdict) => {
    ctx.bl1598testExit = Number(testExit);
    ctx.bl1598verdict = verdict;
  });

  scoped(/^the recorder builds the run's row$/, (ctx) => {
    // Amended 2026-09-16: only new-pole and unowned-row fail the guard's
    // own exit code; watch and stale-row are reported, never refused.
    const REFUSING_VERDICTS = new Set(['new-pole', 'unowned-row']);
    const guardExitCode = REFUSING_VERDICTS.has(ctx.bl1598verdict) ? 1 : 0;
    ctx.bl1598record = buildRecord({
      finishedAt: '2026-09-16T00:00:00.000Z',
      testCount: 1,
      exitCode: ctx.bl1598testExit,
      durationMs: 1000,
      poleMs: 1000,
      workMs: 1000,
      newOffenders: ctx.bl1598verdict === 'new-pole' ? 1 : 0,
      watchFiles: ctx.bl1598verdict === 'watch' ? 1 : 0,
      budgetVerdict: ctx.bl1598verdict,
    });
    ctx.bl1598exitCode = computeFinalExitCode(ctx.bl1598testExit, guardExitCode);
  });

  scoped(/^the row's result is (\w+) and its budget_verdict is ([\w-]+)$/, (ctx, result, budgetVerdict) => {
    assert.equal(ctx.bl1598record.result, result);
    assert.equal(ctx.bl1598record.budget_verdict, budgetVerdict);
  });

  scoped(/^the run's exit code is (\S+)$/, (ctx, exitToken) => {
    assertExit(exitToken, ctx.bl1598exitCode);
  });
}

module.exports = { registerSteps };
