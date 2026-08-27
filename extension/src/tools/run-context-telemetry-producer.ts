#!/usr/bin/env node
/**
 * BL-665: headless context-telemetry producer — walks role transcripts via
 * BL-664's transcriptWalker and fills GH-22's store through
 * context_telemetry_cli.bb record. Idempotent: re-running over the same
 * transcripts never duplicates records.
 *
 * Usage: node run-context-telemetry-producer.js
 */
import { runContextTelemetryProducer } from '../metrics/contextTelemetryProducer';
import { resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

export function formatProducerResult(result: {
  recorded: number;
  skippedDuplicates: number;
  agents: string[];
}): string {
  if (result.recorded === 0 && result.agents.length === 0) {
    return 'SKIPPED no transcript usage to ingest';
  }
  return `RECORDED ${result.recorded} event(s) for ${result.agents.length} agent(s)`;
}

export function main(): void {
  const { projectRoot, roleWorktrees, roles } = resolveCliMainWorktreeContext();
  const providersByRole = new Map(roles.map((entry) => [entry.role, entry.agent ?? 'claude']));
  const result = runContextTelemetryProducer({ repoRoot: projectRoot, roleWorktrees, providersByRole });
  console.log(formatProducerResult(result));
}

if (require.main === module) {
  runCliMain(main);
}
