#!/usr/bin/env node
/**
 * BL-665: headless context-telemetry producer — walks role transcripts via
 * BL-664's transcriptWalker and fills GH-22's store through
 * context_telemetry_cli.bb record. Idempotent: re-running over the same
 * transcripts never duplicates records.
 *
 * Usage: node run-context-telemetry-producer.js
 */
import {
  ContextTelemetryProducerResult,
  DEFAULT_CONTEXT_TELEMETRY_DEADLINE_MS,
  runContextTelemetryProducer,
} from '../metrics/contextTelemetryProducer';
import { resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

export function formatProducerResult(result: ContextTelemetryProducerResult): string {
  if (result.recorded === 0 && result.agents.length === 0 && !result.tornTailLine) {
    return 'SKIPPED no transcript usage to ingest';
  }
  const tornSuffix = result.tornTailLine ? ` (torn tail dropped at line ${result.tornTailLine})` : '';
  return `RECORDED ${result.recorded} event(s) for ${result.agents.length} agent(s), ${result.remaining} remaining${tornSuffix}`;
}

// BL-1477 invariant 2: a tick's deadline never exceeds one quarter of the
// supervisor's own in-flight-sweep budget (BL-1454's own env-read shape -
// SUPERVISOR_IN_SWEEP_BUDGET_MS, read here rather than imported from
// handoffd.bb, so this stays in lockstep without importing that script). A
// misconfigured override can only make the tick MORE conservative, never
// less.
function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveDeadlineMs(): number {
  return Math.min(
    envMs('CONTEXT_TELEMETRY_TICK_DEADLINE_MS', DEFAULT_CONTEXT_TELEMETRY_DEADLINE_MS),
    Math.floor(envMs('SUPERVISOR_IN_SWEEP_BUDGET_MS', 225_000) / 4)
  );
}

export function main(): void {
  const { projectRoot, roleWorktrees, roles } = resolveCliMainWorktreeContext();
  const providersByRole = new Map(roles.map((entry) => [entry.role, entry.agent ?? 'claude']));
  const result = runContextTelemetryProducer({
    repoRoot: projectRoot,
    roleWorktrees,
    providersByRole,
    deadlineMs: resolveDeadlineMs(),
  });
  console.log(formatProducerResult(result));
}

if (require.main === module) {
  runCliMain(main);
}
