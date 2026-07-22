// BL-551: a unified, append-only ledger of LLM invocations across every
// swarm subsystem (pipeline roles, the always-on Operator, front-desk,
// handoffd, the extension host itself), keyed by ORIGIN - where the spend
// came from - not just which model answered. Builds on BL-100 (per-role/
// per-ticket transcript rollups) and BL-511 (exact front-desk $ capture):
// this is the layer that answers "what were the most expensive individual
// invocations recently, and what triggered them" across ALL of those
// sources at once.
//
// Durable store (writers, outside this module): append-only JSONL files at
// `.swarmforge/telemetry/llm-cost-YYYY-MM.jsonl`, one `llm_invocation`
// record per line. This module is the pure read side: ranking and rollups
// over an already-parsed record array plus an injected `nowMs` - no clock,
// no fs, no network, so every scenario is deterministic.
//
// Honest-null discipline (matches pricingTable.ts and telegramBridgeCost.ts):
// an invocation whose cost is unknown carries `costUsd: null` and is
// EXCLUDED from dollar totals - it is never coerced to zero, and it never
// silently vanishes either (the caller can still see the record itself and
// count it separately).

import { LLM_COST_HORIZONS_MS, LlmCostHorizon } from './llmCostTrendSeries';

export { OriginCostTrendBand, DEFAULT_ORIGIN_COST_TREND_BANDS, OriginCostTrendBucket, OriginCostTrendSeries, BuildOriginCostTrendSeriesOptions, buildOriginCostTrendSeries, chooseCostTrendAxisScale, LlmCostHorizon, LLM_COST_HORIZONS_MS } from './llmCostTrendSeries';

export type LlmInvocationSubsystem = 'pipeline' | 'operator' | 'front_desk' | 'daemon' | 'extension';

export type LlmInvocationTrigger =
  | 'handoff'
  | 'chase_nudge'
  | 'open_slot_nudge'
  | 'operator_cmd'
  | 'babysit_tick'
  | 'rotation_wake'
  | 'human_chat'
  | 'reap'
  | 'other';

export type LlmInvocationHandoffType = 'note' | 'git_handoff';

// Every field the notes' ORIGIN block requires (schema-01): where the
// spend came from, down to the model/provider that answered it. `null`
// means "known to be inapplicable / not yet known", never "omitted".
//
// model/provider are nullable: a handoff-delivery correlation record
// (writer-handoff-02) is stamped before the woken role's process has even
// started, so which model will answer is not yet known at write time - the
// same honest-null discipline as `costUsd` extends to these two fields
// rather than fabricating a value.
export interface LlmInvocationOrigin {
  subsystem: LlmInvocationSubsystem;
  role: string | null;
  stage: string | null;
  trigger: LlmInvocationTrigger;
  ticketId: string | null;
  handoffId: string | null;
  handoffType: LlmInvocationHandoffType | null;
  script: string | null;
  pack: string | null;
  model: string | null;
  provider: string | null;
}

export interface LlmInvocationTokens {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
}

export interface LlmInvocationRecord {
  type: 'llm_invocation';
  at: string; // ISO-8601 timestamp of the invocation
  model: string | null;
  tokens: LlmInvocationTokens | null;
  // Provider-reported or estimated cost. null = unknown, never a guessed
  // $0 (see module doc).
  costUsd: number | null;
  origin: LlmInvocationOrigin;
}

export function isKnownLlmCostHorizon(horizon: string): horizon is LlmCostHorizon {
  return Object.prototype.hasOwnProperty.call(LLM_COST_HORIZONS_MS, horizon);
}

function atMs(record: LlmInvocationRecord): number {
  return Date.parse(record.at);
}

// A record is "inside" a horizon window when its timestamp is parseable
// and falls in (nowMs - horizonMs, nowMs] - an unparseable timestamp is
// excluded rather than treated as "always in range".
function withinHorizon(record: LlmInvocationRecord, horizonMs: number, nowMs: number): boolean {
  const ms = atMs(record);
  if (Number.isNaN(ms)) {
    return false;
  }
  return ms > nowMs - horizonMs && ms <= nowMs;
}

// Sort comparator: cost descending, unknown (null) cost sorted after every
// priced row regardless of magnitude, tie-broken by timestamp descending
// (most recent first) - matches the ticket's stated RANKING rule exactly.
function compareByCostDesc(a: LlmInvocationRecord, b: LlmInvocationRecord): number {
  if (a.costUsd === null && b.costUsd === null) {
    return atMs(b) - atMs(a);
  }
  if (a.costUsd === null) {
    return 1;
  }
  if (b.costUsd === null) {
    return -1;
  }
  if (a.costUsd !== b.costUsd) {
    return b.costUsd - a.costUsd;
  }
  return atMs(b) - atMs(a);
}

export interface RankLlmInvocationsOptions {
  horizonMs: number;
  nowMs: number;
  topN?: number;
}

export interface RankedLlmInvocations {
  records: LlmInvocationRecord[];
  totalCostUsd: number;
  unknownCostCount: number;
}

// Pure: filters records to the horizon window, ranks priced-first by cost
// descending, and separately totals ONLY the priced rows (unknown-cost-07:
// an unknown-cost invocation is never counted as zero).
export function rankLlmInvocations(records: LlmInvocationRecord[], options: RankLlmInvocationsOptions): RankedLlmInvocations {
  const inWindow = records.filter((record) => withinHorizon(record, options.horizonMs, options.nowMs));
  const ranked = [...inWindow].sort(compareByCostDesc);
  const topN = options.topN ?? ranked.length;
  let totalCostUsd = 0;
  let unknownCostCount = 0;
  for (const record of inWindow) {
    if (record.costUsd === null) {
      unknownCostCount += 1;
    } else {
      totalCostUsd += record.costUsd;
    }
  }
  return { records: ranked.slice(0, topN), totalCostUsd, unknownCostCount };
}

export type LlmInvocationOriginDimension = 'subsystem' | 'role' | 'stage' | 'trigger' | 'ticketId' | 'script' | 'pack' | 'model' | 'provider';

export const KNOWN_ORIGIN_DIMENSIONS: LlmInvocationOriginDimension[] = [
  'subsystem', 'role', 'stage', 'trigger', 'ticketId', 'script', 'pack', 'model', 'provider',
];

export function isKnownOriginDimension(value: string): value is LlmInvocationOriginDimension {
  return (KNOWN_ORIGIN_DIMENSIONS as string[]).includes(value);
}

export interface LlmCostRollupGroup {
  key: Record<string, string | null>;
  costUsd: number;
  invocationCount: number;
  unknownCostCount: number;
}

export interface RollupLlmInvocationsOptions {
  horizonMs: number;
  nowMs: number;
  groupBy: LlmInvocationOriginDimension[];
}

function groupKey(record: LlmInvocationRecord, groupBy: LlmInvocationOriginDimension[]): string {
  return groupBy.map((dimension) => String(record.origin[dimension])).join('\0');
}

// Pure: sums costUsd (priced rows only) and counts invocations per distinct
// composite origin key, ordered by summed cost descending (group-by-06).
export function rollupLlmInvocationsByOrigin(records: LlmInvocationRecord[], options: RollupLlmInvocationsOptions): LlmCostRollupGroup[] {
  const inWindow = records.filter((record) => withinHorizon(record, options.horizonMs, options.nowMs));
  const groups = new Map<string, LlmCostRollupGroup>();
  for (const record of inWindow) {
    const compositeKey = groupKey(record, options.groupBy);
    let group = groups.get(compositeKey);
    if (!group) {
      const key: Record<string, string | null> = {};
      for (const dimension of options.groupBy) {
        key[dimension] = record.origin[dimension] as string | null;
      }
      group = { key, costUsd: 0, invocationCount: 0, unknownCostCount: 0 };
      groups.set(compositeKey, group);
    }
    group.invocationCount += 1;
    if (record.costUsd === null) {
      group.unknownCostCount += 1;
    } else {
      group.costUsd += record.costUsd;
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.costUsd - a.costUsd);
}

