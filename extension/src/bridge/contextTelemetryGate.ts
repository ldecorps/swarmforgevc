// GH-23 (Context Budget dashboard): shells out to GH-22's
// context_telemetry_cli.bb — the aggregation (compaction counts, average
// utilisation, latest-event snapshot) lives entirely in
// swarmforge/scripts/context_telemetry_lib.bb; this module never
// re-derives it in TypeScript. CONTEXT_TELEMETRY_STATE_DIR points the CLI
// at the TARGET repo's own .swarmforge/telemetry/, not this repo's.

import { execFileSync } from 'child_process';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'context_telemetry_cli.bb');

export interface ContextTelemetrySummary {
  agent?: string | null;
  session_id?: string | null;
  event_count: number;
  compaction_count: number;
  avg_context_utilization_pct: number | null;
  time_to_first_compaction_ms: number | null;
  provider: string | null;
  model: string | null;
  latest_input_tokens: number | null;
  latest_output_tokens: number | null;
  latest_tool_output_tokens: number | null;
  latest_prompt_engine_tokens: number | null;
  latest_system_prompt_tokens: number | null;
  latest_history_tokens: number | null;
  latest_estimated_cost_usd: number | null;
}

function runCli(targetPath: string, args: string[]): unknown {
  const out = execFileSync('bb', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CONTEXT_TELEMETRY_STATE_DIR: path.join(targetPath, '.swarmforge', 'telemetry') },
  });
  return JSON.parse(out);
}

export function listTelemetryAgents(targetPath: string): string[] {
  const result = runCli(targetPath, ['agents']) as { agents: string[] };
  return result.agents;
}

export function summarizeTelemetryForAgent(targetPath: string, agent: string): ContextTelemetrySummary {
  return runCli(targetPath, ['summary', '--agent', agent]) as ContextTelemetrySummary;
}
