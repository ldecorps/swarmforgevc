const assert = require('node:assert/strict');
const { buildBenchmarkReport, qualityThresholdDescription, BENCHMARK_REPORT_SCHEMA_VERSION } = require('../out/benchmark/report');

test('qualityThresholdDescription states the numeric threshold', () => {
  assert.match(qualityThresholdDescription(0.8), /0\.8/);
});

test('buildBenchmarkReport assembles every field the acceptance contract needs', () => {
  const ranking = { bestByQuality: 'a', bestByValue: 'a', cheapestAcceptable: 'a', noAcceptableModelReason: null };
  const report = buildBenchmarkReport({
    generatedAtIso: '2026-07-13T00:00:00Z',
    taskId: 't-1',
    qualityThreshold: 0.8,
    models: [],
    ranking,
  });
  assert.equal(report.schemaVersion, BENCHMARK_REPORT_SCHEMA_VERSION);
  assert.equal(report.taskId, 't-1');
  assert.equal(report.qualityThreshold, 0.8);
  assert.match(report.qualityThresholdDescription, /0\.8/);
  assert.ok(report.provenance.length > 0);
  assert.deepEqual(report.ranking, ranking);
});
