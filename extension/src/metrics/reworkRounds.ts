// BL-635: the pure rework-rounds metric - mean rework rounds per closed
// ticket, split by BOUNCING role, never pooled. qaBounce.ts's own 53-record
// analysis is the proof pooling matters: read as one number, the QA-only
// log says "repeat bouncing doesn't happen here" (1 ticket of ~52 in 15
// days) - the opposite of the truth for architect send-backs, which is
// exactly the class the pooled reading hides. Reads only BounceRecord[]
// (the durable bounce log, bounceStore.ts's readBounceRecords) and
// closed-ticket dates - never commit subjects or briefing prose
// (record-bounce-by-role-10's discredited-source rule; see BL-635's
// source section for why both of those are irrecoverably contaminated).
import { BounceRecord, bounceAttribution } from '../quality/qaBounce';

const DAY_MS = 24 * 60 * 60 * 1000;

// BL-635: the declared go-forward date the by-attributed series starts
// counting from - this ticket's own ship date. No architect send-back was
// ever recorded before this shipped, so every day before it is genuinely
// UNAVAILABLE (nothing was measured), never a fabricated healthy zero
// (record-bounce-by-role-12).
//
// BL-635 SEND BACK #1 (evidence site 5): dayStartMs below compares in UTC,
// but a "ship day" is a LOCAL concept - record-bounce.js stamps `at` off the
// real UTC wall clock, so a record written in the last local hour of ship
// day (e.g. 2026-07-26 00:51 BST = 2026-07-25 23:51 UTC) falls on the PRIOR
// UTC calendar day. Pinning this constant to the nominal ship date
// (2026-07-26) let that boundary swallow a real, just-recorded bounce as
// pre-epoch - discarding measured data, the opposite failure direction from
// the one this whole ticket exists to prevent. Pinned one UTC day earlier
// than the nominal ship date so a ship-day record can never be swallowed:
// the safe failure direction is counting a real bounce, never discarding
// one.
export const REWORK_ATTRIBUTION_EPOCH_ISO = '2026-07-25';

export interface MaxRoundsIndicator {
  ticket: string;
  rounds: number;
  by: string;
}

export interface DailyReworkPoint {
  periodStart: string; // yyyy-mm-dd
  value: number | null; // null = unavailable (pre-epoch), never a fabricated zero
}

function dayIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayStartMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00.000Z`);
}

// Every bouncing role that appears ANYWHERE in the log, sorted for
// deterministic iteration order - a role that has never bounced is simply
// absent from the result rather than padded in as an all-zero entry.
function rolesPresent(records: BounceRecord[]): string[] {
  return [...new Set(records.map(bounceAttribution))].sort();
}

function inRange(iso: string, startMs: number, endMs: number): boolean {
  const ms = Date.parse(iso);
  return !Number.isNaN(ms) && ms >= startMs && ms < endMs;
}

function countBounces(records: BounceRecord[], role: string, startMs: number, endMs: number): number {
  return records.filter((r) => bounceAttribution(r) === role && inRange(r.at, startMs, endMs)).length;
}

function countClosed(closedDateIsos: string[], startMs: number, endMs: number): number {
  return closedDateIsos.filter((d) => inRange(d, startMs, endMs)).length;
}

// BL-635 SEND BACK #1 (evidence sites 1/2): a single window's value, or
// `null` (unavailable) when either (a) the window's entire span lies before
// the by-attribution epoch - nothing was ever measured there, a fabricated
// 0 would claim otherwise - or (b) the window closed zero tickets, so there
// is no denominator a real rounds-per-close figure could honestly report.
// Both are absence-of-data, never a healthy 0 (the invariant this whole
// ticket exists to protect).
function windowPoint(periodStart: string, bounces: number, closed: number, windowEndMs: number, epochStartMs: number): DailyReworkPoint {
  if (windowEndMs <= epochStartMs || closed === 0) {
    return { periodStart, value: null };
  }
  return { periodStart, value: bounces / closed };
}

// BL-635 (record-bounce-by-role-08/09): mean rework rounds per closed
// ticket, split by bouncing role, as a two-point [priorWindow,
// currentWindow] series - costHealthSidecar collapses this into a
// TrendedNumber (or null, when the current point is unavailable) exactly
// like specced/closed already get, but never computes a trend arrow off an
// unavailable baseline.
export function computeRoundsPerCloseSeriesByRole(
  records: BounceRecord[],
  closedDateIsos: string[],
  nowMs: number,
  windowMs: number = 7 * DAY_MS,
  epochIso: string = REWORK_ATTRIBUTION_EPOCH_ISO
): Record<string, DailyReworkPoint[]> {
  const epochStartMs = dayStartMs(epochIso);
  const currentStart = nowMs - windowMs;
  const priorStart = nowMs - 2 * windowMs;
  const closedCurrent = countClosed(closedDateIsos, currentStart, nowMs);
  const closedPrior = countClosed(closedDateIsos, priorStart, currentStart);
  const result: Record<string, DailyReworkPoint[]> = {};
  for (const role of rolesPresent(records)) {
    const curBounces = countBounces(records, role, currentStart, nowMs);
    const priorBounces = countBounces(records, role, priorStart, currentStart);
    result[role] = [
      windowPoint(dayIso(priorStart), priorBounces, closedPrior, currentStart, epochStartMs),
      windowPoint(dayIso(currentStart), curBounces, closedCurrent, nowMs, epochStartMs),
    ];
  }
  return result;
}

function groupBounceRecordsByTicket(records: BounceRecord[]): Map<string, BounceRecord[]> {
  const byTicket = new Map<string, BounceRecord[]>();
  for (const record of records) {
    const list = byTicket.get(record.ticket) ?? [];
    list.push(record);
    byTicket.set(record.ticket, list);
  }
  return byTicket;
}

function mostBouncedTicket(byTicket: Map<string, BounceRecord[]>): { ticket: string; recs: BounceRecord[] } | null {
  let best: { ticket: string; recs: BounceRecord[] } | null = null;
  for (const [ticket, recs] of byTicket) {
    if (!best || recs.length > best.recs.length) {
      best = { ticket, recs };
    }
  }
  return best;
}

// The bouncing role most of a ticket's own bounces are attributed to (ties
// broken alphabetically for determinism).
function dominantBouncingRole(recs: BounceRecord[]): string {
  const roleCounts = new Map<string, number>();
  for (const r of recs) {
    const role = bounceAttribution(r);
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }
  return [...roleCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

// BL-635 (record-bounce-by-role-11): the single ticket with the most
// bounces across the whole log, so a repeated-bounce ticket (BL-590: 4)
// stays distinguishable from several once-bounced tickets - an average
// alone hides exactly this shape (BL-635's own description section).
export function computeMaxRoundsIndicator(records: BounceRecord[]): MaxRoundsIndicator | null {
  const best = mostBouncedTicket(groupBounceRecordsByTicket(records));
  if (!best) {
    return null;
  }
  return { ticket: best.ticket, rounds: best.recs.length, by: dominantBouncingRole(best.recs) };
}

// BL-635 (record-bounce-by-role-09/12/13): one role's daily bounce count
// over an explicit, caller-supplied list of days - every day before
// `epochIso` reports null (unavailable: nothing was ever measured there,
// not a quiet zero); every day at or after it reports a real count, zero
// included. The day list is caller-supplied (never inferred from the
// data) so "day after the epoch with zero records" and "day before the
// epoch" are independently controllable and honestly distinguishable.
export function computeDailyReworkSeries(
  records: BounceRecord[],
  role: string,
  dayIsos: string[],
  epochIso: string = REWORK_ATTRIBUTION_EPOCH_ISO
): DailyReworkPoint[] {
  const epochStartMs = dayStartMs(epochIso);
  return dayIsos.map((iso) => {
    const start = dayStartMs(iso);
    if (start < epochStartMs) {
      return { periodStart: iso, value: null };
    }
    return { periodStart: iso, value: countBounces(records, role, start, start + DAY_MS) };
  });
}

// BL-635 (record-bounce-by-role-12): renders one role's daily series as a
// markdown line - a pre-epoch point renders the literal word "unavailable",
// NEVER the digit "0", so a pre-epoch stretch can never read as a flat
// healthy zero line on the page a human actually looks at.
export function renderDailyReworkMarkdownLine(role: string, points: DailyReworkPoint[]): string {
  const rendered = points.map((p) => `${p.periodStart}: ${p.value === null ? 'unavailable' : p.value}`).join(', ');
  return `${role}: ${rendered}`;
}

// Convenience wrapper of computeDailyReworkSeries for every role present in
// the log at once - the shape costHealthSidecar's flowBalance.rework wires
// into bouncesPerDay.
export function computeDailyReworkSeriesByRole(
  records: BounceRecord[],
  dayIsos: string[],
  epochIso: string = REWORK_ATTRIBUTION_EPOCH_ISO
): Record<string, DailyReworkPoint[]> {
  const result: Record<string, DailyReworkPoint[]> = {};
  for (const role of rolesPresent(records)) {
    result[role] = computeDailyReworkSeries(records, role, dayIsos, epochIso);
  }
  return result;
}

// Last `n` calendar days ending on (and including) the day of `nowMs`,
// oldest first - the window computeCostHealthSidecar feeds
// computeDailyReworkSeriesByRole for the sidecar's bouncesPerDay.
export function lastNDaysIso(nowMs: number, n: number): string[] {
  const nowDayStart = dayStartMs(dayIso(nowMs));
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    days.push(dayIso(nowDayStart - i * DAY_MS));
  }
  return days;
}
