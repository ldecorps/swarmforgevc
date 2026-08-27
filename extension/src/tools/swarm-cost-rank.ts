#!/usr/bin/env node
// BL-551: prints the top expensive LLM invocations for a named horizon
// (3h/24h/7d) as JSON, with origin attribution - "what burned the most
// tokens recently, and where did it come from." Reads the durable
// `.swarmforge/telemetry/llm-cost-YYYY-MM.jsonl` ledger (appended by
// handoffd.bb/operator_runtime.bb/agent_runtime_inject.bb) via the pure
// llmCostLedger.ts ranking module - same "fs read here, pure logic there"
// split as swarm-metrics.ts.
//
// Usage: node swarm-cost-rank.js <3h|24h|7d> [topN] [groupByDimension,...]
// With a groupBy list, prints rollup groups instead of individual records.
import {
  isKnownLlmCostHorizon,
  LLM_COST_HORIZONS_MS,
  LlmInvocationOriginDimension,
  rankLlmInvocations,
  rollupLlmInvocationsByOrigin,
  isKnownOriginDimension,
} from '../metrics/llmCostLedger';
import { readLlmInvocationRecords } from '../metrics/llmCostLedgerStore';
import { printJsonToStdout, resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

export interface SwarmCostRankArgs {
  horizon: '3h' | '24h' | '7d';
  topN: number | undefined;
  groupBy: LlmInvocationOriginDimension[];
}

const USAGE = 'Usage: swarm-cost-rank.js <3h|24h|7d> [topN] [groupByDimension,...]\n';

// BL-575: the CLI reads the real clock to compute the horizon window, and
// the compiled entry point (scenario-04) runs as a real subprocess, so an
// in-process nowMs parameter alone would not reach it. An env-var override,
// read once at startup, is the documented seam shape for that case
// (engineering-detailed.prompt's daemon-wiring pattern) - unset in
// production, so behavior there is unchanged.
const NOW_MS_OVERRIDE_ENV_VAR = 'SWARMFORGE_COST_RANK_NOW_MS';

export function resolveNowMs(env: NodeJS.ProcessEnv = process.env): number {
  const override = env[NOW_MS_OVERRIDE_ENV_VAR];
  if (override !== undefined) {
    const parsed = Number(override);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

// Pure-ish: fs read plus the two existing pure ranking calls, factored out
// of main() so a test can drive it directly with a controlled nowMs without
// going through argv/env at all.
export function runSwarmCostRank(
  args: SwarmCostRankArgs,
  mainWorktreePath: string,
  nowMs: number
): ReturnType<typeof rankLlmInvocations> | ReturnType<typeof rollupLlmInvocationsByOrigin> {
  const records = readLlmInvocationRecords(mainWorktreePath);
  const horizonMs = LLM_COST_HORIZONS_MS[args.horizon];

  if (args.groupBy.length > 0) {
    return rollupLlmInvocationsByOrigin(records, { horizonMs, nowMs, groupBy: args.groupBy });
  }
  return rankLlmInvocations(records, { horizonMs, nowMs, topN: args.topN });
}

// hardener note: parseArgs returns null for every "can't proceed" case
// (missing/unknown horizon, non-positive topN) so makeArgsGuardedMain's
// shared usage-and-exit-1 wrapper handles all of them identically - there
// is no separate error path to test beyond "returns null".
// Returns undefined for "no topN argument given", null for "given but
// invalid" - split out of parseSwarmCostRankArgs to keep that function's
// CRAP under the hardening threshold.
function parseTopN(topNArg: string | undefined): number | undefined | null {
  if (topNArg === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(topNArg, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function parseSwarmCostRankArgs(argv: string[]): SwarmCostRankArgs | null {
  const [horizonArg, topNArg, groupByArg] = argv;
  if (!horizonArg || !isKnownLlmCostHorizon(horizonArg)) {
    return null;
  }
  const topN = parseTopN(topNArg);
  if (topN === null) {
    return null;
  }
  const parts = groupByArg ? groupByArg.split(',') : [];
  const groupBy = parts.filter(isKnownOriginDimension);
  return { horizon: horizonArg, topN, groupBy };
}

export function main(): void {
  const args = parseSwarmCostRankArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return;
  }
  const { mainWorktreePath } = resolveCliMainWorktreeContext();
  printJsonToStdout(runSwarmCostRank(args, mainWorktreePath, resolveNowMs()));
}

if (require.main === module) {
  runCliMain(main);
}
