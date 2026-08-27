// BL-666: budget-aware shift governor — anchor-calibrated burn projection
// chooses full / SHORT / CHEAP / SKIP at each shift boundary.
import { MS_PER_DAY } from './burnProjection';
import type { UsageAnchor } from './burnProjection';
import type { ClassifiedInterval } from './transcriptWalker';

export type ShiftVerdict = 'full' | 'SHORT' | 'CHEAP' | 'SKIP';

export const DEFAULT_STALE_ANCHOR_THRESHOLD_MS = 3 * MS_PER_DAY;
export const DEFAULT_FULL_SHIFT_HOURS = 8;

export interface BudgetGovernorConfig {
  planKind: 'prepaid';
  staleAnchorThresholdMs: number;
  fullShiftHours: number;
}

export const DEFAULT_BUDGET_GOVERNOR_CONFIG: BudgetGovernorConfig = {
  planKind: 'prepaid',
  staleAnchorThresholdMs: DEFAULT_STALE_ANCHOR_THRESHOLD_MS,
  fullShiftHours: DEFAULT_FULL_SHIFT_HOURS,
};

export interface GovernorRunInput {
  remainingPercent: number;
  daysToReset: number;
  measuredBurnPercentPerDay: number;
  affordableBurnPercentPerDay: number;
  measuredBurnPerShift?: number;
  degradedMode?: boolean;
  spendPaidCredits?: boolean;
  paidCreditsOptIn?: boolean;
}

export interface GovernorRunResult {
  verdict: ShiftVerdict;
  announcement: string;
  degraded: boolean;
  trimmedHours?: number;
  cheapMode: boolean;
  drainsApprovalsAtNextStart: boolean;
  exactProjection: boolean;
  refusedPaidCredits?: boolean;
}

export interface AnchorCalibrationResult {
  calibrated: true;
  projectedGaugeLabel: string;
  burnBetweenAnchorsFromWalker: boolean;
  measuredBurnPercentPerDay: number;
}

function burnPerShift(input: GovernorRunInput, fullShiftHours: number): number {
  if (input.measuredBurnPerShift !== undefined) {
    return input.measuredBurnPerShift;
  }
  return input.measuredBurnPercentPerDay * (fullShiftHours / 24);
}

function pickVerdictFromBurnRatio(measured: number, affordable: number): ShiftVerdict {
  if (affordable <= 0) {
    return 'SKIP';
  }
  const ratio = measured / affordable;
  if (ratio <= 1.0) {
    return 'full';
  }
  if (ratio <= 1.35) {
    return 'SHORT';
  }
  if (ratio <= 2.5) {
    return 'CHEAP';
  }
  return 'SKIP';
}

function buildAnnouncement(
  input: GovernorRunInput,
  verdict: ShiftVerdict,
  config: BudgetGovernorConfig,
  opts: { degraded?: boolean; trimmedHours?: number; exact?: boolean }
): string {
  const perShift = burnPerShift(input, config.fullShiftHours);
  const parts = [
    opts.degraded ? 'degraded mode' : null,
    `remaining ${input.remainingPercent}%`,
    `days-to-reset ${input.daysToReset}`,
    `measured burn/shift ${perShift.toFixed(2)}`,
    `measured ${input.measuredBurnPercentPerDay}%/day`,
    opts.trimmedHours !== undefined ? `trimmed hours ${opts.trimmedHours}` : null,
    verdict !== 'full' ? `verdict ${verdict}` : null,
    opts.exact === false ? 'projection approximate' : null,
  ].filter(Boolean);
  return parts.join('; ');
}

/** BL-666 shift boundary verdict from burn arithmetic. */
export function runBudgetShiftGovernor(
  config: BudgetGovernorConfig,
  input: GovernorRunInput
): GovernorRunResult {
  if (input.spendPaidCredits && !input.paidCreditsOptIn) {
    return {
      verdict: 'SKIP',
      announcement: 'Paid credits require explicit human opt-in; governor refuses to spend credits.',
      degraded: false,
      cheapMode: false,
      drainsApprovalsAtNextStart: true,
      exactProjection: false,
      refusedPaidCredits: true,
    };
  }

  const verdict = pickVerdictFromBurnRatio(input.measuredBurnPercentPerDay, input.affordableBurnPercentPerDay);
  const trimmedHours =
    verdict === 'SHORT'
      ? Math.max(1, Math.floor(config.fullShiftHours * (input.affordableBurnPercentPerDay / input.measuredBurnPercentPerDay)))
      : undefined;

  if (input.degradedMode) {
    return {
      verdict,
      announcement: buildAnnouncement(input, verdict, config, { degraded: true, trimmedHours, exact: false }),
      degraded: true,
      trimmedHours,
      cheapMode: verdict === 'CHEAP',
      drainsApprovalsAtNextStart: verdict === 'SKIP',
      exactProjection: false,
    };
  }

  return {
    verdict,
    announcement: buildAnnouncement(input, verdict, config, { trimmedHours, exact: true }),
    degraded: false,
    trimmedHours,
    cheapMode: verdict === 'CHEAP',
    drainsApprovalsAtNextStart: verdict === 'SKIP',
    exactProjection: true,
  };
}

/** BL-664 walker burn between two human anchors (percent of weekly tank per day). */
export function bl664WalkerBurnMeter(
  intervals: ClassifiedInterval[],
  anchorAMs: number,
  anchorBMs: number
): { burnPercentPerDay: number; source: 'bl664-walker' } {
  const inWindow = intervals.filter((row) => row.startMs >= anchorAMs && row.endMs <= anchorBMs);
  const durationMs = inWindow.reduce((sum, row) => sum + Math.max(0, row.endMs - row.startMs), 0);
  const elapsedDays = Math.max((anchorBMs - anchorAMs) / MS_PER_DAY, 1 / 24);
  const burnPercentPerDay = durationMs > 0 ? (durationMs / MS_PER_DAY) * 0.5 : 0;
  return { burnPercentPerDay, source: 'bl664-walker' };
}

export function runAnchorCalibration(
  anchorA: UsageAnchor,
  anchorB: UsageAnchor,
  walkerBurnPercentPerDay: number
): AnchorCalibrationResult {
  const elapsedDays = Math.max((anchorB.atMs - anchorA.atMs) / MS_PER_DAY, 1 / 24);
  const anchorDelta = anchorB.pct - anchorA.pct;
  const blended = elapsedDays > 0 ? anchorDelta / elapsedDays : walkerBurnPercentPerDay;
  return {
    calibrated: true,
    projectedGaugeLabel: 'calibrated',
    burnBetweenAnchorsFromWalker: walkerBurnPercentPerDay > 0,
    measuredBurnPercentPerDay: Math.max(blended, walkerBurnPercentPerDay),
  };
}

export function isAnchorStale(lastAnchorAtMs: number, nowMs: number, thresholdMs: number): boolean {
  return nowMs - lastAnchorAtMs > thresholdMs;
}
