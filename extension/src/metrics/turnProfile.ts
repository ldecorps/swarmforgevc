import { computeTrend, TrendSeriesPoint } from './trend';
import type { TrendedNumber } from '../notify/costHealthSidecar';
import type { CoverageWindow, ClassifiedInterval, IntervalCategory } from '../tools/transcriptWalker';

export interface TurnProfileStageEntry {
  stage: string;
  mechanicalShare: TrendedNumber;
  turnOverheadShare: TrendedNumber;
}

export interface TurnProfileSeries {
  stages: TurnProfileStageEntry[];
  coverageWindow: CoverageWindow | null;
  extrapolated: boolean;
}

function durationMs(intervals: ClassifiedInterval[]): number {
  return intervals.reduce((sum, row) => sum + Math.max(0, row.endMs - row.startMs), 0);
}

function categoryShare(intervals: ClassifiedInterval[], category: IntervalCategory): number {
  const total = durationMs(intervals);
  if (total <= 0) {
    return 0;
  }
  const catMs = intervals
    .filter((row) => row.category === category)
    .reduce((sum, row) => sum + Math.max(0, row.endMs - row.startMs), 0);
  return catMs / total;
}

function trendedShare(value: number, periodStart: string): TrendedNumber {
  const point: TrendSeriesPoint = { periodStart, value };
  return { value, trend: computeTrend([point]) };
}

/** BL-664: mechanical and turn-overhead shares per stage in TrendedNumber shape. */
export function buildTurnProfileSeries(
  intervals: ClassifiedInterval[],
  coverageWindow: CoverageWindow | null
): TurnProfileSeries {
  const byStage = new Map<string, ClassifiedInterval[]>();
  for (const row of intervals) {
    const stage = row.stage ?? 'unknown';
    const bucket = byStage.get(stage);
    if (bucket) {
      bucket.push(row);
    } else {
      byStage.set(stage, [row]);
    }
  }
  const periodStart = coverageWindow ? new Date(coverageWindow.startMs).toISOString() : 'unknown';
  const stages = [...byStage.entries()].map(([stage, stageIntervals]) => ({
    stage,
    mechanicalShare: trendedShare(categoryShare(stageIntervals, 'git-mechanical'), periodStart),
    turnOverheadShare: trendedShare(categoryShare(stageIntervals, 'turn-overhead'), periodStart),
  }));
  return {
    stages,
    coverageWindow,
    extrapolated: false,
  };
}
