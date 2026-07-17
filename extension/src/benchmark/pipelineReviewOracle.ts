import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PipelineOracle, PipelineReviewResult, TaskSpec } from './types';

// BL-387: the diff a model produces is judged by the REAL pipeline review
// chain before it is ever scored - the human's own framing driving this
// epic: "a coder's value isn't its first diff, it's the diff that
// survives cleaner -> architect -> hardener -> QA." Each stage below is
// one one-shot invocation of that role's OWN prompt file (the same
// contract a live swarm role works under), given real file-write access
// to the scratch diff so it can fix what it finds - mirroring
// claudeCliExecutor.ts's `--dangerously-skip-permissions` posture exactly
// (cwd is always a disposable scratch copy, never the real repository).
const REVIEW_STAGES = ['cleaner', 'architect', 'hardender', 'QA'] as const;
export type ReviewStage = (typeof REVIEW_STAGES)[number];

export type ReviewVerdict = 'ACCEPT' | 'REVISED' | 'REJECT';

const VERDICT_PATTERN = /PIPELINE_ORACLE_VERDICT:\s*(ACCEPT|REVISED|REJECT)/;

interface ClaudeCliJsonResult {
  is_error?: boolean;
  result?: string;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// Pure: turns the CLI's own JSON stdout into a verdict - the same stdout
// shape claudeCliExecutor.ts's parseClaudeCliSuccess already relies on
// (an `is_error` flag, a `result` text field). An unparseable response,
// an errored CLI call, or a response missing the verdict marker are ALL
// treated as REJECT, never as a silent ACCEPT - this boundary must never
// report a diff as having survived review when the review itself could
// not actually be read.
export function parseReviewVerdict(stdout: string): ReviewVerdict {
  try {
    const parsed = JSON.parse(stdout) as ClaudeCliJsonResult;
    if (parsed.is_error) {
      return 'REJECT';
    }
    const match = VERDICT_PATTERN.exec(parsed.result ?? '');
    return (match?.[1] as ReviewVerdict | undefined) ?? 'REJECT';
  } catch {
    return 'REJECT';
  }
}

// Pure: the review instruction handed to each stage, built from that
// role's OWN prompt file content so the review is grounded in the same
// contract a live swarm role works under, not a bespoke benchmark-only
// description of the role.
export function reviewPrompt(stage: ReviewStage, rolePromptText: string, task: TaskSpec): string {
  return [
    rolePromptText,
    '',
    `You are reviewing a candidate diff for benchmark task "${task.id}" as the ${stage} role above.`,
    'The diff is already applied to the files in your current working directory.',
    'If it needs no changes from your perspective, make no edits.',
    'If it has fixable issues, fix them directly in the working tree now.',
    'If it has a blocking issue you cannot fix, make no edits and explain why.',
    'End your final message with exactly one line, nothing after it:',
    'PIPELINE_ORACLE_VERDICT: ACCEPT   (nothing needed changing)',
    'PIPELINE_ORACLE_VERDICT: REVISED  (you fixed something)',
    'PIPELINE_ORACLE_VERDICT: REJECT   (blocking issue, unfixable by you)',
  ].join('\n');
}

export function rolePromptPath(repoRoot: string, stage: ReviewStage): string {
  return path.join(repoRoot, 'swarmforge', 'roles', `${stage}.prompt`);
}

// E2E test seam, mirroring claudeCliForceResultFromEnv exactly (same
// convention as notify-dead-letters.ts's TELEGRAM_NOTIFY_FORCE_RESULT) -
// no real `claude` subprocess is ever spawned under it. Named
// per-oracle-instance so a real main()-in-process test can drive every
// OTHER real collaborator and fake only this one genuinely external
// boundary: an LLM actually reviewing the diff.
export function pipelineReviewForceResultFromEnv(): PipelineReviewResult | null {
  const forced = process.env.RUN_ROLE_BENCHMARK_ORACLE_FORCE_RESULT;
  return forced ? (JSON.parse(forced) as PipelineReviewResult) : null;
}

// Pure: drives the review stages in order given an already-resolved verdict
// for each, so the chain's own decision logic - stop immediately on REJECT,
// count one round of rework per REVISED, run every stage through on ACCEPT -
// is unit-testable with scripted verdicts and no real subprocess. Split out
// of createPipelineReviewOracle (mirroring claudeCliExecutor.ts's own
// parse-vs-shell split in this same parcel) so only the per-stage CLI
// invocation itself stays untested; the chain's stop/rework logic that
// review() previously carried inline does not.
export async function runReviewChain(
  stages: readonly ReviewStage[],
  invokeStage: (stage: ReviewStage) => Promise<ReviewVerdict>
): Promise<PipelineReviewResult> {
  let bounces = 0;
  for (const stage of stages) {
    const verdict = await invokeStage(stage);
    if (verdict === 'REJECT') {
      return { survived: false, bounces };
    }
    if (verdict === 'REVISED') {
      bounces += 1;
    }
  }
  return { survived: true, bounces };
}

// Real, live invocation of the pipeline's own review roles in headless
// print mode, one stage at a time, in the SAME order the live swarm
// forwards a parcel (cleaner -> architect -> hardener -> QA). A REJECT
// (or an unparseable/errored response, treated the same by
// parseReviewVerdict) stops the chain immediately - the diff never
// survives. Every REVISED stage counts as one round of rework; the chain
// is bounded by construction (at most one pass per named stage, never an
// open-ended retry loop).
export function createPipelineReviewOracle(repoRoot: string, model: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): PipelineOracle {
  return {
    async review(diffDir: string, task: TaskSpec): Promise<PipelineReviewResult> {
      const forced = pipelineReviewForceResultFromEnv();
      if (forced) {
        return forced;
      }
      return runReviewChain(REVIEW_STAGES, async (stage) => {
        // BL-387 QA bounce: the setup step (reading the stage's own
        // role-prompt file) must degrade to REJECT exactly like a bad CLI
        // response does - a missing/unreadable swarmforge/roles/<stage>.prompt
        // (e.g. a target repo not yet onboarded) is a synchronous throw
        // that, if left outside this boundary, propagates uncaught through
        // runReviewChain -> runTrial -> runModel -> runBenchmark and aborts
        // the ENTIRE run (every model/task/repetition already completed),
        // rather than recording just this one trial as not surviving -
        // mirroring the ModelExecutor sibling boundary in runTrial.ts,
        // which already turns an execution failure into `ran:false`
        // instead of throwing.
        try {
          const rolePromptText = fs.readFileSync(rolePromptPath(repoRoot, stage), 'utf8');
          const prompt = reviewPrompt(stage, rolePromptText, task);
          const stdout = execFileSync(
            'claude',
            ['-p', prompt, '--model', model, '--output-format', 'json', '--dangerously-skip-permissions'],
            { cwd: diffDir, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }
          );
          return parseReviewVerdict(stdout);
        } catch {
          return 'REJECT';
        }
      });
    },
  };
}
