#!/usr/bin/env node
// BL-078: wraps the real unit-test run to append one duration record per
// completed run (pass or fail), so suite-duration creep is visible in the
// METRICS pane/CLI before it throttles the whole pipeline (BL-060 lesson).
// Recording never changes the suite's own stdout/stderr or exit code:
// stdio is inherited untouched and the child's exit code is passed through
// unconditionally, even when appending the record itself fails.
//
// test_count is the number of test FILES executed, not individual test()
// cases - a stable, cheap proxy. Counting individual cases would mean
// intercepting the child's TAP stdout instead of inheriting it directly,
// which risks altering the byte-for-byte console output existing consumers
// (CI logs, the coverage/crap scripts) rely on.
const path = require('path');
const { spawnSync } = require('child_process');
const { listTestFiles, buildRecord, appendRecord } = require('./testDurationRecorderLib');

const ROOT_DIR = path.join(__dirname, '..');
const TEST_DIR = path.join(ROOT_DIR, 'test');
const LOG_PATH = path.join(ROOT_DIR, '.test-durations.jsonl');

function main() {
  const testFiles = listTestFiles(TEST_DIR).map((f) => path.join('test', f));
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=8', ...testFiles], {
    stdio: 'inherit',
    cwd: ROOT_DIR,
  });
  const durationMs = Date.now() - startedAt;
  const exitCode = result.status === null ? 1 : result.status;

  appendRecord(
    LOG_PATH,
    buildRecord({
      finishedAt: new Date().toISOString(),
      testCount: testFiles.length,
      exitCode,
      durationMs,
    })
  );

  process.exit(exitCode);
}

main();
