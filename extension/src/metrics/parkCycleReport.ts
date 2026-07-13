import { TranscriptUsageRecord } from './transcriptUsage';
import { ParkCycleCostReport, measureParkCycleCost, DEFAULT_BURN_RATE_WINDOW_MS } from './burnRate';

// BL-343: the dynamic-routing epic (BL-307/BL-317/BL-318/BL-324) parks
// idle roles to save money, but unparking is not free - a role comes back
// COLD and re-reads its whole system prompt. This module answers "does it
// actually pay off", from REAL observed park/unpark cycles ONLY - never an
// estimate (the ticket's own "bounce any figure whose provenance is an
// estimate rather than an observed run"). role_lifecycle_cli.bb is the
// SINGLE place a real park/unpark decision is enacted, and now logs each
// one to park-cycle-log.jsonl; this module pairs those real events into
// complete cycles and reuses BL-324's own already-tested cost function
// (measureParkCycleCost) against each cycle's REAL transcript usage -
// never re-deriving that math.

const MS_PER_HOUR = 60 * 60 * 1000;

export interface ParkCycleEvent {
  event: 'park' | 'unpark';
  role: string;
  atMs: number;
}

export interface ParkCycle {
  role: string;
  parkedAtMs: number;
  unparkedAtMs: number;
}

// One line per JSON event, malformed/blank lines skipped rather than
// throwing - a truncated trailing write (a crash mid-append) must never
// take down every OTHER role's already-durable cycle.
export function parseParkCycleLog(content: string): ParkCycleEvent[] {
  const events: ParkCycleEvent[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (
        (parsed.event === 'park' || parsed.event === 'unpark') &&
        typeof parsed.role === 'string' &&
        typeof parsed.atMs === 'number'
      ) {
        events.push(parsed);
      }
    } catch {
      // skip malformed line
    }
  }
  return events;
}

// Pairs each role's own park events with the NEXT unpark event AFTER it,
// in chronological order - a role still parked (a trailing park with no
// unpark yet) or a leading unpark with no preceding park (state from
// before this logging existed) is NEVER fabricated into a pair; only a
// genuinely COMPLETE, real cycle is returned.
export function pairParkCycles(events: ParkCycleEvent[]): ParkCycle[] {
  const byRole = new Map<string, ParkCycleEvent[]>();
  for (const event of events) {
    const list = byRole.get(event.role);
    if (list) {
      list.push(event);
    } else {
      byRole.set(event.role, [event]);
    }
  }
  const cycles: ParkCycle[] = [];
  for (const [role, roleEvents] of byRole) {
    const sorted = [...roleEvents].sort((a, b) => a.atMs - b.atMs);
    let pendingParkAtMs: number | null = null;
    for (const event of sorted) {
      if (event.event === 'park') {
        pendingParkAtMs = event.atMs;
      } else if (event.event === 'unpark' && pendingParkAtMs !== null) {
        cycles.push({ role, parkedAtMs: pendingParkAtMs, unparkedAtMs: event.atMs });
        pendingParkAtMs = null;
      }
    }
  }
  return cycles;
}

// The idle duration at which a park/unpark cycle stops being a loss:
// warmIdleBaselineTokens scales linearly with parkedDurationMs (see
// measureParkCycleCost), so the implied per-hour idle rate is
// warmIdleBaselineTokens / (parkedDurationMs / MS_PER_HOUR), and the
// break-even is where coldStartTokens (a roughly fixed re-read cost)
// equals that rate applied over D: D = coldStartTokens * parkedDurationMs
// / warmIdleBaselineTokens. null when the role burned nothing idle in the
// measured window (division by zero) - honestly meaning "no idle duration
// makes parking pay, since it cost nothing to leave warm."
export function deriveBreakEvenMs(report: ParkCycleCostReport, parkedDurationMs: number): number | null {
  if (report.warmIdleBaselineTokens <= 0 || parkedDurationMs <= 0) {
    return null;
  }
  return (report.coldStartTokens * parkedDurationMs) / report.warmIdleBaselineTokens;
}

export interface ParkCycleMeasurement extends ParkCycleCostReport {
  role: string;
  parkedAtMs: number;
  unparkedAtMs: number;
  breakEvenMs: number | null;
}

export interface RoutingBreakEvenReport {
  measuredCycles: ParkCycleMeasurement[];
  // One entry per role with at least one REAL complete cycle - a role
  // with none is simply absent, never defaulted to a guessed number.
  roleBreakEvenMs: Record<string, number | null>;
  totalDeltaTokens: number;
  // null when zero real cycles exist - there is nothing to judge from yet,
  // and this must never silently read as false (which would misreport
  // "routing does not save money" when the true state is "unmeasured").
  routingSavesMoney: boolean | null;
}

// The one impure entry point: given the real parsed event log and a way
// to read each role's real transcript usage, measures every REAL complete
// cycle and aggregates a report. Zero complete cycles is a valid, honest
// result (routingSavesMoney: null) - never fabricated from an estimate.
export function computeRoutingBreakEvenReport(
  events: ParkCycleEvent[],
  readTranscript: (worktreePath: string) => TranscriptUsageRecord[],
  roleWorktreePath: (role: string) => string | null,
  coldStartWindowMs: number,
  priorIdleWindowMs: number = DEFAULT_BURN_RATE_WINDOW_MS
): RoutingBreakEvenReport {
  const cycles = pairParkCycles(events);
  const measuredCycles: ParkCycleMeasurement[] = [];
  for (const cycle of cycles) {
    const worktreePath = roleWorktreePath(cycle.role);
    if (!worktreePath) continue;
    const records = readTranscript(worktreePath);
    const cost = measureParkCycleCost(records, cycle.parkedAtMs, cycle.unparkedAtMs, coldStartWindowMs, priorIdleWindowMs);
    const breakEvenMs = deriveBreakEvenMs(cost, cycle.unparkedAtMs - cycle.parkedAtMs);
    measuredCycles.push({ ...cycle, ...cost, breakEvenMs });
  }
  const roleBreakEvenMs: Record<string, number | null> = {};
  for (const measurement of measuredCycles) {
    roleBreakEvenMs[measurement.role] = measurement.breakEvenMs;
  }
  const totalDeltaTokens = measuredCycles.reduce((sum, m) => sum + m.deltaTokens, 0);
  const routingSavesMoney = measuredCycles.length === 0 ? null : totalDeltaTokens > 0;
  return { measuredCycles, roleBreakEvenMs, totalDeltaTokens, routingSavesMoney };
}

export const DEFAULT_COLD_START_WINDOW_MS = 15 * 60 * 1000;
