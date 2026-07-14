const assert = require('node:assert/strict');
const { computeMean, computeStdDev, aggregateModelTrials, excludedModelAggregate } = require('../out/benchmark/aggregate');

test('computeMean of an empty array is 0', () => {
  assert.equal(computeMean([]), 0);
});

test('computeStdDev of an empty array is 0', () => {
  assert.equal(computeStdDev([]), 0);
});

test('computeStdDev is 0 when all values are equal', () => {
  assert.equal(computeStdDev([1, 1, 1]), 0);
});

test('computeStdDev is nonzero for varying values', () => {
  assert.ok(computeStdDev([1, 2, 3]) > 0);
});

function outcome(overrides) {
  return {
    modelId: 'm',
    repetition: 1,
    ran: true,
    qualityScore: 1,
    testsPassed: 1,
    testsTotal: 1,
    durationMs: 100,
    costUsd: 0.01,
    tokens: { inputTokens: 10, outputTokens: 20 },
    ...overrides,
  };
}

test('aggregateModelTrials computes mean/stddev quality and cost across runs', () => {
  const model = { id: 'm', provider: 'claude', model: 'sonnet' };
  const runs = [outcome({ qualityScore: 0.5, costUsd: 0.01 }), outcome({ qualityScore: 1, costUsd: 0.03 })];
  const agg = aggregateModelTrials(model, runs);
  assert.equal(agg.repetitions, 2);
  assert.equal(agg.meanQuality, 0.75);
  assert.ok(agg.qualityStdDev > 0);
  assert.equal(agg.meanCostUsd, 0.02);
  assert.equal(agg.excluded, false);
});

test('excludedModelAggregate never ran a trial and carries its reason', () => {
  const agg = excludedModelAggregate({ id: 'm', provider: 'aider', model: 'mistral' }, 'cannot execute shell actions autonomously');
  assert.equal(agg.excluded, true);
  assert.equal(agg.repetitions, 0);
  assert.equal(agg.exclusionReason, 'cannot execute shell actions autonomously');
});
