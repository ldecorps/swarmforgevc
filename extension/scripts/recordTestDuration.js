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
// test_count is the number of test FILES executed, not individual test()
// cases - a stable, cheap proxy. Counting individual cases would mean
// intercepting the child's TAP stdout instead of inheriting it directly,
// which risks altering the byte-for-byte console output existing consumers
// (CI logs, the coverage/crap scripts) rely on.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { listTestFiles, buildRecord, appendRecord, computeFinalExitCode } = require('./testDurationRecorderLib');
const { buildSuiteBudgetVerdict, formatSuiteBudgetVerdict } = require('../out/tools/check-suite-duration-budget');

const ROOT_DIR = path.join(__dirname, '..');
const TEST_DIR = path.join(ROOT_DIR, 'test');
const LOG_PATH = path.join(ROOT_DIR, '.test-durations.jsonl');
const REPORT_PATH = path.join(ROOT_DIR, '.vitest-report.json');
const BUDGET_GUARD_CLI = path.join(ROOT_DIR, 'out', 'tools', 'check-suite-file-budget.js');

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

  appendRecord(
    LOG_PATH,
    buildRecord({
      finishedAt: new Date().toISOString(),
      testCount: testFiles.length,
      exitCode: testExitCode,
      durationMs,
    })
  );

  // BL-445: the whole-suite sibling of the per-file guard below - surfaces
  // an over-budget run against the operator's 10s target (never hard-fails;
  // see check-suite-duration-budget.ts). Computed in-process from the
  // durationMs already measured above, not spawned, since the value already
  // lives in this process and this run is itself trying to cut overhead.
  console.log(formatSuiteBudgetVerdict(buildSuiteBudgetVerdict(durationMs)));

  const guardResult = fs.existsSync(REPORT_PATH) ? spawnSync('node', [BUDGET_GUARD_CLI, REPORT_PATH], { stdio: 'inherit', cwd: ROOT_DIR }) : null;
  const guardExitCode = guardResult && guardResult.status !== null ? guardResult.status : 0;

  process.exit(computeFinalExitCode(testExitCode, guardExitCode));
}

main();
