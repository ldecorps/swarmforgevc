import { BenchmarkModelConfig, ModelAggregate, TaskScore, TrialOutcome } from './types';

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

// The "no data at all" fallback (null, not 0 - an empty sample is not a
// sample of zero) shared by every mean/stdDev field below that can go
// unpriced (meanCostUsd, meanTokens, meanReworkAdjustedCostUsd, and their
// stdDev siblings).
function meanOrNull(values: number[]): number | null {
  return values.length > 0 ? computeMean(values) : null;
}

function stdDevOrNull(values: number[]): number | null {
  return values.length > 0 ? computeStdDev(values) : null;
}

// BL-388: one run's cost, priced to include the rework it caused - a run
// that bounced through N rounds of review effectively cost N+1 passes,
// not just its first-pass invocation cost. null only when the run itself
// has no priced cost at all (mirrors costUsd's own null semantics).
function reworkAdjustedCost(run: TrialOutcome): number | null {
  return run.costUsd !== null ? run.costUsd * (1 + run.reworkRounds) : null;
}

// BL-386: the model's showing on EACH task separately (acceptance scenario
// 02) - grouped via a Map to preserve the runs' own encounter order
// (battery order), never object-key iteration order. meanQuality here is
// scoped to one task, distinct from ModelAggregate's own meanQuality
// (across the WHOLE battery, scenario 03).
function taskScoresFrom(runs: TrialOutcome[]): TaskScore[] {
  const byTask = new Map<string, TrialOutcome[]>();
  for (const run of runs) {
    const existing = byTask.get(run.taskId);
    if (existing) {
      existing.push(run);
    } else {
      byTask.set(run.taskId, [run]);
    }
  }
  return [...byTask.entries()].map(([taskId, taskRuns]) => {
    const qualities = taskRuns.map((r) => r.qualityScore);
    return { taskId, meanQuality: computeMean(qualities), qualityStdDev: computeStdDev(qualities), repetitions: taskRuns.length };
  });
}

// Repeated runs of the SAME model (acceptance scenario 06) collapse into
// one aggregate carrying both the mean and the spread - qualityStdDev/
// costStdDev are how "a real difference vs. noise" is reported, never
// hidden behind a single averaged number.
export function aggregateModelTrials(model: BenchmarkModelConfig, runs: TrialOutcome[]): ModelAggregate {
  const qualities = runs.map((r) => r.qualityScore);
  const costs = runs.filter((r) => r.costUsd !== null).map((r) => r.costUsd as number);
  const reworkAdjustedCosts = runs.map(reworkAdjustedCost).filter((c): c is number => c !== null);
  const tokens = runs.map(tokenTotal).filter((t): t is number => t !== null);
  const durations = runs.map((r) => r.durationMs);
  const survivedCount = runs.filter((r) => r.survived).length;

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
    meanCostUsd: meanOrNull(costs),
    costStdDev: stdDevOrNull(costs),
    meanDurationMs: computeMean(durations),
    meanTokens: meanOrNull(tokens),
    survivalRate: runs.length > 0 ? survivedCount / runs.length : 0,
    meanReworkRounds: computeMean(runs.map((r) => r.reworkRounds)),
    meanReworkAdjustedCostUsd: meanOrNull(reworkAdjustedCosts),
    taskScores: taskScoresFrom(runs),
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
    survivalRate: 0,
    meanReworkRounds: 0,
    meanReworkAdjustedCostUsd: null,
    taskScores: [],
    runs: [],
  };
}
