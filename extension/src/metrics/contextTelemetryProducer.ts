import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { TranscriptUsageRecord, listTranscriptJsonlPaths, readTranscriptUsage } from './transcriptUsage';
import { walkTranscriptFiles } from './transcriptWalker';
import { RoleWorktree, combinedRoleKey, groupRolesByWorktreePath } from './swarmMetrics';

// BL-665: deterministic transcript-walker producer for GH-22's context-events
// store. Reuses BL-664's walkTranscriptFiles (read-only taxonomy pass) and
// BL-100's readTranscriptUsage (token/model/timestamp extraction) — ONE
// walker substrate, no second parser. Idempotent via agent+session_id+timestamp.

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;

const COMPACTION_PRIOR_MIN_TOKENS = 80_000;
const COMPACTION_DROP_RATIO = 0.5;

export interface ContextTelemetryRecord {
  agent: string;
  role: string;
  session_id: string;
  timestamp: string;
  input_tokens: number;
  output_tokens: number;
  context_utilization_pct: number;
  compaction: boolean;
  provider: string;
  model: string;
}

export function eventDedupeKey(
  record: Pick<ContextTelemetryRecord, 'agent' | 'session_id' | 'timestamp'>
): string {
  return `${record.agent}:${record.session_id}:${record.timestamp}`;
}

export function contextUtilizationPct(
  inputTokens: number,
  contextWindowTokens = DEFAULT_CONTEXT_WINDOW_TOKENS
): number {
  if (contextWindowTokens <= 0) {
    return 0;
  }
  return Math.min(100, (inputTokens / contextWindowTokens) * 100);
}

export function isCompactionAfterPrior(priorInputTokens: number | undefined, inputTokens: number): boolean {
  if (priorInputTokens === undefined) {
    return false;
  }
  if (priorInputTokens < COMPACTION_PRIOR_MIN_TOKENS) {
    return false;
  }
  return inputTokens < priorInputTokens * COMPACTION_DROP_RATIO;
}

export function providerForAgentBrand(brand: string | undefined): string {
  if (brand === 'claude') {
    return 'anthropic';
  }
  if (brand === 'codex' || brand === 'openai') {
    return 'openai';
  }
  return brand ?? 'anthropic';
}

export function toIsoTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

export function deriveContextEvent(params: {
  agent: string;
  role: string;
  provider: string;
  record: TranscriptUsageRecord;
  priorInputTokens?: number;
}): ContextTelemetryRecord {
  const { agent, role, provider, record, priorInputTokens } = params;
  return {
    agent,
    role,
    session_id: record.messageId,
    timestamp: toIsoTimestamp(record.timestampMs),
    input_tokens: record.usage.inputTokens,
    output_tokens: record.usage.outputTokens,
    context_utilization_pct: contextUtilizationPct(record.usage.inputTokens),
    compaction: isCompactionAfterPrior(priorInputTokens, record.usage.inputTokens),
    provider,
    model: record.model,
  };
}

export function deriveContextEventsFromUsageRecords(
  agent: string,
  role: string,
  provider: string,
  records: TranscriptUsageRecord[]
): ContextTelemetryRecord[] {
  const sorted = [...records].sort((a, b) => a.timestampMs - b.timestampMs);
  const events: ContextTelemetryRecord[] = [];
  let priorInput: number | undefined;
  for (const record of sorted) {
    events.push(deriveContextEvent({ agent, role, provider, record, priorInputTokens: priorInput }));
    priorInput = record.usage.inputTokens;
  }
  return events;
}

export function readPersistedContextEvents(telemetryDir: string): ContextTelemetryRecord[] {
  const filePath = path.join(telemetryDir, 'context-events.jsonl');
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as ContextTelemetryRecord);
}

export function filterNewContextEvents(
  existing: ContextTelemetryRecord[],
  derived: ContextTelemetryRecord[]
): ContextTelemetryRecord[] {
  const seen = new Set(existing.map(eventDedupeKey));
  return derived.filter((event) => !seen.has(eventDedupeKey(event)));
}

function recordEventViaCli(repoRoot: string, telemetryDir: string, event: ContextTelemetryRecord): void {
  const cli = path.join(repoRoot, 'swarmforge', 'scripts', 'context_telemetry_cli.bb');
  execFileSync(
    'bb',
    [
      cli,
      'record',
      '--agent',
      event.agent,
      '--role',
      event.role,
      '--session-id',
      event.session_id,
      '--timestamp',
      event.timestamp,
      '--input-tokens',
      String(event.input_tokens),
      '--output-tokens',
      String(event.output_tokens),
      '--context-utilization-pct',
      String(event.context_utilization_pct),
      '--compaction',
      event.compaction ? 'true' : 'false',
      '--provider',
      event.provider,
      '--model',
      event.model,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, CONTEXT_TELEMETRY_STATE_DIR: telemetryDir },
    }
  );
}

export function deriveEventsForRoleGroup(
  group: RoleWorktree[],
  provider: string,
  claudeProjectsDir?: string
): ContextTelemetryRecord[] {
  const agent = combinedRoleKey(group);
  const role = group[0].role;
  const worktreePath = group[0].worktreePath;
  const transcriptPaths = listTranscriptJsonlPaths(worktreePath, claudeProjectsDir);
  if (transcriptPaths.length === 0) {
    return [];
  }
  walkTranscriptFiles(transcriptPaths);
  const usageRecords = readTranscriptUsage(worktreePath, claudeProjectsDir);
  return deriveContextEventsFromUsageRecords(agent, role, provider, usageRecords);
}

export interface ContextTelemetryProducerResult {
  recorded: number;
  skippedDuplicates: number;
  agents: string[];
}

export function runContextTelemetryProducer(params: {
  repoRoot: string;
  roleWorktrees: RoleWorktree[];
  providersByRole: Map<string, string>;
  claudeProjectsDir?: string;
  recordFn?: (event: ContextTelemetryRecord) => void;
}): ContextTelemetryProducerResult {
  const telemetryDir = path.join(params.repoRoot, '.swarmforge', 'telemetry');
  const existing = readPersistedContextEvents(telemetryDir);
  const allDerived: ContextTelemetryRecord[] = [];

  for (const group of groupRolesByWorktreePath(params.roleWorktrees)) {
    const brand = params.providersByRole.get(group[0].role);
    const provider = providerForAgentBrand(brand);
    allDerived.push(...deriveEventsForRoleGroup(group, provider, params.claudeProjectsDir));
  }

  const toRecord = filterNewContextEvents(existing, allDerived);
  const recordFn =
    params.recordFn ?? ((event) => recordEventViaCli(params.repoRoot, telemetryDir, event));
  for (const event of toRecord) {
    recordFn(event);
  }

  const agents = [...new Set([...existing, ...toRecord].map((row) => row.agent))];
  return {
    recorded: toRecord.length,
    skippedDuplicates: allDerived.length - toRecord.length,
    agents,
  };
}
