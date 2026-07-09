import { TranscriptUsageRecord, UsageTotals, readTranscriptUsage } from './transcriptUsage';
import { estimateCostUsd } from './pricingTable';
import { TicketHoldingWindow, readRoleHoldingWindows } from './ticketHoldingWindows';
import { RoleWorktree } from './swarmMetrics';

// BL-100 cost-01/02/03: per-agent daily tokens+cost, and per-ticket
// attribution (windowed against a role's actual holding windows, with an
// honest "unattributed" bucket for usage outside every window) - both pure
// over already-read TranscriptUsageRecord[]/TicketHoldingWindow[].
// computeCostTelemetry is the one impure orchestrator (reads transcripts +
// handoff headers once per role).

const DAY_MS = 24 * 60 * 60 * 1000;

function bucketStartMs(ms: number, bucketMs: number): number {
  return Math.floor(ms / bucketMs) * bucketMs;
}

export function sumUsage(records: TranscriptUsageRecord[]): UsageTotals {
  return records.reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + r.usage.inputTokens,
      outputTokens: acc.outputTokens + r.usage.outputTokens,
      cacheCreationTokens: acc.cacheCreationTokens + r.usage.cacheCreationTokens,
      cacheReadTokens: acc.cacheReadTokens + r.usage.cacheReadTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }
  );
}

// Sums cost only across records whose model has a priced entry - an
// unpriced model's usage is simply excluded from the total rather than
// aborting the whole estimate, but a bucket with usage where NONE of it
// could be priced reports null (unknown), never a misleading $0.
function sumCost(records: TranscriptUsageRecord[]): number | null {
  let total = 0;
  let anyPriced = false;
  for (const record of records) {
    const cost = estimateCostUsd(record.usage, record.model);
    if (cost !== null) {
      total += cost;
      anyPriced = true;
    }
  }
  if (anyPriced) {
    return total;
  }
  return records.length === 0 ? 0 : null;
}

export interface AttributedUsage {
  usage: UsageTotals;
  costUsd: number | null;
}

function attributedUsageFor(records: TranscriptUsageRecord[]): AttributedUsage {
  return { usage: sumUsage(records), costUsd: sumCost(records) };
}

// Pure: sums each role's usage into calendar-day buckets (cost-01).
export function computeDailyRoleUsage(
  recordsByRole: Record<string, TranscriptUsageRecord[]>
): Record<string, Record<string, AttributedUsage>> {
  const result: Record<string, Record<string, AttributedUsage>> = {};
  for (const [role, records] of Object.entries(recordsByRole)) {
    const byDay = new Map<number, TranscriptUsageRecord[]>();
    for (const record of records) {
      const day = bucketStartMs(record.timestampMs, DAY_MS);
      if (!byDay.has(day)) {
        byDay.set(day, []);
      }
      byDay.get(day)!.push(record);
    }
    const dayMap: Record<string, AttributedUsage> = {};
    for (const [day, recs] of byDay) {
      dayMap[new Date(day).toISOString()] = attributedUsageFor(recs);
    }
    result[role] = dayMap;
  }
  return result;
}

const UNATTRIBUTED = 'unattributed';

function findHoldingWindow(windows: TicketHoldingWindow[], timestampMs: number): TicketHoldingWindow | undefined {
  return windows.find((w) => timestampMs >= w.startMs && (w.endMs === null || timestampMs < w.endMs));
}

// Pure: attributes each usage record to the ticket whose holding window it
// falls inside; usage outside every window lands in an explicit
// "unattributed" bucket rather than being silently dropped or smeared
// across the nearest ticket (cost-02's own honesty requirement).
export function attributeUsageToTickets(
  records: TranscriptUsageRecord[],
  windows: TicketHoldingWindow[]
): Record<string, AttributedUsage> {
  const sortedWindows = [...windows].sort((a, b) => a.startMs - b.startMs);
  const buckets = new Map<string, TranscriptUsageRecord[]>();

  for (const record of records) {
    const window = findHoldingWindow(sortedWindows, record.timestampMs);
    const key = window ? window.ticketId : UNATTRIBUTED;
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key)!.push(record);
  }

  const result: Record<string, AttributedUsage> = {};
  for (const [key, recs] of buckets) {
    result[key] = attributedUsageFor(recs);
  }
  return result;
}

export interface RoleCostTelemetry {
  byDay: Record<string, AttributedUsage>;
  byTicket: Record<string, AttributedUsage>;
}

// The one impure entry point: reads each role's transcript usage and
// handoff-derived holding windows, then delegates to the pure functions
// above. A role with no transcript directory and no telemetry degrades to
// empty maps, never an error (cost-07).
export function computeCostTelemetry(
  targetPath: string,
  roles: RoleWorktree[],
  claudeProjectsDir?: string
): Record<string, RoleCostTelemetry> {
  const result: Record<string, RoleCostTelemetry> = {};
  for (const role of roles) {
    const records = readTranscriptUsage(role.worktreePath, claudeProjectsDir);
    const windows = readRoleHoldingWindows(role.worktreePath);
    result[role.role] = {
      byDay: computeDailyRoleUsage({ [role.role]: records })[role.role] ?? {},
      byTicket: attributeUsageToTickets(records, windows),
    };
  }
  return result;
}
