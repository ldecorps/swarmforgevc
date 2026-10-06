const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { writeFakeVitestBin, writeKilledFakeVitestBin, readFakeVitestArgv } = require('./helpers/fakePropertyVitest');
const { runRecorder } = require('../scripts/recordPropertyDuration');

function mkFixture() {
  const dir = mkTmpDir('sfvc-property-recorder-wiring-');
  // BL-2041 QA bounce D1: an empty fixture dir, never the real
  // specs/pipeline/test - without this, every call below with extraArgs:[]
  // would spawn the real 3-file pipeline property run via runRecorder's
  // own default.
  const pipelineTestDir = mkTmpDir('sfvc-property-recorder-pipeline-');
  return {
    dir,
    pipelineTestDir,
    reportPath: path.join(dir, 'report.json'),
    logPath: path.join(dir, '.property-durations.jsonl'),
  };
}

function writeRedPipelinePropertyTest(pipelineTestDir) {
  fs.writeFileSync(
    path.join(pipelineTestDir, 'bl2041FixtureRed.property.test.js'),
    "require('node:test')('red', () => { throw new Error('deliberately red'); });\n"
  );
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
  const { dir, pipelineTestDir, reportPath, logPath } = mkFixture();
  const vitestBin = writeFakeVitestBin(dir, { exitCode: 0 });

  const { exitCode, appended } = runRecorder({ vitestBin, reportPath, logPath, cwd: dir, pipelineTestDir });

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
  const { dir, pipelineTestDir, reportPath, logPath } = mkFixture();
  const vitestBin = writeFakeVitestBin(dir, { exitCode: 1 });

  const { exitCode, appended } = runRecorder({ vitestBin, reportPath, logPath, cwd: dir, pipelineTestDir });

  assert.equal(exitCode, 1);
  assert.equal(appended, true);
  const rows = readRows(logPath);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].result, 'fail');
});

// BL-1619 scenario 03 ─────────────────────────────────────────────────

test('runRecorder appends no row and reports a non-zero exit status when vitest is killed before it reports', () => {
  const { dir, pipelineTestDir, reportPath, logPath } = mkFixture();
  const vitestBin = writeKilledFakeVitestBin(dir);

  const { exitCode, appended } = runRecorder({ vitestBin, reportPath, logPath, cwd: dir, pipelineTestDir });

  assert.notEqual(exitCode, 0);
  assert.equal(appended, false);
  assert.equal(readRows(logPath).length, 0);
});

test('a stale report left on disk by an earlier killed run is never misread as this run\'s own', () => {
  const { dir, pipelineTestDir, reportPath, logPath } = mkFixture();
  // An earlier run's leftover report, still sitting at the SAME reportPath
  // this run will spawn vitest with - the exact shape a killed run leaves
  // behind if the NEXT run's own unlink-before-spawn guard were missing.
  fs.writeFileSync(reportPath, JSON.stringify({ testResults: [{ name: 'test/stale.property.test.js', startTime: 0, endTime: 9999 }] }));
  const vitestBin = writeKilledFakeVitestBin(dir);

  const { exitCode, appended } = runRecorder({ vitestBin, reportPath, logPath, cwd: dir, pipelineTestDir });

  assert.notEqual(exitCode, 0);
  assert.equal(appended, false, 'expected the stale report never to be read as a completed run');
  assert.equal(readRows(logPath).length, 0);
  assert.equal(fs.existsSync(reportPath), false, 'expected the stale report to be removed before the killed run could leave it misread');
});

// BL-1619 scenario 04 ─────────────────────────────────────────────────

// BL-1619 QA bounce D3: the fake's canned report never varies with its
// arguments, so comparing REPORT CONTENT alone (the pre-bounce shape,
// kept below since it is still a true claim) is vacuous - it cannot fail
// against a recorder that silently drops or mutates an argument (the
// bounce's own mutant dropped `--config`). The argv comparison is what
// actually proves the recorder spawns the identical command a correct,
// hand-built invocation would, including the forwarded extraArgs file
// filter (QA's own "e.g. both with a file filter").
function directAndThroughArgv(dir, extraArgs) {
  const vitestBin = writeFakeVitestBin(dir, { exitCode: 0 });
  const { execFileSync } = require('node:child_process');

  const directReportPath = path.join(dir, 'direct-report.json');
  execFileSync(vitestBin, [
    'run',
    '--config',
    'vitest.properties.config.mjs',
    '--reporter=default',
    '--reporter=json',
    `--outputFile=${directReportPath}`,
    ...extraArgs,
  ]);
  const directReport = JSON.parse(fs.readFileSync(directReportPath, 'utf8'));

  const throughReportPath = path.join(dir, 'through-report.json');
  const throughLogPath = path.join(dir, 'through.jsonl');
  const outcome = runRecorder({ vitestBin, reportPath: throughReportPath, logPath: throughLogPath, cwd: dir, extraArgs });
  const throughReport = JSON.parse(fs.readFileSync(throughReportPath, 'utf8'));

  return {
    outcome,
    directReport,
    throughReport,
    directArgv: readFakeVitestArgv(directReportPath),
    throughArgv: readFakeVitestArgv(throughReportPath),
  };
}

test('the recorder changes nothing about which files vitest reports, their order or their result, with a file filter forwarded', () => {
  const { dir } = mkFixture();
  const { directReport, throughReport, directArgv, throughArgv } = directAndThroughArgv(dir, ['test/pole.property.test.js']);

  assert.deepEqual(throughReport.testResults, directReport.testResults);
  assert.deepEqual(throughArgv, directArgv, `expected the recorder to spawn the identical argv a direct invocation would, got through=${JSON.stringify(throughArgv)} direct=${JSON.stringify(directArgv)}`);
});

test('BL-1619 QA bounce D3 non-vacuity: a mutant recorder that drops --config fails the argv comparison', () => {
  const { dir } = mkFixture();
  const vitestBin = writeFakeVitestBin(dir, { exitCode: 0 });
  const { execFileSync } = require('node:child_process');

  const directReportPath = path.join(dir, 'direct-report.json');
  execFileSync(vitestBin, [
    'run',
    '--config',
    'vitest.properties.config.mjs',
    '--reporter=default',
    '--reporter=json',
    `--outputFile=${directReportPath}`,
  ]);

  // The mutant: the same spawnSync call, with '--config', CONFIG_PATH
  // removed - exactly D3's own mutant recorder.
  const { spawnSync } = require('node:child_process');
  const mutantReportPath = path.join(dir, 'mutant-report.json');
  spawnSync(vitestBin, ['run', '--reporter=default', '--reporter=json', `--outputFile=${mutantReportPath}`], { cwd: dir });

  const directArgv = readFakeVitestArgv(directReportPath);
  const mutantArgv = readFakeVitestArgv(mutantReportPath);
  assert.notDeepEqual(mutantArgv, directArgv, 'expected the --config-dropping mutant to produce a different argv than the direct, correct invocation');
});

// BL-1619 QA bounce D1 ───────────────────────────────────────────────

test('runRecorder forwards extraArgs to vitest, as a file filter would be', () => {
  const { dir, reportPath, logPath } = mkFixture();
  const vitestBin = writeFakeVitestBin(dir, { exitCode: 0 });

  runRecorder({ vitestBin, reportPath, logPath, cwd: dir, extraArgs: ['test/pole.property.test.js'] });

  const argv = readFakeVitestArgv(reportPath);
  assert.ok(argv.includes('test/pole.property.test.js'), `expected the filter arg to reach vitest, got: ${JSON.stringify(argv)}`);
});

test('runRecorder appends no row for a filtered run - the census and trend stay whole-lane only', () => {
  const { dir, reportPath, logPath } = mkFixture();
  const vitestBin = writeFakeVitestBin(dir, { exitCode: 0 });

  const { exitCode, appended } = runRecorder({ vitestBin, reportPath, logPath, cwd: dir, extraArgs: ['test/pole.property.test.js'] });

  assert.equal(exitCode, 0, 'a filtered run still reports vitest\'s own exit status');
  assert.equal(appended, false, 'a filtered run must never append a row to the whole-lane log');
  assert.equal(readRows(logPath).length, 0);
});

// BL-2041 QA bounce D1 (pass 4): the fold with the pipeline property run's
// own exit code was untested - every prior test's pipelineTestDir was
// empty, so pipelinePropertyExitCode stayed its 0 default no matter what
// the fold did with it.

test('a whole-lane run folds in a failing pipeline property file even when vitest itself passes', () => {
  const { dir, pipelineTestDir, reportPath, logPath } = mkFixture();
  writeRedPipelinePropertyTest(pipelineTestDir);
  const vitestBin = writeFakeVitestBin(dir, { exitCode: 0 });

  const { exitCode, appended } = runRecorder({ vitestBin, reportPath, logPath, cwd: dir, pipelineTestDir });

  assert.notEqual(exitCode, 0, 'expected the red pipeline property file to fail the whole-lane run despite vitest passing');
  assert.equal(appended, true);
  const rows = readRows(logPath);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].result, 'fail');
});

test('a filtered run never runs the pipeline property files, even when the fixture dir holds a red one', () => {
  const { dir, pipelineTestDir, reportPath, logPath } = mkFixture();
  writeRedPipelinePropertyTest(pipelineTestDir);
  const vitestBin = writeFakeVitestBin(dir, { exitCode: 0 });

  const { exitCode } = runRecorder({ vitestBin, reportPath, logPath, cwd: dir, pipelineTestDir, extraArgs: ['test/pole.property.test.js'] });

  assert.equal(exitCode, 0, 'expected the filtered run to ignore the pipeline property files entirely and report vitest\'s own exit status');
});
