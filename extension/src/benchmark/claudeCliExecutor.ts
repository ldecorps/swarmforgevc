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
      const startedAt = Date.now();
      try {
        const stdout = execFileSync(
          'claude',
          ['-p', prompt, '--model', model.model, '--output-format', 'json', '--dangerously-skip-permissions'],
          { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }
        );
        const parsed = JSON.parse(stdout) as ClaudeCliJsonResult;
        return {
          success: parsed.is_error !== true,
          costUsd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : null,
          tokens: parsed.usage
            ? { inputTokens: parsed.usage.input_tokens ?? 0, outputTokens: parsed.usage.output_tokens ?? 0 }
            : null,
          durationMs: typeof parsed.duration_ms === 'number' ? parsed.duration_ms : Date.now() - startedAt,
          sessionId: parsed.session_id,
        };
      } catch (error) {
        return {
          success: false,
          costUsd: null,
          tokens: null,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
