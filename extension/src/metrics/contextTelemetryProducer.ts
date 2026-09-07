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

/**
 * BL-1477: the host's unclean shutdown on 2026-08-30 left the store's final
 * line as ~4 KB of NUL bytes with no trailing newline, and this reader threw
 * on it unconditionally - eight days of silence. NUL bytes are stripped from
 * every line before parsing (a record glued onto a zero-filled tail still
 * parses), and a torn FINAL line (still unparseable after stripping, with no
 * whole line after it) is dropped and named rather than treated as damage -
 * the same tail-vs-interior distinction turnProfileProducer.ts's
 * assessTranscriptReadability already draws for transcripts (BL-1364).
 * Interior damage - an unparseable line with a whole line after it - throws,
 * naming the 1-based line number: the store is the dedupe cursor, and
 * recording against a cursor that cannot be read would duplicate.
 */
export function stripNulBytes(text: string): string {
  return text.replace(/\u0000/g, '');
}

export interface PersistedContextEventsRead {
  events: ContextTelemetryRecord[];
  /** 1-based line number of a dropped torn final line, or null when none. */
  tornTailLine: number | null;
}

export function readPersistedContextEvents(telemetryDir: string): PersistedContextEventsRead {
  const filePath = path.join(telemetryDir, 'context-events.jsonl');
  if (!fs.existsSync(filePath)) {
    return { events: [], tornTailLine: null };
  }
  const rawLines = fs.readFileSync(filePath, 'utf8').split('\n');
  const numbered: Array<{ line: string; lineNumber: number }> = [];
  rawLines.forEach((raw, index) => {
    // A genuinely blank line (empty, or whitespace only) in the RAW text is
    // skipped silently - the ordinary gap between records. Blankness is
    // checked on the RAW line, never the NUL-stripped one: a line of
    // nothing but NUL bytes has real (damaged) content and must surface as
    // a torn tail, not vanish as if it were an empty line that was never
    // written at all.
    if (!raw.trim()) {
      return;
    }
    numbered.push({ line: stripNulBytes(raw), lineNumber: index + 1 });
  });
  const parsed: Array<{ ok: true; event: ContextTelemetryRecord } | { ok: false; lineNumber: number }> =
    numbered.map(({ line, lineNumber }) => {
      try {
        return { ok: true, event: JSON.parse(line) as ContextTelemetryRecord };
      } catch {
        return { ok: false, lineNumber };
      }
    });
  const badIndexes = parsed.reduce<number[]>((acc, entry, index) => {
    if (!entry.ok) {
      acc.push(index);
    }
    return acc;
  }, []);
  if (badIndexes.length === 0) {
    return {
      events: parsed.map((entry) => (entry as { ok: true; event: ContextTelemetryRecord }).event),
      tornTailLine: null,
    };
  }
  if (badIndexes.length === 1 && badIndexes[0] === parsed.length - 1) {
    const tornTailLine = numbered[badIndexes[0]].lineNumber;
    return {
      events: parsed
        .slice(0, -1)
        .map((entry) => (entry as { ok: true; event: ContextTelemetryRecord }).event),
      tornTailLine,
    };
  }
  const firstBadLine = numbered[badIndexes[0]].lineNumber;
  throw new Error(`context-events store: unparseable line ${firstBadLine}`);
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

/**
 * BL-1477: the default (no injected recordFn) production path. Recording
 * used to spawn one `bb context_telemetry_cli.bb record` per event with no
 * cap - ~200000 events backlogged behind the torn-tail defect is ~0.3s of
 * subprocess start-up EACH, a day of subprocess time that would overrun the
 * 60s subprocess wait bound every cycle (BL-1454's shape). One `record-batch`
 * spawn per tick, reading JSONL from stdin, is what makes the per-tick cap
 * reachable inside its deadline.
 */
function recordEventsViaCliBatch(repoRoot: string, telemetryDir: string, events: ContextTelemetryRecord[]): void {
  if (events.length === 0) {
    return;
  }
  const cli = path.join(repoRoot, 'swarmforge', 'scripts', 'context_telemetry_cli.bb');
  const input = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
  execFileSync('bb', [cli, 'record-batch'], {
    input,
    encoding: 'utf8',
    env: { ...process.env, CONTEXT_TELEMETRY_STATE_DIR: telemetryDir },
  });
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
  walkTranscriptFiles(transcriptPaths);
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

  if (params.recordFn) {
    for (const event of selected) {
      params.recordFn(event);
    }
  } else if (selected.length > 0) {
    recordEventsViaCliBatch(params.repoRoot, telemetryDir, selected);
  }

  const agents = [...new Set([...existing, ...selected].map((row) => row.agent))];
  return {
    recorded: selected.length,
    skippedDuplicates: allDerived.length - toRecordAll.length,
    agents,
    remaining: remaining.length,
    tornTailLine,
  };
}
