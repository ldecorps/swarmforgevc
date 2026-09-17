#!/usr/bin/env node
// BL-078: wraps the real unit-test run to append one duration record per
// completed run (pass or fail), so suite-duration creep is visible in the
// METRICS pane/CLI before it throttles the whole pipeline (BL-060 lesson).
// Vitest's own stdout/stderr stays inherited and byte-for-byte identical
// to a bare `vitest run` (one extra "JSON report written to..." line from
// BL-378's own reporter below - nothing parses this script's stdout, only
// humans/CI logs read it).
//
// BL-378: ALSO runs the per-file duration budget guard against this same
// run's own JSON reporter output, so a single test file quietly becoming
// the suite's next wall-clock pole fails this script's exit code even
// when every individual test in it still passes (the whole-suite trend
// this script already records cannot see a single-file regression - see
// check-suite-file-budget.ts). The guard runs whenever the report file
// was written, including after a genuine test FAILURE (a file already
// over budget is worth reporting alongside a failing test, not hidden
// behind it) - a real test failure's own exit code still wins if both
// occur, since that is the more urgent signal.
//
// BL-1598: the guard now reads backlog/suite-poles.tsv, the committed pole
// register, so it refuses only a NEW offender at or above 1.5x budget or an
// unowned row (naming a closed/absent ticket); a watch file (unregistered,
// over budget but under 1.5x) and a stale row (a registered file now well
// under budget) are reported on every run, never refused - a snapshot gate
// that refuses on ordinary host-load jitter is red on day one (amended
// 2026-09-16, BL-445's own documented shape). Called in-process via
// runGuardAgainstReport (the same decision check-suite-file-budget.ts's own
// standalone CLI makes) rather than spawned a second time, so this script
// and a human running the CLI directly never compute two different
// answers.
//
// test_count is the number of test FILES executed, not individual test()
// cases - a stable, cheap proxy. Counting individual cases would mean
// intercepting the child's TAP stdout instead of inheriting it directly,
// which risks altering the byte-for-byte console output existing consumers
// (CI logs, the coverage/crap scripts) rely on.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { listTestFiles, buildRecord, appendRecord, computeFinalExitCode } = require('./testDurationRecorderLib');
const {
  buildSuiteBudgetVerdict,
  formatSuiteBudgetVerdict,
  buildSuiteWorkVerdict,
  formatSuiteWorkVerdict,
} = require('../out/tools/check-suite-duration-budget');
const { runGuardAgainstReport, printGuardReport } = require('../out/tools/check-suite-file-budget');
const { resolveVitestWorkerPool, resolveFreeCoresCeiling } = require('../out/tools/vitest-worker-memory-budget');

const ROOT_DIR = path.join(__dirname, '..');
const TEST_DIR = path.join(ROOT_DIR, 'test');
const LOG_PATH = path.join(ROOT_DIR, '.test-durations.jsonl');
const REPORT_PATH = path.join(ROOT_DIR, '.vitest-report.json');
const REGISTER_PATH = path.join(ROOT_DIR, '..', 'backlog', 'suite-poles.tsv');

function main() {
  const testFiles = listTestFiles(TEST_DIR).map((f) => path.join('test', f));
  const startedAt = Date.now();
  // BL-124: the suite now runs under Vitest (node --test can no longer run the
  // files — they use Vitest globals). Vitest discovers files from its config
  // include, so no file list is passed; testCount below still counts files.
  const vitestBin = path.join(ROOT_DIR, 'node_modules', '.bin', 'vitest');
  const result = spawnSync(vitestBin, ['run', '--reporter=default', '--reporter=json', `--outputFile=${REPORT_PATH}`], {
    stdio: 'inherit',
    cwd: ROOT_DIR,
  });
  const durationMs = Date.now() - startedAt;
  const testExitCode = result.status === null ? 1 : result.status;

  // BL-445: the whole-suite sibling of the per-file guard below - surfaces
  // an over-budget run against the operator's 10s target (never hard-fails;
  // see check-suite-duration-budget.ts). Computed in-process from the
  // durationMs already measured above, not spawned, since the value already
  // lives in this process and this run is itself trying to cut overhead.
  console.log(formatSuiteBudgetVerdict(buildSuiteBudgetVerdict(durationMs)));

  let guardVerdict = { passed: true, verdict: 'ok', offenders: [], watchFiles: [], staleRows: [], unownedRows: [], registeredPoles: [] };
  let poleMs = 0;
  let workMs = 0;
  if (fs.existsSync(REPORT_PATH)) {
    const { result: verdict, durations } = runGuardAgainstReport(REPORT_PATH, REGISTER_PATH);
    guardVerdict = verdict;
    poleMs = durations.reduce((max, d) => Math.max(max, d.durationMs), 0);
    workMs = durations.reduce((sum, d) => sum + d.durationMs, 0);
    printGuardReport(guardVerdict, durations.length);
  }
  const guardExitCode = guardVerdict.passed ? 0 : 1;

  // BL-1599: the SAME resolveVitestWorkerPool composition vitest.config.mjs
  // itself calls, with the same real environment inputs, so the fork count
  // the ratchet reads is the lane's real pool size - never a copy of the
  // config's own sizing decision.
  const forks = resolveVitestWorkerPool({
    pack: process.env.SWARMFORGE_PACK,
    rotation: process.env.SWARMFORGE_ROTATION,
    platform: os.platform(),
    override: process.env.SWARMFORGE_VITEST_MAX_FORKS,
    hostRamMB: os.totalmem() / (1024 * 1024),
    defaultCeiling: resolveFreeCoresCeiling(os.cpus().length, os.loadavg()[1]),
  });
  // BL-1599: decides the work ratchet against SUITE_WORK_BUDGET_MS (the
  // default buildSuiteWorkVerdict falls back to - never re-passed here,
  // so a lowered budget in check-suite-duration-budget.ts applies here
  // with no second edit) on every npm test run - the live consumer.
  const workVerdict = buildSuiteWorkVerdict(workMs, forks, poleMs);
  console.log(formatSuiteWorkVerdict(workVerdict));
  const workExitCode = workVerdict.verdict === 'over-budget' ? 1 : 0;

  appendRecord(
    LOG_PATH,
    buildRecord({
      finishedAt: new Date().toISOString(),
      testCount: testFiles.length,
      exitCode: testExitCode,
      durationMs,
      poleMs,
      workMs,
      newOffenders: guardVerdict.offenders.length,
      watchFiles: guardVerdict.watchFiles.length,
      budgetVerdict: guardVerdict.verdict,
      workBudgetVerdict: workVerdict.verdict,
    })
  );

  process.exit(computeFinalExitCode(testExitCode, guardExitCode, workExitCode));
}

main();
