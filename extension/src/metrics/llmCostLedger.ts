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

// Named, fixed horizons (notes: "Horizons (fixed, named)"). Kept as data so
// every reader/surface (CLI, bridge endpoint, sidecar) shares one source of
// truth for what "24h" means in milliseconds.
export const LLM_COST_HORIZONS_MS: Record<string, number> = {
  '3h': 3 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export type LlmCostHorizon = '3h' | '24h' | '7d';

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

// ── origin cost trend series (trend-series-11 .. trend-surface-15) ───────
//
// A rolling 7-day, per-origin spend series for the multi-line trend chart
// the notes call for (PWA cost card + briefing/sidecar). Three logarithmic
// TIME bands sample more finely the closer a bucket is to `nowMs` (Band A:
// last 3h, finest; Band B: 3h-24h ago, medium; Band C: 24h-7d ago,
// coarsest) - the ticket pins only the RELATIVE ordering of bucket widths,
// not their exact values, so DEFAULT_ORIGIN_COST_TREND_BANDS below is the
// one place that pins the concrete widths every reader/surface shares.

export interface OriginCostTrendBand {
  // Reuses the same named-horizon vocabulary as LLM_COST_HORIZONS_MS: the
  // band covers (now - sinceMs, now - <next finer band's sinceMs>], with
  // the finest band (smallest sinceMs) covering (now - sinceMs, now].
  name: LlmCostHorizon;
  sinceMs: number;
  bucketMs: number;
}

export const DEFAULT_ORIGIN_COST_TREND_BANDS: OriginCostTrendBand[] = [
  { name: '3h', sinceMs: LLM_COST_HORIZONS_MS['3h'], bucketMs: 15 * 60 * 1000 },
  { name: '24h', sinceMs: LLM_COST_HORIZONS_MS['24h'], bucketMs: 60 * 60 * 1000 },
  { name: '7d', sinceMs: LLM_COST_HORIZONS_MS['7d'], bucketMs: 6 * 60 * 60 * 1000 },
];

interface TrendBucketRange {
  startMs: number;
  endMs: number;
}

// Pure: expands the band config into concrete, non-overlapping bucket
// ranges spanning the full window, ordered oldest (index 0) to latest
// (last index) - the order buildOriginCostTrendSeries's own buckets array
// inherits directly, satisfying "oldest on the left, latest on the right"
// (trend-series-11) without a separate sort step.
function buildTrendBucketRanges(nowMs: number, bands: OriginCostTrendBand[]): TrendBucketRange[] {
  const bySinceAsc = [...bands].sort((a, b) => a.sinceMs - b.sinceMs);
  const ranges: TrendBucketRange[] = [];
  for (let i = bySinceAsc.length - 1; i >= 0; i -= 1) {
    const band = bySinceAsc[i];
    const bandStartMs = nowMs - band.sinceMs;
    const bandEndMs = i === 0 ? nowMs : nowMs - bySinceAsc[i - 1].sinceMs;
    for (let bucketStart = bandStartMs; bucketStart < bandEndMs; bucketStart += band.bucketMs) {
      ranges.push({ startMs: bucketStart, endMs: Math.min(bucketStart + band.bucketMs, bandEndMs) });
    }
  }
  return ranges;
}

export interface OriginCostTrendBucket {
  bucketStartMs: number;
  bucketEndMs: number;
  costUsd: number;
}

export interface OriginCostTrendSeries {
  key: Record<string, string | null>;
  buckets: OriginCostTrendBucket[];
}

export interface BuildOriginCostTrendSeriesOptions {
  nowMs: number;
  groupBy?: LlmInvocationOriginDimension[];
  bands?: OriginCostTrendBand[];
  topN?: number;
}

// "Same method" per the ticket's trend-graph-10 notes: default groupBy is
// the same origin fingerprint the rollups already use.
const DEFAULT_TREND_GROUP_BY: LlmInvocationOriginDimension[] = ['role', 'trigger', 'script'];
const DEFAULT_TREND_TOP_N = 5;

// Pure: one rolling cost series per distinct origin, bucketed into the
// three time bands, ranked by cost in the RIGHTMOST (latest) bucket
// descending (trend-rank-latest-13) - a lifetime/whole-window total would
// rank a once-expensive-now-quiet origin above a newly expensive one,
// which is exactly the ordering the ticket calls out as wrong. Unpriced
// invocations are skipped per-bucket, never coerced to $0 (unknown-cost-07's
// discipline extended to the trend surface).
export function buildOriginCostTrendSeries(records: LlmInvocationRecord[], options: BuildOriginCostTrendSeriesOptions): OriginCostTrendSeries[] {
  const bands = options.bands ?? DEFAULT_ORIGIN_COST_TREND_BANDS;
  const groupBy = options.groupBy ?? DEFAULT_TREND_GROUP_BY;
  const windowMs = Math.max(...bands.map((band) => band.sinceMs));
  const ranges = buildTrendBucketRanges(options.nowMs, bands);
  const inWindow = records.filter((record) => withinHorizon(record, windowMs, options.nowMs));

  const seriesByKey = new Map<string, OriginCostTrendSeries>();
  for (const record of inWindow) {
    const compositeKey = groupKey(record, groupBy);
    let series = seriesByKey.get(compositeKey);
    if (!series) {
      const key: Record<string, string | null> = {};
      for (const dimension of groupBy) {
        key[dimension] = record.origin[dimension] as string | null;
      }
      series = { key, buckets: ranges.map((range) => ({ bucketStartMs: range.startMs, bucketEndMs: range.endMs, costUsd: 0 })) };
      seriesByKey.set(compositeKey, series);
    }
    if (record.costUsd === null) {
      continue;
    }
    const ms = atMs(record);
    const bucketIndex = ranges.findIndex((range) => ms > range.startMs && ms <= range.endMs);
    if (bucketIndex !== -1) {
      series.buckets[bucketIndex].costUsd += record.costUsd;
    }
  }

  const all = Array.from(seriesByKey.values());
  all.sort((a, b) => latestBucketCost(b) - latestBucketCost(a));
  const topN = options.topN ?? DEFAULT_TREND_TOP_N;
  return all.slice(0, topN);
}

function latestBucketCost(series: OriginCostTrendSeries): number {
  return series.buckets.length > 0 ? series.buckets[series.buckets.length - 1].costUsd : 0;
}

// Pure: log when the priced (>0) cost range across every bucket of every
// given series spans at least a tenfold ratio (trend-log-scale-14),
// otherwise linear. Zero/unpriced buckets never participate in the ratio -
// a single priced bucket (or none at all) is never "log".
export function chooseCostTrendAxisScale(series: OriginCostTrendSeries[]): 'log' | 'linear' {
  let minCostUsd = Infinity;
  let maxCostUsd = 0;
  for (const s of series) {
    for (const bucket of s.buckets) {
      if (bucket.costUsd <= 0) {
        continue;
      }
      minCostUsd = Math.min(minCostUsd, bucket.costUsd);
      maxCostUsd = Math.max(maxCostUsd, bucket.costUsd);
    }
  }
  if (!Number.isFinite(minCostUsd) || maxCostUsd <= 0) {
    return 'linear';
  }
  return maxCostUsd / minCostUsd >= 10 ? 'log' : 'linear';
}
