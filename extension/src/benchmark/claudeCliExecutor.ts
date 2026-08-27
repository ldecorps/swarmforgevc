import { execFileSync } from 'child_process';
import { BenchmarkModelConfig, ExecutorResult, ModelExecutor } from './types';

interface ClaudeCliJsonResult {
  is_error?: boolean;
  duration_ms?: number;
  total_cost_usd?: number;
  session_id?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// Pure: turns the CLI's own JSON stdout into an ExecutorResult. Split out
// of execute() (mirroring nodeTestQualityEvaluator.ts's own
// parse-vs-shell split in this same parcel) so the parsing logic - the
// actual contract this benchmark depends on - is unit-testable without
// invoking the real `claude` binary; only the execFileSync call itself
// (the genuine external boundary named in types.ts: an LLM actually
// performing the task) stays untested.
export function parseClaudeCliSuccess(stdout: string, fallbackDurationMs: number): ExecutorResult {
  const parsed = JSON.parse(stdout) as ClaudeCliJsonResult;
  return {
    success: parsed.is_error !== true,
    costUsd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : null,
    tokens: parsed.usage
      ? { inputTokens: parsed.usage.input_tokens ?? 0, outputTokens: parsed.usage.output_tokens ?? 0 }
      : null,
    durationMs: typeof parsed.duration_ms === 'number' ? parsed.duration_ms : fallbackDurationMs,
    sessionId: parsed.session_id,
  };
}

// Pure: normalizes whatever the child process throws (an Error, or not)
// into a failed ExecutorResult - a model that fails to execute scores 0
// rather than crashing the benchmark run (see runTrial.ts).
export function claudeCliFailureResult(error: unknown, durationMs: number): ExecutorResult {
  return {
    success: false,
    costUsd: null,
    tokens: null,
    durationMs,
    error: error instanceof Error ? error.message : String(error),
  };
}

// BL-340 hardening (2nd QA bounce, main() untested in-process): E2E test
// seam mirroring notify-dead-letters.ts's/notify-recert-batch.ts's own
// TELEGRAM_NOTIFY_FORCE_RESULT convention exactly - no real `claude`
// subprocess is ever spawned under it. Named per-executor-instance (not a
// blanket "skip everything" flag) so a real main()-in-process test can
// drive every OTHER real collaborator (task fixture, scratch materialize,
// the real node-test evaluator, real git write+commit) and fake only the
// one boundary that is genuinely external: an LLM actually performing the
// task.
export function claudeCliForceResultFromEnv(): ExecutorResult | null {
  const forced = process.env.RUN_ROLE_BENCHMARK_EXECUTOR_FORCE_RESULT;
  return forced ? (JSON.parse(forced) as ExecutorResult) : null;
}

// Real, live invocation of the Claude Code CLI in headless print mode -
// the only ModelExecutor this ticket wires to production
// (extension/src/tools/run-role-benchmark.ts). `--dangerously-skip-permissions`
// is safe here because `cwd` is always a scratch copy materializeTaskFixture
// creates fresh per trial, never the real repository, so the model can act
// autonomously without a human approving each tool call - exactly what "the
// same task, actually executed" (acceptance scenario 07) requires. The
// child process has a bounded timeout (never an unbounded wait) so one
// stuck trial cannot hang the whole benchmark run.
export function createClaudeCliExecutor(timeoutMs: number = DEFAULT_TIMEOUT_MS): ModelExecutor {
  return {
    async execute(prompt: string, cwd: string, model: BenchmarkModelConfig): Promise<ExecutorResult> {
      const forced = claudeCliForceResultFromEnv();
      if (forced) {
        return forced;
      }
      const startedAt = Date.now();
      try {
        const stdout = execFileSync(
          'claude',
          ['-p', prompt, '--model', model.model, '--output-format', 'json', '--dangerously-skip-permissions'],
          { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }
        );
        return parseClaudeCliSuccess(stdout, Date.now() - startedAt);
      } catch (error) {
        return claudeCliFailureResult(error, Date.now() - startedAt);
      }
    },
  };
}
