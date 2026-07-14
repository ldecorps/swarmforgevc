import { aggregateModelTrials, excludedModelAggregate } from './aggregate';
import { autonomyExclusionReason, canActAutonomously } from './providerCapability';
import { rankModels } from './rank';
import { buildBenchmarkReport } from './report';
import { runTrial, RunTrialDeps } from './runTrial';
import { BenchmarkModelConfig, BenchmarkReport, ModelAggregate, TaskSpec, TrialOutcome } from './types';

export interface RunBenchmarkParams {
  task: TaskSpec;
  models: BenchmarkModelConfig[];
  repetitions: number;
  qualityThreshold: number;
  generatedAtIso: string;
  deps: RunTrialDeps;
}

async function runModel(task: TaskSpec, model: BenchmarkModelConfig, repetitions: number, deps: RunTrialDeps): Promise<ModelAggregate> {
  if (!canActAutonomously(model.provider)) {
    return excludedModelAggregate(model, autonomyExclusionReason(model.provider) as string);
  }
  const runs: TrialOutcome[] = [];
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    runs.push(await runTrial(task, model, repetition, deps));
  }
  return aggregateModelTrials(model, runs);
}

// Top-level orchestrator: every configured model, in order (never
// concurrent - repeated real CLI invocations against the same provider
// account are kept sequential and bounded, not fanned out unboundedly),
// each starting from the same pinned fixture (acceptance scenario 01).
export async function runBenchmark(params: RunBenchmarkParams): Promise<BenchmarkReport> {
  const models: ModelAggregate[] = [];
  for (const model of params.models) {
    models.push(await runModel(params.task, model, params.repetitions, params.deps));
  }
  const ranking = rankModels(models, params.qualityThreshold);
  return buildBenchmarkReport({
    generatedAtIso: params.generatedAtIso,
    taskId: params.task.id,
    qualityThreshold: params.qualityThreshold,
    models,
    ranking,
  });
}
