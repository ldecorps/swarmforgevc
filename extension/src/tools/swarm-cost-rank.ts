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

// hardener note: parseArgs returns null for every "can't proceed" case
// (missing/unknown horizon, non-positive topN) so makeArgsGuardedMain's
// shared usage-and-exit-1 wrapper handles all of them identically - there
// is no separate error path to test beyond "returns null".
export function parseSwarmCostRankArgs(argv: string[]): SwarmCostRankArgs | null {
  const [horizonArg, topNArg, groupByArg] = argv;
  if (!horizonArg || !isKnownLlmCostHorizon(horizonArg)) {
    return null;
  }
  let topN: number | undefined;
  if (topNArg !== undefined) {
    const parsed = Number.parseInt(topNArg, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    topN = parsed;
  }
  const groupBy = (groupByArg ? groupByArg.split(',') : []).filter(isKnownOriginDimension);
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
  const records = readLlmInvocationRecords(mainWorktreePath);
  const horizonMs = LLM_COST_HORIZONS_MS[args.horizon];
  const nowMs = Date.now();

  if (args.groupBy.length > 0) {
    printJsonToStdout(rollupLlmInvocationsByOrigin(records, { horizonMs, nowMs, groupBy: args.groupBy }));
    return;
  }
  printJsonToStdout(rankLlmInvocations(records, { horizonMs, nowMs, topN: args.topN }));
}

if (require.main === module) {
  runCliMain(main);
}
