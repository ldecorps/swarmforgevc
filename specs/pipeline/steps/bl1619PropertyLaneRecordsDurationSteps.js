'use strict';

// BL-1619: step handlers for "the property lane records its duration and
// names its pole" - the recorder half of the BL-078/BL-378 mirror for the
// property lane. Drives the REAL extension/scripts/recordPropertyDuration.js
// (its exported runRecorder) and extension/scripts/recordPropertyDurationLib.js
// (the pure row/verdict builders) directly - never the real 320 s property
// lane (BL-1541). Scenarios 01/03/04 inject a fake `vitest` binary (a real
// stub subprocess, never a mocked spawnSync result - BL-1541's own "a stub
// on PATH"); scenario 02 drives the pure verdict helpers on a fixture
// report, per the ticket's own direction.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');
const { writeFakeVitestBin, writeKilledFakeVitestBin, readFakeVitestArgv } = require('../../../extension/test/helpers/fakePropertyVitest');
const { runRecorder } = require('../../../extension/scripts/recordPropertyDuration');
const { summarizeDurations, formatPropertyDurationVerdict, HALF_TIMEOUT_MS } = require('../../../extension/scripts/recordPropertyDurationLib');
const { extractFileDurations } = require('../../../extension/out/tools/check-suite-file-budget');

const FEATURE = 'BL-1619 The property lane records its duration and names its pole';

function fixture(ctx) {
  if (!ctx.bl1619) {
    const dir = trackedTmpRoot('bl1619-property-recorder-acceptance-');
    ctx.bl1619 = {
      dir,
      reportPath: path.join(dir, 'report.json'),
      logPath: path.join(dir, '.property-durations.jsonl'),
    };
  }
  return ctx.bl1619;
}

function readRows(logPath) {
  try {
    return fs
      .readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^an extension checkout whose property lane runs through the recorder$/, (ctx) => {
    fixture(ctx);
  });

  // ── property-lane-records-duration-01 (Scenario Outline) ───────────────
  scoped(/^the property lane's vitest run (pass|fail)$/, (ctx, result) => {
    const f = fixture(ctx);
    f.expectedExitCode = result === 'pass' ? 0 : 1;
    f.vitestBin = writeFakeVitestBin(f.dir, { exitCode: f.expectedExitCode });
  });

  scoped(/^npm run test:properties completes$/, (ctx) => {
    const f = fixture(ctx);
    f.outcome = runRecorder({ vitestBin: f.vitestBin, reportPath: f.reportPath, logPath: f.logPath, cwd: f.dir });
  });

  scoped(/^exactly one row is appended to extension\/\.property-durations\.jsonl$/, (ctx) => {
    const f = fixture(ctx);
    assert.equal(readRows(f.logPath).length, 1);
  });

  scoped(/^the row carries finished_at, file_count, result (pass|fail), duration_ms, work_ms, pole_ms and pole_file$/, (ctx, result) => {
    const f = fixture(ctx);
    const [row] = readRows(f.logPath);
    assert.ok(row, 'expected one row on disk');
    assert.equal(row.result, result);
    for (const key of ['finished_at', 'file_count', 'duration_ms', 'work_ms', 'pole_ms', 'pole_file']) {
      assert.ok(key in row, `expected the row to carry "${key}", got: ${JSON.stringify(row)}`);
    }
  });

  scoped(/^the command's exit status is vitest's own$/, (ctx) => {
    const f = fixture(ctx);
    assert.equal(f.outcome.exitCode, f.expectedExitCode);
  });

  // ── property-lane-records-duration-02 ───────────────────────────────────
  scoped(/^a completed property-lane run whose slowest file took 12 s and two other files took more than 10 s$/, (ctx) => {
    const report = {
      testResults: [
        { name: 'test/pole.property.test.js', startTime: 0, endTime: 12000 },
        { name: 'test/second.property.test.js', startTime: 0, endTime: 11000 },
        { name: 'test/third.property.test.js', startTime: 0, endTime: 10500 },
        { name: 'test/fast.property.test.js', startTime: 0, endTime: 2000 },
      ],
    };
    const durations = extractFileDurations(report);
    ctx.bl1619Verdict = {
      durations,
      summary: summarizeDurations(durations),
      wallMs: 15000,
    };
  });

  scoped(/^the verdict line is printed$/, (ctx) => {
    const { summary, durations, wallMs } = ctx.bl1619Verdict;
    ctx.bl1619Verdict.text = formatPropertyDurationVerdict(summary, durations, HALF_TIMEOUT_MS, wallMs);
  });

  scoped(/^it names the pole file and its seconds$/, (ctx) => {
    assert.match(ctx.bl1619Verdict.text, /pole: test\/pole\.property\.test\.js \(12\.0s\)/);
  });

  scoped(/^it lists the three files above 10 s with their seconds$/, (ctx) => {
    const text = ctx.bl1619Verdict.text;
    assert.match(text, /test\/pole\.property\.test\.js \(12\.0s\)/);
    assert.match(text, /test\/second\.property\.test\.js \(11\.0s\)/);
    assert.match(text, /test\/third\.property\.test\.js \(10\.5s\)/);
    assert.doesNotMatch(text, /test\/fast\.property\.test\.js/);
  });

  scoped(/^it prints the work sum and the wall in seconds$/, (ctx) => {
    assert.match(ctx.bl1619Verdict.text, /work 35\.5s \/ wall 15\.0s/);
  });

  // ── property-lane-records-duration-03 ───────────────────────────────────
  scoped(/^the property lane's vitest process is killed before it reports$/, (ctx) => {
    const f = fixture(ctx);
    f.vitestBin = writeKilledFakeVitestBin(f.dir);
  });

  scoped(/^the recorder exits$/, (ctx) => {
    const f = fixture(ctx);
    f.outcome = runRecorder({ vitestBin: f.vitestBin, reportPath: f.reportPath, logPath: f.logPath, cwd: f.dir });
  });

  scoped(/^no row is appended and the exit status is non-zero$/, (ctx) => {
    const f = fixture(ctx);
    assert.equal(readRows(f.logPath).length, 0);
    assert.notEqual(f.outcome.exitCode, 0);
  });

  // ── property-lane-records-duration-04 ───────────────────────────────────
  // BL-1619 QA bounce D3: the fake's canned report never varies with its
  // arguments, so a report-CONTENT comparison alone is vacuous (it cannot
  // catch a recorder that silently drops or mutates an argument, e.g. the
  // bounce's own --config-dropping mutant). This also drives BOTH
  // invocations with a file filter (QA's own "e.g. both with a file
  // filter") so D1's forwarded-extraArgs fix has real coverage here too -
  // the ARGV comparison below is what actually proves the recorder
  // spawned the identical command a correct, hand-built invocation would.
  const BL1619_FILTER_ARG = 'test/pole.property.test.js';

  scoped(/^the same property-lane run with and without the recorder$/, (ctx) => {
    const f = fixture(ctx);
    f.vitestBin = writeFakeVitestBin(f.dir, { exitCode: 0 });
    f.directReportPath = path.join(f.dir, 'direct-report.json');
  });

  scoped(/^both complete$/, (ctx) => {
    const f = fixture(ctx);
    execFileSync(f.vitestBin, [
      'run',
      '--config',
      'vitest.properties.config.mjs',
      '--reporter=default',
      '--reporter=json',
      `--outputFile=${f.directReportPath}`,
      BL1619_FILTER_ARG,
    ]);
    f.directReport = JSON.parse(fs.readFileSync(f.directReportPath, 'utf8'));
    f.outcome = runRecorder({
      vitestBin: f.vitestBin,
      reportPath: f.reportPath,
      logPath: f.logPath,
      cwd: f.dir,
      extraArgs: [BL1619_FILTER_ARG],
    });
    f.throughReport = JSON.parse(fs.readFileSync(f.reportPath, 'utf8'));
  });

  scoped(/^the set of test files run, their order and the pass\/fail result are identical$/, (ctx) => {
    const f = fixture(ctx);
    assert.deepEqual(f.throughReport.testResults, f.directReport.testResults);
    const directArgv = readFakeVitestArgv(f.directReportPath);
    const throughArgv = readFakeVitestArgv(f.reportPath);
    assert.deepEqual(
      throughArgv,
      directArgv,
      `expected the recorder to spawn the identical argv (including the forwarded filter) a direct invocation would, got through=${JSON.stringify(throughArgv)} direct=${JSON.stringify(directArgv)}`
    );
  });
}

module.exports = { registerSteps };
