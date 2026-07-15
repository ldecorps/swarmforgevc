/**
 * BL-430 (epic BL-429 slice 1 — OBSERVE): composes the pipeline's existing
 * bounce ingredients (computeReworkEvents/computeRetries's backward-handoff
 * scan, each ticket's own mutation_cost class, QA bounce evidence committed
 * to main) into a single rolling rework-rate signal, attributed by role and
 * ticket-class, against a trailing baseline. Pure compute only - the
 * adapter that assembles CompletedTicketRecord[] from real git/filesystem
 * state lives in reworkObservatorySource.ts. This slice moves no knob and
 * changes no promotion behaviour; a later slice (BL-431) diagnoses it.
 */

export interface CompletedTicketRecord {
  ticketId: string;
  completedAtMs: number;
  bounced: boolean;
  bouncedFromRole: string | null;
  ticketClass: string | null;
}

export interface ReworkSignal {
  hasSample: boolean;
  sampleCount: number;
  reworkRate: number | null;
  baselineRate: number | null;
  topRole: string | null;
  topTicketClass: string | null;
}

function noSampleSignal(): ReworkSignal {
  return { hasSample: false, sampleCount: 0, reworkRate: null, baselineRate: null, topRole: null, topTicketClass: null };
}

function inWindow(record: CompletedTicketRecord, startMs: number, endMs: number): boolean {
  return record.completedAtMs >= startMs && record.completedAtMs < endMs;
}

// Pure: null (no sample) for an empty set, never a fabricated 0 or 1 -
// mirrors the zero-sample-safety rule below at the rate-computation level.
function rateOf(records: CompletedTicketRecord[]): number | null {
  if (records.length === 0) {
    return null;
  }
  return records.filter((r) => r.bounced).length / records.length;
}

// Pure: the most frequent non-null value of `pick` among BOUNCED records
// only - a non-bounced ticket's role/class never contributes, since it
// carries no rework to attribute. A tie keeps whichever value was seen
// first (stable, deterministic - never arbitrary Map iteration order
// mattering to the caller since ties are exceedingly unlikely with real
// per-role counts, but determinism is still worth pinning).
function modeOfBounced(records: CompletedTicketRecord[], pick: (r: CompletedTicketRecord) => string | null): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  let bestCount = 0;
  for (const record of records) {
    if (!record.bounced) {
      continue;
    }
    const value = pick(record);
    if (value === null) {
      continue;
    }
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

// Pure: rolling rework rate over [windowStartMs, windowEndMs), attributed
// by role and ticket-class, against a trailing baseline computed over the
// PRECEDING [baselineStartMs, windowStartMs) period. An empty window
// reports NO_SAMPLE entirely (rework-observatory-04) rather than a
// divide-by-zero or a fabricated rate; a baseline period with no completed
// tickets independently reports a null baseline without blocking the main
// window's own rate.
export function computeReworkSignal(
  records: CompletedTicketRecord[],
  windowStartMs: number,
  windowEndMs: number,
  baselineStartMs: number
): ReworkSignal {
  const windowRecords = records.filter((r) => inWindow(r, windowStartMs, windowEndMs));
  if (windowRecords.length === 0) {
    return noSampleSignal();
  }
  const baselineRecords = records.filter((r) => inWindow(r, baselineStartMs, windowStartMs));
  return {
    hasSample: true,
    sampleCount: windowRecords.length,
    reworkRate: rateOf(windowRecords),
    baselineRate: rateOf(baselineRecords),
    topRole: modeOfBounced(windowRecords, (r) => r.bouncedFromRole),
    topTicketClass: modeOfBounced(windowRecords, (r) => r.ticketClass),
  };
}
