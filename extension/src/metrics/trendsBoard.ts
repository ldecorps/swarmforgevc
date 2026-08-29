// BL-603: the shape of the behaviour-trend board that the live holistic
// console publishes. This module is a CONSUMER surface: it adds no
// instrumentation and knows nothing about how any BL-594 producer derives
// its numbers. A registered series hands over a plain TrendSeriesPoint[]
// and that is the whole coupling.
//
// The honesty rule the ticket makes load-bearing: a series with nothing to
// plot renders as absent data. Nothing here ever substitutes a zero, a flat
// line, or an interpolated value for a missing point - a loader that finds
// no records returns an EMPTY array, and an empty array stays empty all the
// way to the screen.

import { TrendSeriesPoint } from './trend';

/** Everything a series loader is allowed to read. */
export interface TrendsBoardContext {
  /** The swarm's master worktree - where every telemetry ledger lives. */
  targetPath: string;
  nowMs: number;
}

/**
 * One registered series. Adding an entry to the registry is the ONLY edit
 * needed to publish a series: the payload builder maps over the registry and
 * the renderer maps over the payload, so neither carries a per-series list.
 */
export interface TrendsBoardSeriesSource {
  /** Stable id, used as the board's key and by the acceptance scenarios. */
  id: string;
  /** Human-facing label on the board. */
  label: string;
  /** The producer module this series comes from, for provenance on screen. */
  producer: string;
  /**
   * Returns the series' points. An empty array means "nothing to plot" -
   * whether because the producer has not landed or because it has landed
   * and recorded nothing. The two causes are indistinguishable here by
   * design; both are honest as "no data yet".
   */
  loadPoints(context: TrendsBoardContext): TrendSeriesPoint[];
}

/**
 * A loader must never take the board down with it. A producer whose ledger
 * is malformed, or whose module has not landed, reads as no data - the same
 * honest empty state as a producer that simply recorded nothing.
 */
export function loadPointsSafely(
  source: TrendsBoardSeriesSource,
  context: TrendsBoardContext
): TrendSeriesPoint[] {
  try {
    return source.loadPoints(context) ?? [];
  } catch {
    return [];
  }
}

/**
 * Sum several series into one, bucket by bucket. Used where a producer
 * splits its counts across a dimension the board does not show (self-heal
 * events by type). A period present in only one input keeps that input's
 * value - it is NOT back-filled with zeros for the other inputs, because a
 * period a producer never recorded is absent data, not a zero.
 */
export function sumPointsByPeriod(seriesList: TrendSeriesPoint[][]): TrendSeriesPoint[] {
  const totals = new Map<string, number>();
  for (const series of seriesList) {
    for (const point of series) {
      totals.set(point.periodStart, (totals.get(point.periodStart) ?? 0) + point.value);
    }
  }
  return toSortedPoints(totals);
}

/**
 * Mean of several series, bucket by bucket. Used where the dimension the
 * board collapses carries a RATE or a LATENCY rather than a count (handoff
 * latency by role, compaction cadence by role) - summing those would be
 * arithmetic nonsense. A period is averaged over only the inputs that
 * actually recorded it, never over the ones that did not.
 */
export function meanPointsByPeriod(seriesList: TrendSeriesPoint[][]): TrendSeriesPoint[] {
  const sums = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const series of seriesList) {
    for (const point of series) {
      sums.set(point.periodStart, (sums.get(point.periodStart) ?? 0) + point.value);
      counts.set(point.periodStart, (counts.get(point.periodStart) ?? 0) + 1);
    }
  }
  const means = new Map<string, number>();
  for (const [periodStart, sum] of sums.entries()) {
    means.set(periodStart, sum / (counts.get(periodStart) as number));
  }
  return toSortedPoints(means);
}

function toSortedPoints(values: Map<string, number>): TrendSeriesPoint[] {
  return [...values.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([periodStart, value]) => ({ periodStart, value }));
}
