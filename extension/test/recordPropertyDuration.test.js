const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { writeFakeVitestBin, writeKilledFakeVitestBin } = require('./helpers/fakePropertyVitest');
const { runRecorder } = require('../scripts/recordPropertyDuration');

function mkFixture() {
  const dir = mkTmpDir('sfvc-property-recorder-wiring-');
  return {
    dir,
    reportPath: path.join(dir, 'report.json'),
    logPath: path.join(dir, '.property-durations.jsonl'),
  };
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

// BL-1619 scenario 01 ─────────────────────────────────────────────────

test('runRecorder appends exactly one row and returns vitest\'s own exit status on a pass', () => {
  const { dir, reportPath, logPath } = mkFixture();
  const vitestBin = writeFakeVitestBin(dir, { exitCode: 0 });

  const { exitCode, appended } = runRecorder({ vitestBin, reportPath, logPath, cwd: dir });

  assert.equal(exitCode, 0);
  assert.equal(appended, true);
  const rows = readRows(logPath);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].result, 'pass');
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    'duration_ms',
    'file_count',
    'finished_at',
    'pole_file',
    'pole_ms',
    'result',
    'work_ms',
  ]);
});

test('runRecorder appends exactly one row and returns vitest\'s own exit status on a fail', () => {
  const { dir, reportPath, logPath } = mkFixture();
  const vitestBin = writeFakeVitestBin(dir, { exitCode: 1 });

  const { exitCode, appended } = runRecorder({ vitestBin, reportPath, logPath, cwd: dir });

  assert.equal(exitCode, 1);
  assert.equal(appended, true);
  const rows = readRows(logPath);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].result, 'fail');
});

// BL-1619 scenario 03 ─────────────────────────────────────────────────

test('runRecorder appends no row and reports a non-zero exit status when vitest is killed before it reports', () => {
  const { dir, reportPath, logPath } = mkFixture();
  const vitestBin = writeKilledFakeVitestBin(dir);

  const { exitCode, appended } = runRecorder({ vitestBin, reportPath, logPath, cwd: dir });

  assert.notEqual(exitCode, 0);
  assert.equal(appended, false);
  assert.equal(readRows(logPath).length, 0);
});

// BL-1619 scenario 04 ─────────────────────────────────────────────────

test('the recorder changes nothing about which files vitest reports, their order or their result', () => {
  const { dir } = mkFixture();
  const vitestBin = writeFakeVitestBin(dir, { exitCode: 0 });

  // Direct: the same stub, invoked the same way `npm run test:properties`
  // itself would, with no recorder involved at all.
  const { execFileSync } = require('node:child_process');
  const directReportPath = path.join(dir, 'direct-report.json');
  execFileSync(vitestBin, ['run', '--config', 'vitest.properties.config.mjs', '--reporter=json', `--outputFile=${directReportPath}`]);
  const directReport = JSON.parse(fs.readFileSync(directReportPath, 'utf8'));

  // Through the recorder.
  const throughReportPath = path.join(dir, 'through-report.json');
  const throughLogPath = path.join(dir, 'through.jsonl');
  runRecorder({ vitestBin, reportPath: throughReportPath, logPath: throughLogPath, cwd: dir });
  const throughReport = JSON.parse(fs.readFileSync(throughReportPath, 'utf8'));

  assert.deepEqual(throughReport.testResults, directReport.testResults);
});
