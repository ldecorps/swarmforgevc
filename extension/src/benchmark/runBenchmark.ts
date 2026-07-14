import { aggregateModelTrials, excludedModelAggregate } from './aggregate';
import { autonomyExclusionReason, canActAutonomously } from './providerCapability';
import { rankModels } from './rank';
import { buildBenchmarkReport } from './report';
import { runTrial, RunTrialDeps } from './runTrial';
import { checkTaskSoundness } from './taskSoundness';
import { BenchmarkModelConfig, BenchmarkReport, ModelAggregate, RefusedTask, TaskSpec, TrialOutcome } from './types';

export interface RunBenchmarkParams {
  // BL-386: a battery of several tasks - was a single task.
  tasks: TaskSpec[];
  models: BenchmarkModelConfig[];
  repetitions: number;
  qualityThreshold: number;
  generatedAtIso: string;
  deps: RunTrialDeps;
}

// BL-386: every SOUND task in the battery, every repetition, in order -
// one model's runs[] now spans the whole battery, so its aggregate
// (aggregateModelTrials) reflects the model's showing across all of it
// (acceptance scenario 03), not one task.
async function runModel(tasks: TaskSpec[], model: BenchmarkModelConfig, repetitions: number, deps: RunTrialDeps): Promise<ModelAggregate> {
  if (!canActAutonomously(model.provider)) {
    return excludedModelAggregate(model, autonomyExclusionReason(model.provider) as string);
  }
  const runs: TrialOutcome[] = [];
  for (const task of tasks) {
    for (let repetition = 1; repetition <= repetitions; repetition++) {
      runs.push(await runTrial(task, model, repetition, deps));
    }
  }
  return aggregateModelTrials(model, runs);
}

// BL-386 acceptance scenario 05: every task is validated against its own
// reference solution BEFORE any model runs - a task that cannot pass its
// own tests is refused (never run against a model, never silently
// dropped either - it is recorded in refusedTasks on the report).
async function soundAndRefusedTasks(tasks: TaskSpec[], deps: RunTrialDeps): Promise<{ sound: TaskSpec[]; refused: RefusedTask[] }> {
  const sound: TaskSpec[] = [];
  const refused: RefusedTask[] = [];
  for (const task of tasks) {
    const check = await checkTaskSoundness(task, { evaluator: deps.evaluator, scratchRoot: deps.scratchRoot });
    if (check.sound) {
      sound.push(task);
    } else {
      refused.push({ taskId: task.id, reason: check.reason as string });
    }
  }
  return { sound, refused };
}

// Top-level orchestrator: every SOUND task in the battery, against every
// configured model, in order (never concurrent - repeated real CLI
// invocations against the same provider account are kept sequential and
// bounded, not fanned out unboundedly), each starting from the same
// pinned fixture per task (acceptance scenario 01, extended to "every
// task" by scenario 01 of this same ticket).
export async function runBenchmark(params: RunBenchmarkParams): Promise<BenchmarkReport> {
  const { sound: soundTasks, refused: refusedTasks } = await soundAndRefusedTasks(params.tasks, params.deps);

  const models: ModelAggregate[] = [];
  for (const model of params.models) {
    models.push(await runModel(soundTasks, model, params.repetitions, params.deps));
  }
  const ranking = rankModels(models, params.qualityThreshold);
  return buildBenchmarkReport({
    generatedAtIso: params.generatedAtIso,
    taskIds: soundTasks.map((t) => t.id),
    refusedTasks,
    qualityThreshold: params.qualityThreshold,
    models,
    ranking,
  });
}
