const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { benchmarkReportPath, writeBenchmarkReport, commitBenchmarkReport } = require('../out/benchmark/reportArtifact');

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-benchmark-artifact-')));
}
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}
function initRepo() {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);
  return root;
}

const REPORT = {
  schemaVersion: 1,
  generatedAtIso: '2026-07-13T00:00:00Z',
  taskId: 't',
  qualityThreshold: 0.8,
  qualityThresholdDescription: 'd',
  provenance: 'p',
  models: [],
  ranking: { bestByQuality: null, bestByValue: null, cheapestAcceptable: null, noAcceptableModelReason: null },
};

test('benchmarkReportPath is deterministic from targetPath and date', () => {
  assert.equal(benchmarkReportPath('/x', '2026-07-13'), path.join('/x', 'docs', 'benchmarks', '2026-07-13.json'));
});

test('writeBenchmarkReport writes the report and commitBenchmarkReport commits ONLY that file', () => {
  const root = initRepo();
  const filePath = writeBenchmarkReport(root, REPORT, '2026-07-13');
  assert.ok(fs.existsSync(filePath));

  const committed = commitBenchmarkReport(root, filePath, REPORT.taskId, '2026-07-13');
  assert.equal(committed, true);

  const log = git(root, ['log', '--oneline', '--', filePath]);
  assert.equal(log.trim().split('\n').filter(Boolean).length, 1);

  const status = git(root, ['status', '--porcelain']);
  assert.equal(status.trim(), '');
});

test('the report can be read back from repository state alone (round-trips)', () => {
  const root = initRepo();
  const filePath = writeBenchmarkReport(root, REPORT, '2026-07-13');
  commitBenchmarkReport(root, filePath, REPORT.taskId, '2026-07-13');

  const readBack = JSON.parse(fs.readFileSync(benchmarkReportPath(root, '2026-07-13'), 'utf8'));
  assert.deepEqual(readBack, REPORT);
});

test('re-writing an unchanged report makes no duplicate commit', () => {
  const root = initRepo();
  const filePath = writeBenchmarkReport(root, REPORT, '2026-07-13');
  commitBenchmarkReport(root, filePath, REPORT.taskId, '2026-07-13');
  writeBenchmarkReport(root, REPORT, '2026-07-13');
  const committedAgain = commitBenchmarkReport(root, filePath, REPORT.taskId, '2026-07-13');
  assert.equal(committedAgain, false);
  const log = git(root, ['log', '--oneline', '--', filePath]);
  assert.equal(log.trim().split('\n').filter(Boolean).length, 1);
});
