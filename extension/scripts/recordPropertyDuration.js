#!/usr/bin/env node
// BL-1619: wraps the real property-lane run to append one duration record
// per COMPLETED run (pass or fail) to extension/.property-durations.jsonl,
// and prints a verdict naming the pole and every file above half the
// lane's baseline testTimeout - the recorder half of the BL-078/BL-378
// mirror for the property lane, observation only (invariant 2): this
// script changes nothing about which files vitest runs, their order, or
// the exit status it reports (recordPropertyDurationLib.js owns every
// pure decision; FIRM/out_of_scope - no budget, no refusal, no register,
// no work ratchet in this slice, unlike the unit lane's own recorder).
//
// Vitest's own stdout/stderr stays inherited, byte-for-byte identical to
// a bare `vitest run --config vitest.properties.config.mjs` (one extra
// "JSON report written to..." line from the added --reporter=json, the
// same additive-reporter technique recordTestDuration.js already uses).
//
// main() is a thin wrapper over runRecorder below (engineering.prompt's
// "CLI main() is a thin wrapper over exported, testable helpers" rule) -
// every impure seam (which vitest binary to spawn, where its report and
// the durations log live) is a parameter, injected by the real CLI
// invocation's own defaults and overridable in-process by the acceptance
// handler (BL-1541: never the real 320s lane - a fake vitest stub on
// PATH, never *_FORCE_RESULT env bypasses).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildRecord, summarizeDurations, formatPropertyDurationVerdict, HALF_TIMEOUT_MS } = require('./recordPropertyDurationLib');
const { appendRecord, listPipelineTestFiles, partitionPipelineTestFiles, buildPipelineTestArgs } = require('./testDurationRecorderLib');
const { extractFileDurations } = require('../out/tools/check-suite-file-budget');

const ROOT_DIR = path.join(__dirname, '..');
const REPO_ROOT_DIR = path.join(ROOT_DIR, '..');
const LOG_PATH = path.join(ROOT_DIR, '.property-durations.jsonl');
// Its own report file, distinct from the unit lane's .vitest-report.json
// (recordTestDuration.js) - the two recorders must never clobber each
// other's report if a pack ever runs both lanes close together.
const REPORT_PATH = path.join(ROOT_DIR, '.property-vitest-report.json');
const VITEST_BIN = path.join(ROOT_DIR, 'node_modules', '.bin', 'vitest');
const CONFIG_PATH = 'vitest.properties.config.mjs';
// BL-2041 (QA bounce S1): specs/pipeline/test's own *.property.test.js
// files (3 of the lane's 41) are node:test files, never vitest's - they
// cannot join vitest.properties.config.mjs's own `include`. Run after
// vitest, same script, folded into the SAME exit code - the property-lane
// mirror of recordTestDuration.js's own pipeline run, partitioning the
// SAME census the SAME way (testDurationRecorderLib's
// partitionPipelineTestFiles) so the two recorders can never disagree
// about which 3 files those are.
const PIPELINE_TEST_DIR = path.join(REPO_ROOT_DIR, 'specs', 'pipeline', 'test');

function runRecorder({
  vitestBin = VITEST_BIN,
  reportPath = REPORT_PATH,
  logPath = LOG_PATH,
  cwd = ROOT_DIR,
  extraArgs = [],
  // BL-2041 QA bounce D1: a seam, never the module constant read directly -
  // a unit test or the acceptance handler passes an empty fixture dir so a
  // call with extraArgs:[] does not spawn the real 3-file pipeline property
  // run (engineering.prompt's own "fakes, never the real lane", BL-1541).
  pipelineTestDir = PIPELINE_TEST_DIR,
} = {}) {
  // A stale report from an earlier KILLED run never survives to be
  // misread as this run's own (scenario 03) - vitest's JSON reporter only
  // writes this file on completion, so its absence after the spawn below
  // reliably means "this run did not complete."
  try {
    fs.unlinkSync(reportPath);
  } catch {
    /* nothing to remove */
  }

  const startedAt = Date.now();
  const result = spawnSync(
    vitestBin,
    ['run', '--config', CONFIG_PATH, '--reporter=default', '--reporter=json', `--outputFile=${reportPath}`, ...extraArgs],
    { stdio: 'inherit', cwd }
  );
  const durationMs = Date.now() - startedAt;
  const vitestExitCode = result.status === null ? 1 : result.status;

  // BL-2041 (QA bounce S1): the lane's own 3 pipeline *.property.test.js
  // files run here too, after vitest, folded into the SAME exit code -
  // only on a whole-lane run (extraArgs empty), the same posture as the
  // duration-append skip just below: a filtered single-file run is not a
  // whole-lane run, so it never also runs the pipeline property files.
  let pipelinePropertyExitCode = 0;
  if (extraArgs.length === 0) {
    const pipelineFiles = listPipelineTestFiles(pipelineTestDir);
    const { propertyFiles: pipelinePropertyFiles } = partitionPipelineTestFiles(pipelineFiles);
    if (pipelinePropertyFiles.length > 0) {
      const pipelineResult = spawnSync(process.execPath, buildPipelineTestArgs(pipelinePropertyFiles), {
        stdio: 'inherit',
        cwd: REPO_ROOT_DIR,
      });
      pipelinePropertyExitCode = pipelineResult.status === null ? 1 : pipelineResult.status;
    }
  }
  const testExitCode = vitestExitCode !== 0 ? vitestExitCode : pipelinePropertyExitCode;

  // BL-1619 QA bounce D1: a filtered run (`npm run test:properties -- <file>`,
  // extraArgs non-empty) is not a whole-lane run - its census and trend
  // would silently mix a one-file sample into the lane-wide row, so it
  // appends none, keeping the census and trend whole-lane only. The verdict
  // is still useful for a human filtering a single file by hand, so it
  // still prints.
  let appended = false;
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const durations = extractFileDurations(report, cwd);
    const summary = summarizeDurations(durations);

    console.log(formatPropertyDurationVerdict(summary, durations, HALF_TIMEOUT_MS, durationMs));

    if (extraArgs.length === 0) {
      appended = appendRecord(
        logPath,
        buildRecord({
          finishedAt: new Date().toISOString(),
          fileCount: durations.length,
          exitCode: testExitCode,
          durationMs,
          workMs: summary.workMs,
          poleMs: summary.poleMs,
          poleFile: summary.poleFile,
        })
      );
    }
  }

  return { exitCode: testExitCode, appended };
}

function main() {
  // BL-1619 QA bounce D1: `npm run test:properties -- <file>` must still
  // run only <file>, as it did before this recorder existed - forward
  // every extra argv entry to vitest, after the recorder's own fixed args.
  const { exitCode } = runRecorder({ extraArgs: process.argv.slice(2) });
  process.exit(exitCode);
}

module.exports = { runRecorder, VITEST_BIN, REPORT_PATH, LOG_PATH, CONFIG_PATH };

if (require.main === module) {
  main();
}
