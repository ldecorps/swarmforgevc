import { loadTaskPrompt, materializeTaskFixture } from './taskFixture';
import { BenchmarkModelConfig, ModelExecutor, QualityEvaluator, TaskSpec, TrialOutcome } from './types';

export interface RunTrialDeps {
  executor: ModelExecutor;
  evaluator: QualityEvaluator;
  scratchRoot: string;
}

// One model, one repetition: fresh pinned starting state in, a scored
// outcome out. A model that fails to execute (timeout, crash, auth error)
// scores 0 rather than being silently dropped - it still occupies a slot
// in the report, carrying its error.
export async function runTrial(
  task: TaskSpec,
  model: BenchmarkModelConfig,
  repetition: number,
  deps: RunTrialDeps
): Promise<TrialOutcome> {
  const scratchDir = materializeTaskFixture(task, deps.scratchRoot);
  const prompt = loadTaskPrompt(task);
  const execResult = await deps.executor.execute(prompt, scratchDir, model);

  if (!execResult.success) {
    return {
      modelId: model.id,
      repetition,
      ran: false,
      qualityScore: 0,
      testsPassed: 0,
      testsTotal: 0,
      durationMs: execResult.durationMs,
      costUsd: execResult.costUsd,
      tokens: execResult.tokens,
      sessionId: execResult.sessionId,
      error: execResult.error,
    };
  }

  const { passed, total } = await deps.evaluator.evaluate(scratchDir, task);
  return {
    modelId: model.id,
    repetition,
    ran: true,
    qualityScore: total > 0 ? passed / total : 0,
    testsPassed: passed,
    testsTotal: total,
    durationMs: execResult.durationMs,
    costUsd: execResult.costUsd,
    tokens: execResult.tokens,
    sessionId: execResult.sessionId,
  };
}
