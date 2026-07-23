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
  try {
    const out = execFileSync('bb', [CLI, ...args], {
      encoding: 'utf8',
      env: { ...process.env, CONTEXT_TELEMETRY_STATE_DIR: path.join(targetPath, '.swarmforge', 'telemetry') },
    });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function emptyContextTelemetrySummary(agent: string): ContextTelemetrySummary {
  return {
    agent,
    session_id: null,
    event_count: 0,
    compaction_count: 0,
    avg_context_utilization_pct: null,
    time_to_first_compaction_ms: null,
    provider: null,
    model: null,
    latest_input_tokens: null,
    latest_output_tokens: null,
    latest_tool_output_tokens: null,
    latest_prompt_engine_tokens: null,
    latest_system_prompt_tokens: null,
    latest_history_tokens: null,
    latest_estimated_cost_usd: null,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function listTelemetryAgents(targetPath: string): string[] {
  const result = runCli(targetPath, ['agents']);
  if (!isPlainObject(result) || !Array.isArray(result.agents)) {
    return [];
  }
  return result.agents;
}

export function summarizeTelemetryForAgent(targetPath: string, agent: string): ContextTelemetrySummary {
  const result = runCli(targetPath, ['summary', '--agent', agent]);
  if (!isPlainObject(result)) {
    return emptyContextTelemetrySummary(agent);
  }
  return result as unknown as ContextTelemetrySummary;
}
