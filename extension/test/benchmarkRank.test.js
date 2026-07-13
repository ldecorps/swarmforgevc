const assert = require('node:assert/strict');
const { rankModels } = require('../out/benchmark/rank');

function agg(overrides) {
  return {
    modelId: 'm',
    provider: 'claude',
    model: 'x',
    label: 'x',
    excluded: false,
    exclusionReason: null,
    repetitions: 1,
    meanQuality: 0,
    qualityStdDev: 0,
    meanCostUsd: null,
    costStdDev: null,
    meanDurationMs: 0,
    meanTokens: null,
    runs: [],
    ...overrides,
  };
}

test('ranks best by quality, best by value, and cheapest acceptable', () => {
  const expensive = agg({ modelId: 'expensive', meanQuality: 0.95, meanCostUsd: 1.0 }); // ratio 0.95
  const value = agg({ modelId: 'value', meanQuality: 0.9, meanCostUsd: 0.1 }); // ratio 9.0 (best)
  const cheap = agg({ modelId: 'cheap', meanQuality: 0.5, meanCostUsd: 0.06 }); // ratio 8.33, cheapest priced
  const ranking = rankModels([expensive, value, cheap], 0.5);
  assert.equal(ranking.bestByQuality, 'expensive');
  assert.equal(ranking.bestByValue, 'value');
  assert.equal(ranking.cheapestAcceptable, 'cheap');
  assert.equal(ranking.noAcceptableModelReason, null);
});

test('states a reason, not a silent null, when nothing meets the threshold', () => {
  const low = agg({ modelId: 'low', meanQuality: 0.2, meanCostUsd: 0.01 });
  const ranking = rankModels([low], 0.8);
  assert.equal(ranking.cheapestAcceptable, null);
  assert.match(ranking.noAcceptableModelReason, /0\.8/);
});

test('excluded models are never ranked', () => {
  const excluded = agg({ modelId: 'excluded', excluded: true, meanQuality: 1, meanCostUsd: 0.001 });
  const real = agg({ modelId: 'real', meanQuality: 0.6, meanCostUsd: 0.5 });
  const ranking = rankModels([excluded, real], 0.5);
  assert.equal(ranking.bestByQuality, 'real');
  assert.equal(ranking.cheapestAcceptable, 'real');
});

test('with no eligible candidates at all, every ranking slot is null with a stated reason', () => {
  const ranking = rankModels([agg({ excluded: true })], 0.5);
  assert.equal(ranking.bestByQuality, null);
  assert.equal(ranking.bestByValue, null);
  assert.equal(ranking.cheapestAcceptable, null);
  assert.ok(ranking.noAcceptableModelReason);
});
