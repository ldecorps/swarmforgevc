// BL-078: pure logic for the test-suite duration recorder lives here so
// recordTestDuration.js (the CLI entry point that shells out to the real
// test run) stays a thin wrapper — mirrors crapLib.js's split.
const fs = require('fs');

function listTestFiles(testDir) {
  return fs
    .readdirSync(testDir)
    .filter((f) => f.endsWith('.test.js'))
    .sort();
}

function buildRecord({ finishedAt, testCount, exitCode, durationMs }) {
  return {
    finished_at: finishedAt,
    test_count: testCount,
    result: exitCode === 0 ? 'pass' : 'fail',
    duration_ms: durationMs,
  };
}

// Recording must never break the suite (BL-078 suite-duration-02): any
// write failure (unwritable path, full disk, missing directory, ...) is
// swallowed and reported back as false rather than thrown.
function appendRecord(logPath, record) {
  try {
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n');
    return true;
  } catch {
    return false;
  }
}

module.exports = { listTestFiles, buildRecord, appendRecord };
