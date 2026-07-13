import { BenchmarkModelConfig, ModelAggregate, TrialOutcome } from './types';

export function computeMean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

// Population standard deviation (repetitions are the whole sample this
// benchmark run collected for the model, not a draw from a larger one) -
// the acceptance contract only needs "a real dispersion number", not a
// choice between population/sample estimators.
export function computeStdDev(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const mean = computeMean(values);
  return Math.sqrt(computeMean(values.map((v) => (v - mean) ** 2)));
}

function tokenTotal(outcome: TrialOutcome): number | null {
  return outcome.tokens ? outcome.tokens.inputTokens + outcome.tokens.outputTokens : null;
}

// Repeated runs of the SAME model (acceptance scenario 06) collapse into
// one aggregate carrying both the mean and the spread - qualityStdDev/
// costStdDev are how "a real difference vs. noise" is reported, never
// hidden behind a single averaged number.
export function aggregateModelTrials(model: BenchmarkModelConfig, runs: TrialOutcome[]): ModelAggregate {
  const qualities = runs.map((r) => r.qualityScore);
  const costs = runs.filter((r) => r.costUsd !== null).map((r) => r.costUsd as number);
  const tokens = runs.map(tokenTotal).filter((t): t is number => t !== null);
  const durations = runs.map((r) => r.durationMs);

  return {
    modelId: model.id,
    provider: model.provider,
    model: model.model,
    label: model.label ?? model.id,
    excluded: false,
    exclusionReason: null,
    repetitions: runs.length,
    meanQuality: computeMean(qualities),
    qualityStdDev: computeStdDev(qualities),
    meanCostUsd: costs.length > 0 ? computeMean(costs) : null,
    costStdDev: costs.length > 0 ? computeStdDev(costs) : null,
    meanDurationMs: computeMean(durations),
    meanTokens: tokens.length > 0 ? computeMean(tokens) : null,
    runs,
  };
}

// A structurally-incapable model (providerCapability.ts) never runs a
// trial at all - this is its report entry: present, visibly excluded, and
// never eligible for ranking (rank.ts filters on `excluded`).
export function excludedModelAggregate(model: BenchmarkModelConfig, reason: string): ModelAggregate {
  return {
    modelId: model.id,
    provider: model.provider,
    model: model.model,
    label: model.label ?? model.id,
    excluded: true,
    exclusionReason: reason,
    repetitions: 0,
    meanQuality: 0,
    qualityStdDev: 0,
    meanCostUsd: null,
    costStdDev: null,
    meanDurationMs: 0,
    meanTokens: null,
    runs: [],
  };
}
