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

export interface TrialOutcome {
  modelId: string;
  repetition: number;
  ran: boolean;
  qualityScore: number;
  testsPassed: number;
  testsTotal: number;
  durationMs: number;
  costUsd: number | null;
  tokens: TokenUsage | null;
  sessionId?: string;
  error?: string;
}

export interface ModelAggregate {
  modelId: string;
  provider: string;
  model: string;
  label: string;
  excluded: boolean;
  exclusionReason: string | null;
  repetitions: number;
  meanQuality: number;
  qualityStdDev: number;
  meanCostUsd: number | null;
  costStdDev: number | null;
  meanDurationMs: number;
  meanTokens: number | null;
  runs: TrialOutcome[];
}

export interface BenchmarkRanking {
  bestByQuality: string | null;
  bestByValue: string | null;
  cheapestAcceptable: string | null;
  noAcceptableModelReason: string | null;
}

export interface BenchmarkReport {
  schemaVersion: number;
  generatedAtIso: string;
  taskId: string;
  qualityThreshold: number;
  qualityThresholdDescription: string;
  provenance: string;
  models: ModelAggregate[];
  ranking: BenchmarkRanking;
}
