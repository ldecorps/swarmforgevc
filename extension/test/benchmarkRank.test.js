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

// ── BL-385: a quality tie is reported as a tie, never a winner ───────────

test('a-tie-is-reported-as-a-tie-01: models that all reach the same quality name no best-by-quality winner, with a stated reason', () => {
  const haiku = agg({ modelId: 'claude-haiku', meanQuality: 1, meanCostUsd: 0.04 });
  const sonnet = agg({ modelId: 'claude-sonnet', meanQuality: 1, meanCostUsd: 0.5 });
  const opus = agg({ modelId: 'claude-opus', meanQuality: 1, meanCostUsd: 1.5 });
  const ranking = rankModels([haiku, sonnet, opus], 0.8);
  assert.equal(ranking.bestByQuality, null);
  assert.ok(ranking.couldNotDiscriminateReason, 'expected a stated reason, not a silent null');
});

test('a-tie-is-reported-as-a-tie-02: a model that genuinely scores higher is still named, with no could-not-discriminate reason', () => {
  const winner = agg({ modelId: 'winner', meanQuality: 0.95, meanCostUsd: 0.5 });
  const tiedPair1 = agg({ modelId: 'tied-1', meanQuality: 0.8, meanCostUsd: 0.1 });
  const tiedPair2 = agg({ modelId: 'tied-2', meanQuality: 0.8, meanCostUsd: 0.2 });
  const ranking = rankModels([winner, tiedPair1, tiedPair2], 0.5);
  assert.equal(ranking.bestByQuality, 'winner');
  assert.equal(ranking.couldNotDiscriminateReason, null);
});

test('a-tie-is-reported-as-a-tie-03: when quality ties, best-value is labelled as ranked by cost alone', () => {
  const haiku = agg({ modelId: 'claude-haiku', meanQuality: 1, meanCostUsd: 0.04 });
  const sonnet = agg({ modelId: 'claude-sonnet', meanQuality: 1, meanCostUsd: 0.5 });
  const ranking = rankModels([haiku, sonnet], 0.8);
  assert.equal(ranking.bestByValue, 'claude-haiku');
  assert.equal(ranking.bestByValueRankedByCostAlone, true);
});

test('best-value is NOT labelled as ranked by cost alone when quality genuinely discriminates', () => {
  const winner = agg({ modelId: 'winner', meanQuality: 0.95, meanCostUsd: 1.0 });
  const other = agg({ modelId: 'other', meanQuality: 0.5, meanCostUsd: 0.1 });
  const ranking = rankModels([winner, other], 0.5);
  assert.equal(ranking.bestByValueRankedByCostAlone, false);
});

test('a-tie-is-reported-as-a-tie-05: the reported result does not depend on the order the models were listed in', () => {
  const haiku = agg({ modelId: 'claude-haiku', meanQuality: 1, meanCostUsd: 0.04 });
  const sonnet = agg({ modelId: 'claude-sonnet', meanQuality: 1, meanCostUsd: 0.5 });
  const opus = agg({ modelId: 'claude-opus', meanQuality: 1, meanCostUsd: 1.5 });
  const forward = rankModels([haiku, sonnet, opus], 0.8);
  const reversed = rankModels([opus, sonnet, haiku], 0.8);
  const shuffled = rankModels([sonnet, opus, haiku], 0.8);
  assert.deepEqual(reversed, forward);
  assert.deepEqual(shuffled, forward);
});

test('a two-way tie among three candidates still swallows no genuine winner (a partial tie is still a tie at the top)', () => {
  const tied1 = agg({ modelId: 'tied-1', meanQuality: 0.9, meanCostUsd: 0.1 });
  const tied2 = agg({ modelId: 'tied-2', meanQuality: 0.9, meanCostUsd: 0.2 });
  const lower = agg({ modelId: 'lower', meanQuality: 0.5, meanCostUsd: 0.05 });
  const ranking = rankModels([tied1, tied2, lower], 0.5);
  assert.equal(ranking.bestByQuality, null);
  assert.ok(ranking.couldNotDiscriminateReason);
});

test('states a reason, not a silent null, when nothing meets the threshold', () => {
  const low = agg({ modelId: 'low', meanQuality: 0.2, meanCostUsd: 0.01 });
  const ranking = rankModels([low], 0.8);
  assert.equal(ranking.cheapestAcceptable, null);
  assert.match(ranking.noAcceptableModelReason, /0\.8/);
});

test('cheapestAcceptable keeps the running cheapest when a later candidate is not cheaper', () => {
  const cheap = agg({ modelId: 'cheap', meanQuality: 0.9, meanCostUsd: 0.05 });
  const pricier = agg({ modelId: 'pricier', meanQuality: 0.9, meanCostUsd: 0.5 });
  const ranking = rankModels([cheap, pricier], 0.5);
  assert.equal(ranking.cheapestAcceptable, 'cheap');
});

test('excluded models are never ranked', () => {
  const excluded = agg({ modelId: 'excluded', excluded: true, meanQuality: 1, meanCostUsd: 0.001 });
  const real = agg({ modelId: 'real', meanQuality: 0.6, meanCostUsd: 0.5 });
  const ranking = rankModels([excluded, real], 0.5);
  assert.equal(ranking.bestByQuality, 'real');
  assert.equal(ranking.cheapestAcceptable, 'real');
});

test('with no eligible candidates at all, every ranking slot is null with a stated reason - never a false tie claim', () => {
  const ranking = rankModels([agg({ excluded: true })], 0.5);
  assert.equal(ranking.bestByQuality, null);
  assert.equal(ranking.bestByValue, null);
  assert.equal(ranking.cheapestAcceptable, null);
  assert.ok(ranking.noAcceptableModelReason);
  assert.equal(ranking.couldNotDiscriminateReason, null, 'no candidates is a different reason than a tie - must not conflate the two');
  assert.equal(ranking.bestByValueRankedByCostAlone, false);
});
