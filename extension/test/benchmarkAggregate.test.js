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
    survived: true,
    reworkRounds: 0,
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
  assert.equal(agg.survivalRate, 0);
  assert.equal(agg.meanReworkRounds, 0);
  assert.equal(agg.meanReworkAdjustedCostUsd, null);
});

// ── BL-388: survival rate and rework-adjusted cost ────────────────────────

test('BL-388 the-ranking-consumes-survival-and-rework-01: survivalRate reflects the fraction of runs that survived the pipeline', () => {
  const model = { id: 'm', provider: 'claude', model: 'sonnet' };
  const runs = [outcome({ survived: true }), outcome({ survived: true }), outcome({ survived: false, qualityScore: 0 })];
  const agg = aggregateModelTrials(model, runs);
  assert.equal(agg.survivalRate, 2 / 3);
});

test('survivalRate is 0 for a model with no runs at all', () => {
  const model = { id: 'm', provider: 'claude', model: 'sonnet' };
  const agg = aggregateModelTrials(model, []);
  assert.equal(agg.survivalRate, 0);
});

test('BL-388: meanReworkAdjustedCostUsd prices each run at costUsd * (1 + reworkRounds), then averages', () => {
  const model = { id: 'm', provider: 'claude', model: 'sonnet' };
  // run 1: 0.01 * (1 + 2) = 0.03; run 2: 0.02 * (1 + 0) = 0.02 -> mean 0.025
  const runs = [outcome({ costUsd: 0.01, reworkRounds: 2 }), outcome({ costUsd: 0.02, reworkRounds: 0 })];
  const agg = aggregateModelTrials(model, runs);
  assert.equal(agg.meanReworkAdjustedCostUsd, 0.025);
  assert.equal(agg.meanReworkRounds, 1);
});

test('meanReworkAdjustedCostUsd is null under the exact same condition as meanCostUsd - no priced run at all', () => {
  const model = { id: 'm', provider: 'claude', model: 'sonnet' };
  const runs = [outcome({ costUsd: null, reworkRounds: 1 })];
  const agg = aggregateModelTrials(model, runs);
  assert.equal(agg.meanCostUsd, null);
  assert.equal(agg.meanReworkAdjustedCostUsd, null);
});
