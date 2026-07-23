import { loadTaskPrompt, materializeTaskFixture } from './taskFixture';
import { BenchmarkModelConfig, ModelExecutor, PipelineOracle, QualityEvaluator, TaskSpec, TrialOutcome } from './types';

export interface RunTrialDeps {
  executor: ModelExecutor;
  evaluator: QualityEvaluator;
  oracle: PipelineOracle;
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
      taskId: task.id,
      modelId: model.id,
      repetition,
      ran: false,
      survived: false,
      reworkRounds: 0,
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

  // BL-387: a model's value is the diff that SURVIVES cleaner -> architect
  // -> hardener -> QA, not its first diff - so the diff is judged by the
  // real review chain before it is ever scored. A stage that revises the
  // diff edits scratchDir directly, so the evaluator below - reading from
  // that SAME directory, unconditionally - scores whatever the pipeline
  // actually accepted, never the model's raw output.
  const review = await deps.oracle.review(scratchDir, task);

  if (!review.survived) {
    return {
      taskId: task.id,
      modelId: model.id,
      repetition,
      ran: true,
      survived: false,
      reworkRounds: review.bounces,
      qualityScore: 0,
      testsPassed: 0,
      testsTotal: 0,
      durationMs: execResult.durationMs,
      costUsd: execResult.costUsd,
      tokens: execResult.tokens,
      sessionId: execResult.sessionId,
    };
  }

  const { passed, total } = await deps.evaluator.evaluate(scratchDir, task);
  return {
    taskId: task.id,
    modelId: model.id,
    repetition,
    ran: true,
    survived: true,
    reworkRounds: review.bounces,
    qualityScore: total > 0 ? passed / total : 0,
    testsPassed: passed,
    testsTotal: total,
    durationMs: execResult.durationMs,
    costUsd: execResult.costUsd,
    tokens: execResult.tokens,
    sessionId: execResult.sessionId,
  };
}
