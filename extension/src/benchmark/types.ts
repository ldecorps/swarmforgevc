// BL-340 slice 1: shared types for the role-benchmark harness. A
// ModelExecutor is the one genuinely-external boundary (an LLM actually
// performing the task) - production wires claudeCliExecutor.ts; tests wire
// a fake, the same "fakeable port" shape recruiter/candidate.ts already
// uses for SignupSource/BatteryGate/RoleTrialRunner.

export interface TaskSpec {
  id: string;
  fixtureDir: string;
  promptFile: string;
  testFile: string;
}

export interface BenchmarkModelConfig {
  id: string;
  provider: string;
  model: string;
  label?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ExecutorResult {
  success: boolean;
  costUsd: number | null;
  tokens: TokenUsage | null;
  durationMs: number;
  sessionId?: string;
  error?: string;
}

export interface ModelExecutor {
  execute(prompt: string, cwd: string, model: BenchmarkModelConfig): Promise<ExecutorResult>;
}

export interface QualityResult {
  passed: number;
  total: number;
}

export interface QualityEvaluator {
  evaluate(cwd: string, task: TaskSpec): Promise<QualityResult>;
}

// BL-387: the diff a model produces is judged by the REAL pipeline review
// chain (cleaner -> architect -> hardener -> QA) before it is ever scored -
// a model's value is the diff that SURVIVES that chain, not its first
// diff. `survived` is false whenever any stage rejects it outright;
// `bounces` counts every stage that had to revise the diff before it could
// proceed, whether or not it ultimately survived.
export interface PipelineReviewResult {
  survived: boolean;
  bounces: number;
}

export interface PipelineOracle {
  // `diffDir` is the SAME scratch directory the model's diff was executed
  // into - a stage that revises the diff edits those files directly, so
  // whatever the caller reads from `diffDir` after review() resolves is
  // exactly what the pipeline accepted, not what the model first produced.
  review(diffDir: string, task: TaskSpec): Promise<PipelineReviewResult>;
}

export interface TrialOutcome {
  // BL-386: which battery task this trial ran - a model's runs[] now spans
  // every task in the battery, not implicitly "the one task", so each run
  // must say which task it belongs to.
  taskId: string;
  modelId: string;
  repetition: number;
  ran: boolean;
  // BL-387: whether the diff survived the pipeline's review chain, and how
  // many rounds of rework (bounces) it took. Both are false/0 when the
  // model never ran at all (ran: false) - there was nothing to review.
  survived: boolean;
  reworkRounds: number;
  qualityScore: number;
  testsPassed: number;
  testsTotal: number;
  durationMs: number;
  costUsd: number | null;
  tokens: TokenUsage | null;
  sessionId?: string;
  error?: string;
}

// BL-386: a model's own showing on ONE task within the battery - the
// per-task breakdown acceptance scenario 02 requires, distinct from the
// ACROSS-THE-WHOLE-BATTERY meanQuality/qualityStdDev on ModelAggregate
// below (scenario 03).
export interface TaskScore {
  taskId: string;
  meanQuality: number;
  qualityStdDev: number;
  repetitions: number;
}

export interface ModelAggregate {
  modelId: string;
  provider: string;
  model: string;
  label: string;
  excluded: boolean;
  exclusionReason: string | null;
  repetitions: number;
  // BL-386: reflects the model's showing across EVERY task in the battery
  // (computed over all runs, not one task's) - the ticket's own load-
  // bearing requirement (scenario 03). meanQuality already reflects
  // survival implicitly (runTrial.ts scores a non-surviving run 0), but
  // BL-388 exposes survivalRate explicitly below so the signal reaches the
  // human legibly rather than staying folded into one averaged number.
  meanQuality: number;
  qualityStdDev: number;
  meanCostUsd: number | null;
  costStdDev: number | null;
  meanDurationMs: number;
  meanTokens: number | null;
  // BL-388: the fraction of this model's runs whose diff survived the
  // pipeline's review chain (BL-387's `survived` signal) - 0 when the
  // model has no runs at all.
  survivalRate: number;
  // BL-388: mean rounds of rework (BL-387's `bounces`) a run needed,
  // across ALL runs (0 for a run that never ran or never bounced) - the
  // signal `meanReworkAdjustedCostUsd` below is priced from.
  meanReworkRounds: number;
  // BL-388: what the model actually cost INCLUDING the rework it caused -
  // each run's own cost priced at (costUsd * (1 + reworkRounds)), then
  // averaged the same way meanCostUsd is. null under the exact same
  // condition as meanCostUsd (no run has a priced cost at all), never
  // independently null - a cheap-first-diff-but-heavy-rework model must
  // not be ranked as cheap on the strength of its first diff alone.
  meanReworkAdjustedCostUsd: number | null;
  taskScores: TaskScore[];
  runs: TrialOutcome[];
}

// BL-386: a task whose OWN reference solution does not pass its OWN tests
// is unsound and never scored against any model (acceptance scenario 05) -
// recorded here so a refused task is visible on the report, never a
// silent drop.
export interface RefusedTask {
  taskId: string;
  reason: string;
}

export interface BenchmarkRanking {
  bestByQuality: string | null;
  // BL-385: set (non-null) exactly when bestByQuality is null because the
  // TOP quality score is shared by 2+ candidates - a real tie, distinct
  // from noAcceptableModelReason below (no candidates at all is a
  // different condition and must never be reported as a tie).
  couldNotDiscriminateReason: string | null;
  bestByValue: string | null;
  // BL-385: true when bestByValue was computed under a quality tie - with
  // quality identical across the top candidates, "best value" reduces to
  // cheapest, which is a defensible answer but must be LABELLED as a
  // ranking on cost alone, never presented as a quality-cost judgement.
  bestByValueRankedByCostAlone: boolean;
  cheapestAcceptable: string | null;
  noAcceptableModelReason: string | null;
}

export interface BenchmarkReport {
  schemaVersion: number;
  generatedAtIso: string;
  // BL-386: a battery of several tasks, not one - was a single taskId.
  taskIds: string[];
  refusedTasks: RefusedTask[];
  qualityThreshold: number;
  qualityThresholdDescription: string;
  provenance: string;
  models: ModelAggregate[];
  ranking: BenchmarkRanking;
}
