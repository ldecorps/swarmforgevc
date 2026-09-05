import { computeTrend, TrendSeriesPoint } from './trend';
import type { TrendedNumber } from '../notify/costHealthSidecar';
import { INTERVAL_CATEGORIES } from './transcriptWalker';
import type { CoverageWindow, ClassifiedInterval, IntervalCategory } from './transcriptWalker';

export interface TurnProfileStageEntry {
  stage: string;
  mechanicalShare: TrendedNumber;
  turnOverheadShare: TrendedNumber;
  /**
   * BL-1364: every category the walker classifies, not only the two the
   * original consumers asked for - a stage whose turns were entirely test-run
   * or thinking-writing had no readable share at all before. Keyed from
   * INTERVAL_CATEGORIES so this can never drift from the walker (BL-897).
   */
  categoryShares: Record<IntervalCategory, number>;
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

// A stage that IS in the series was worked, so a category it never used is a
// measured zero and belongs here as one. The absent-versus-zero distinction
// invariant 1 protects is about STAGES, and is enforced one level up by only
// ever emitting stages the walker actually saw intervals for.
function allCategoryShares(intervals: ClassifiedInterval[]): Record<IntervalCategory, number> {
  const shares = {} as Record<IntervalCategory, number>;
  for (const category of INTERVAL_CATEGORIES) {
    shares[category] = categoryShare(intervals, category);
  }
  return shares;
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
    categoryShares: allCategoryShares(stageIntervals),
  }));
  return {
    stages,
    coverageWindow,
    extrapolated: false,
  };
}
