import { RoleCostTelemetry } from './costTelemetry';
import { TicketLifecycleEvent } from './gitHistoryAdapter';
import { TrendSeriesPoint } from './trend';

// BL-338: the human asked for average cost/ticket specifically so he can
// REDUCE it - a number that quietly flatters the swarm would steer his
// reduction effort away from its biggest real cost. Two honesty properties
// this module exists to guarantee, both driven by reuse rather than new
// mechanism:
//   1. Rework from bounces rides this figure for free. A bounced ticket is
//      re-held by a role more than once, and EACH hold opens its own entry
//      in ticketHoldingWindows.ts's window list; attributeUsageToTickets
//      (costTelemetry.ts) buckets every window's usage under the same
//      ticketId regardless of which hold produced it. Summing a role's
//      byTicket[ticketId] therefore already includes every round of rework -
//      no separate "bounce cost" accounting is needed here.
//   2. A ticket with no priced usage anywhere is EXCLUDED from the average,
//      never silently treated as free ($0). See COST_PER_TICKET_BASIS,
//      which every surface rendering this figure must show verbatim so the
//      human can see exactly what is and is not counted.
export const COST_PER_TICKET_BASIS =
  "Average of each DELIVERED ticket's total cost, summed across every role that held it " +
  "(BL-312's non-double-counted totals). Includes rework: every bounce/re-hold's usage counts " +
  "toward the ticket, not just its first pass. Excludes usage outside any recorded holding " +
  "window ('unattributed') and tickets with no priced model available for any of their usage - " +
  'those are counted separately (see excluded count), never as $0.';

const UNATTRIBUTED_TICKET_KEY = 'unattributed';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function weekStartMs(ms: number): number {
  return Math.floor(ms / WEEK_MS) * WEEK_MS;
}

// Pure: each ticket's total cost summed across every role-group's byTicket
// bucket (costTelemetryByRole is already keyed by BL-312's combined,
// non-double-counted role groups - this never re-derives that grouping,
// just aggregates its output across roles). Mirrors sumCost's own "null
// means genuinely unpriced, not $0" honesty (costTelemetry.ts), aggregated
// across roles instead of records. A ticket absent from every role's
// byTicket (no usage recorded under any window) is simply absent from the
// result, distinct from a present-but-null (recorded, but unpriced) entry.
export function totalCostByTicket(costTelemetryByRole: Record<string, RoleCostTelemetry>): Record<string, number | null> {
  const totals = new Map<string, number>();
  const anyPriced = new Set<string>();
  const seen = new Set<string>();

  for (const roleTelemetry of Object.values(costTelemetryByRole)) {
    for (const [ticketId, attributed] of Object.entries(roleTelemetry.byTicket)) {
      if (ticketId === UNATTRIBUTED_TICKET_KEY) {
        continue;
      }
      seen.add(ticketId);
      if (attributed.costUsd !== null) {
        totals.set(ticketId, (totals.get(ticketId) ?? 0) + attributed.costUsd);
        anyPriced.add(ticketId);
      }
    }
  }

  const result: Record<string, number | null> = {};
  for (const ticketId of seen) {
    result[ticketId] = anyPriced.has(ticketId) ? totals.get(ticketId)! : null;
  }
  return result;
}

export interface CostPerTicketSeriesResult {
  series: TrendSeriesPoint[];
  sampleCount: number;
  excludedCount: number;
}

// Pure: buckets each DELIVERED (closeDateIso set) ticket's total cost into
// weekly periods by close date, averaging within each non-empty period. An
// empty week is OMITTED, never filled with a fabricated $0 - unlike the
// daily EVENT-COUNT series elsewhere in this file family (chases/nudges/
// flow balance), where "nothing happened" really is 0, a week with no
// ticket closed has no average cost to report at all. A delivered ticket
// with no recorded usage anywhere, or usage but no priced model anywhere,
// is EXCLUDED from the average (tallied in excludedCount instead) rather
// than silently treated as free - see COST_PER_TICKET_BASIS.
export function computeCostPerTicketSeries(
  lifecycles: TicketLifecycleEvent[],
  costTelemetryByRole: Record<string, RoleCostTelemetry>
): CostPerTicketSeriesResult {
  const totals = totalCostByTicket(costTelemetryByRole);
  const byPeriod = new Map<number, number[]>();
  let sampleCount = 0;
  let excludedCount = 0;

  for (const lifecycle of lifecycles) {
    if (!lifecycle.closeDateIso) {
      continue;
    }
    const cost = totals[lifecycle.ticketId];
    const closeMs = Date.parse(lifecycle.closeDateIso);
    if (cost === undefined || cost === null || Number.isNaN(closeMs)) {
      excludedCount += 1;
      continue;
    }
    sampleCount += 1;
    const period = weekStartMs(closeMs);
    if (!byPeriod.has(period)) {
      byPeriod.set(period, []);
    }
    byPeriod.get(period)!.push(cost);
  }

  const series: TrendSeriesPoint[] = [...byPeriod.entries()]
    .sort(([a], [b]) => a - b)
    .map(([period, costs]) => ({
      periodStart: new Date(period).toISOString(),
      value: costs.reduce((sum, c) => sum + c, 0) / costs.length,
    }));

  return { series, sampleCount, excludedCount };
}
