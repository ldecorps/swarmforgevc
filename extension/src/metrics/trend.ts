// BL-664 turnProfile TrendedNumber series: mechanical and turn-overhead shares per stage for briefing and charts.
// delivery-metrics series (velocity, burndown, cycle time, suite duration).
// BL-100 (token-cost telemetry trend) depends on this same framework, so the
// shape stays generic (a labeled value series in, a {current, prior, delta,
// direction} summary out) rather than tied to any one metric.

export interface TrendSeriesPoint {
  periodStart: string;
  value: number;
}

export type TrendDirection = 'up' | 'down' | 'flat' | 'unknown';

export interface TrendResult {
  series: TrendSeriesPoint[];
  currentValue: number | null;
  priorValue: number | null;
  delta: number | null;
  direction: TrendDirection;
}

function directionOf(delta: number): TrendDirection {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

export function computeTrend(series: TrendSeriesPoint[]): TrendResult {
  if (series.length === 0) {
    return { series, currentValue: null, priorValue: null, delta: null, direction: 'unknown' };
  }
  const currentValue = series[series.length - 1].value;
  if (series.length === 1) {
    return { series, currentValue, priorValue: null, delta: null, direction: 'unknown' };
  }
  const priorValue = series[series.length - 2].value;
  const delta = currentValue - priorValue;
  return { series, currentValue, priorValue, delta, direction: directionOf(delta) };
}

// BL-601: do NOT re-export trendForCompactionCadencePerHour from here —
// compactionCadence imports computeTrend; a re-export creates an acyclic cycle
// (architect bounce 88c606593c). Callers import from ./compactionCadence.
