// BL-635: the pure rework-rounds metric - mean rework rounds per closed
// ticket, split by BOUNCING role, never pooled. qaBounce.ts's own 53-record
// analysis is the proof pooling matters: read as one number, the QA-only
// log says "repeat bouncing doesn't happen here" (1 ticket of ~52 in 15
// days) - the opposite of the truth for architect send-backs, which is
// exactly the class the pooled reading hides. Reads only BounceRecord[]
// (the durable bounce log, qaBounceStore.ts's readBounceRecords) and
// closed-ticket dates - never commit subjects or briefing prose
// (record-bounce-by-role-10's discredited-source rule; see BL-635's
// source section for why both of those are irrecoverably contaminated).
import { TrendSeriesPoint } from './trend';
import { BounceRecord, bounceAttribution } from '../quality/qaBounce';

const DAY_MS = 24 * 60 * 60 * 1000;

// BL-635: the declared go-forward date the by-attributed series starts
// counting from - this ticket's own ship date. No architect send-back was
// ever recorded before this shipped, so every day before it is genuinely
// UNAVAILABLE (nothing was measured), never a fabricated healthy zero
// (record-bounce-by-role-12).
export const REWORK_ATTRIBUTION_EPOCH_ISO = '2026-07-26';

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

// BL-635 (record-bounce-by-role-08/09): mean rework rounds per closed
// ticket, split by bouncing role, as a two-point [priorWindow,
// currentWindow] series - so costHealthSidecar's own trendedFromSeries
// gives it a trend arrow exactly like specced/closed already get. A window
// with zero closes reports 0: there is nothing to divide by, and no rework
// can be meaningfully attributed to zero closed tickets either.
export function computeRoundsPerCloseSeriesByRole(
  records: BounceRecord[],
  closedDateIsos: string[],
  nowMs: number,
  windowMs: number = 7 * DAY_MS
): Record<string, TrendSeriesPoint[]> {
  const currentStart = nowMs - windowMs;
  const priorStart = nowMs - 2 * windowMs;
  const closedCurrent = countClosed(closedDateIsos, currentStart, nowMs);
  const closedPrior = countClosed(closedDateIsos, priorStart, currentStart);
  const result: Record<string, TrendSeriesPoint[]> = {};
  for (const role of rolesPresent(records)) {
    const curBounces = countBounces(records, role, currentStart, nowMs);
    const priorBounces = countBounces(records, role, priorStart, currentStart);
    result[role] = [
      { periodStart: dayIso(priorStart), value: closedPrior > 0 ? priorBounces / closedPrior : 0 },
      { periodStart: dayIso(currentStart), value: closedCurrent > 0 ? curBounces / closedCurrent : 0 },
    ];
  }
  return result;
}

// BL-635 (record-bounce-by-role-11): the single ticket with the most
// bounces across the whole log, so a repeated-bounce ticket (BL-590: 4)
// stays distinguishable from several once-bounced tickets - an average
// alone hides exactly this shape (BL-635's own description section). `by`
// is the role most of THAT ticket's bounces are attributed to (ties broken
// alphabetically for determinism).
export function computeMaxRoundsIndicator(records: BounceRecord[]): MaxRoundsIndicator | null {
  const byTicket = new Map<string, BounceRecord[]>();
  for (const record of records) {
    const list = byTicket.get(record.ticket) ?? [];
    list.push(record);
    byTicket.set(record.ticket, list);
  }
  let best: { ticket: string; recs: BounceRecord[] } | null = null;
  for (const [ticket, recs] of byTicket) {
    if (!best || recs.length > best.recs.length) {
      best = { ticket, recs };
    }
  }
  if (!best) {
    return null;
  }
  const roleCounts = new Map<string, number>();
  for (const r of best.recs) {
    const role = bounceAttribution(r);
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }
  const by = [...roleCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  return { ticket: best.ticket, rounds: best.recs.length, by };
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
