import * as path from 'path';
import { TranscriptUsageRecord, listTranscriptJsonlPaths, readTranscriptUsage } from './transcriptUsage';
import { RoleWorktree, combinedRoleKey, groupRolesByWorktreePath } from './swarmMetrics';
import { readPersistedContextEvents, recordEventsViaCliBatch } from './contextTelemetryStore';

export { stripNulBytes, readPersistedContextEvents, PersistedContextEventsRead } from './contextTelemetryStore';

// BL-665: deterministic transcript-walker producer for GH-22's context-events
// store, built on BL-664's walker substrate via BL-100's readTranscriptUsage
// (token/model/timestamp extraction) — one walker substrate, no second
// parser. Idempotent via agent+session_id+timestamp.
//
// BL-1477: deriveEventsForRoleGroup used to also call walkTranscriptFiles
// directly and discard its result (~3.4s per role of pure cost, on top of
// readTranscriptUsage's own walk) - removed, since readTranscriptUsage
// already provides the walker substrate this feature is built on.

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

export function filterNewContextEvents(
  existing: ContextTelemetryRecord[],
  derived: ContextTelemetryRecord[]
): ContextTelemetryRecord[] {
  const seen = new Set(existing.map(eventDedupeKey));
  return derived.filter((event) => !seen.has(eventDedupeKey(event)));
}

/**
 * BL-1477 invariant 2: a tick records at most `cap` events, oldest first,
 * and stops once the clock has PASSED `deadlineMs` since this call started -
 * an event already in progress when the deadline arrives is still recorded
 * (the deadline bounds when the NEXT one may start, not a mid-record abort).
 * `events` must already be sorted oldest-first (invariant 2's own "in
 * timestamp order"); `nowFn` is called once per event actually selected, so
 * the elapsed-time check advances in lockstep with what was recorded, never
 * with wall-clock time this function did not itself observe.
 */
export function selectEventsWithinLimits(
  events: ContextTelemetryRecord[],
  cap: number,
  deadlineMs: number,
  nowFn: () => number
): { selected: ContextTelemetryRecord[]; remaining: ContextTelemetryRecord[] } {
  const start = nowFn();
  const selected: ContextTelemetryRecord[] = [];
  let elapsedMs = 0;
  for (const event of events) {
    if (selected.length >= cap) {
      break;
    }
    if (elapsedMs >= deadlineMs) {
      break;
    }
    selected.push(event);
    elapsedMs = nowFn() - start;
  }
  return { selected, remaining: events.slice(selected.length) };
}

export const DEFAULT_CONTEXT_TELEMETRY_CAP_PER_TICK = 500;
export const DEFAULT_CONTEXT_TELEMETRY_DEADLINE_MS = 30_000;

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
  const usageRecords = readTranscriptUsage(worktreePath, claudeProjectsDir);
  return deriveContextEventsFromUsageRecords(agent, role, provider, usageRecords);
}

export interface ContextTelemetryProducerResult {
  recorded: number;
  skippedDuplicates: number;
  agents: string[];
  /** Events derived and new but not recorded this tick (cap/deadline). */
  remaining: number;
  /** 1-based line number of a torn final line dropped from the store, or null. */
  tornTailLine: number | null;
}

/**
 * Dispatches the selected batch to the injected recordFn when given (every
 * test's fixture path), or to the real production write (BL-1477's
 * recordEventsViaCliBatch) otherwise - extracted out of
 * runContextTelemetryProducer's own body so that function's CRAP reflects
 * its own logic rather than this dispatch's.
 */
function recordSelectedEvents(
  params: { repoRoot: string; recordFn?: (event: ContextTelemetryRecord) => void },
  telemetryDir: string,
  selected: ContextTelemetryRecord[]
): void {
  if (params.recordFn) {
    for (const event of selected) {
      params.recordFn(event);
    }
    return;
  }
  if (selected.length > 0) {
    recordEventsViaCliBatch(params.repoRoot, telemetryDir, selected);
  }
}

export function runContextTelemetryProducer(params: {
  repoRoot: string;
  roleWorktrees: RoleWorktree[];
  providersByRole: Map<string, string>;
  claudeProjectsDir?: string;
  recordFn?: (event: ContextTelemetryRecord) => void;
  nowFn?: () => number;
  capPerTick?: number;
  deadlineMs?: number;
}): ContextTelemetryProducerResult {
  const telemetryDir = path.join(params.repoRoot, '.swarmforge', 'telemetry');
  const { events: existing, tornTailLine } = readPersistedContextEvents(telemetryDir);
  const allDerived: ContextTelemetryRecord[] = [];

  for (const group of groupRolesByWorktreePath(params.roleWorktrees)) {
    const brand = params.providersByRole.get(group[0].role);
    const provider = providerForAgentBrand(brand);
    allDerived.push(...deriveEventsForRoleGroup(group, provider, params.claudeProjectsDir));
  }

  // BL-1477 invariant 2: "in timestamp order" across every derived event,
  // not merely within one role group's own already-sorted slice.
  const toRecordAll = filterNewContextEvents(existing, allDerived).sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp)
  );
  const cap = params.capPerTick ?? DEFAULT_CONTEXT_TELEMETRY_CAP_PER_TICK;
  const deadlineMs = params.deadlineMs ?? DEFAULT_CONTEXT_TELEMETRY_DEADLINE_MS;
  const nowFn = params.nowFn ?? Date.now;
  const { selected, remaining } = selectEventsWithinLimits(toRecordAll, cap, deadlineMs, nowFn);

  recordSelectedEvents(params, telemetryDir, selected);

  const agents = [...new Set([...existing, ...selected].map((row) => row.agent))];
  return {
    recorded: selected.length,
    skippedDuplicates: allDerived.length - toRecordAll.length,
    agents,
    remaining: remaining.length,
    tornTailLine,
  };
}
