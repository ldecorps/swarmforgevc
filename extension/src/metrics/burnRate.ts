import { TranscriptUsageRecord, UsageTotals, readTranscriptUsage } from './transcriptUsage';
import { RoleWorktree, groupRolesByWorktreePath, combinedRoleKey } from './swarmMetrics';

// BL-273: a LIVE per-agent token burn-rate (tokens/hr), distinct from
// BL-100's daily aggregates - the recent rolling window this reads reacts
// to bursts/idle within minutes, not a calendar day. Mirrors costTelemetry's
// own split: computeBurnRateTokensPerHour is the one PURE function (fixture
// records + an injected nowMs in, a number out); computeBurnRateForRoles is
// the thin impure orchestrator that reads each role's transcripts (via the
// SAME readTranscriptUsage reader BL-100 already uses - no second reader).

const MS_PER_HOUR = 60 * 60 * 1000;

// Named + trivially tunable, per the ticket's own wording.
export const DEFAULT_BURN_RATE_WINDOW_MS = 15 * 60 * 1000;

function totalTokens(usage: UsageTotals): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
}

// Pure: sums a role's total (input+output+cache) tokens whose transcript
// timestamp falls in the trailing [nowMs - windowMs, nowMs] window, then
// extrapolates that window's throughput to a tokens/hr rate. A role with no
// in-window records reads a real 0, never null/omitted (burn-rate-02).
export function computeBurnRateTokensPerHour(
  records: TranscriptUsageRecord[],
  nowMs: number,
  windowMs: number = DEFAULT_BURN_RATE_WINDOW_MS
): number {
  const windowStartMs = nowMs - windowMs;
  const windowTokens = records
    .filter((r) => r.timestampMs >= windowStartMs && r.timestampMs <= nowMs)
    .reduce((sum, r) => sum + totalTokens(r.usage), 0);
  return windowTokens / (windowMs / MS_PER_HOUR);
}

// BL-324: the ABSOLUTE token sum across a bounded span [startMs, endMs] -
// distinct from computeBurnRateTokensPerHour's own EXTRAPOLATED tokens/hr
// rate. A park cycle's real cost is a bounded total (how many tokens the
// cold-start actually burned), never a rate normalized to an hour.
export function sumTokensInSpan(records: TranscriptUsageRecord[], startMs: number, endMs: number): number {
  return records
    .filter((r) => r.timestampMs >= startMs && r.timestampMs <= endMs)
    .reduce((sum, r) => sum + totalTokens(r.usage), 0);
}

export interface ParkCycleCostReport {
  coldStartTokens: number;
  warmIdleBaselineTokens: number;
  // Positive: parking saved tokens. Negative: the park/unpark churn cost
  // MORE than leaving the role warm and idle would have - a loss, per the
  // ticket's own "measure, do not assume; report a loss rather than
  // shipping one" instruction.
  deltaTokens: number;
  isLoss: boolean;
}

// BL-324: composes the EXISTING burn-rate meter (reused, never a second
// reader) with the new bounded-span sum above to answer "did parking this
// role save tokens, or did the churn cost more than leaving it warm would
// have?" - the ticket's own scope item 6/E2E procedure (f). coldStartTokens
// is the REAL cost actually measured right after the role came back up
// (unpark -> unpark + coldStartWindowMs); warmIdleBaselineTokens is a
// COUNTERFACTUAL estimate - the role's own PRIOR idle burn rate (measured
// in the window immediately before it was parked, so it reflects THIS
// role's own recent idle cost, never a guessed constant) extrapolated
// across the actual parked duration. Never itself decides policy (slice 4
// tunes that) - this only measures and reports, honestly, including a
// negative delta.
export function measureParkCycleCost(
  records: TranscriptUsageRecord[],
  parkedAtMs: number,
  unparkedAtMs: number,
  coldStartWindowMs: number,
  priorIdleWindowMs: number = DEFAULT_BURN_RATE_WINDOW_MS
): ParkCycleCostReport {
  const coldStartTokens = sumTokensInSpan(records, unparkedAtMs, unparkedAtMs + coldStartWindowMs);
  const priorIdleRecords = records.filter((r) => r.timestampMs >= parkedAtMs - priorIdleWindowMs && r.timestampMs < parkedAtMs);
  const priorIdleTokensPerHour = computeBurnRateTokensPerHour(priorIdleRecords, parkedAtMs, priorIdleWindowMs);
  const parkedDurationMs = Math.max(0, unparkedAtMs - parkedAtMs);
  const warmIdleBaselineTokens = priorIdleTokensPerHour * (parkedDurationMs / MS_PER_HOUR);
  const deltaTokens = warmIdleBaselineTokens - coldStartTokens;
  return { coldStartTokens, warmIdleBaselineTokens, deltaTokens, isLoss: deltaTokens < 0 };
}

// The one impure entry point: reads each DISTINCT worktreePath's transcript
// usage exactly once (reusing BL-100's readTranscriptUsage) and delegates to
// the pure rate function above. A role with no transcript directory
// degrades to a 0 rate, matching readTranscriptUsage's own "missing dir ->
// []" degradation (cost-07). BL-312: two or more roles sharing one
// worktreePath (the master-resident collision) report ONE combined rate
// under a joined key instead of the same full rate independently under
// each role's own name - a role on its own distinct worktreePath is
// unaffected (its group is a singleton, key = its own role name).
export function computeBurnRateForRoles(
  targetPath: string,
  roles: RoleWorktree[],
  nowMs: number = Date.now(),
  windowMs: number = DEFAULT_BURN_RATE_WINDOW_MS,
  claudeProjectsDir?: string
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const group of groupRolesByWorktreePath(roles)) {
    const records = readTranscriptUsage(group[0].worktreePath, claudeProjectsDir);
    result[combinedRoleKey(group)] = computeBurnRateTokensPerHour(records, nowMs, windowMs);
  }
  return result;
}
