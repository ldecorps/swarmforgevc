import {
  DeliveryMetrics,
  CycleTimeResult,
  VelocityResult,
  DEFAULT_CYCLE_TIME_RECENT_WINDOW,
} from '../metrics/deliveryMetrics';
import { StageDwellReportResult } from '../metrics/stageDwell';
import { CompletedTicketRecord, computeReworkSignal } from '../metrics/reworkObservatory';
import { diagnoseReworkSignal, SuboptimalityVerdict } from '../metrics/reworkDiagnosis';
import { formatDurationMs } from '../metrics/swarmMetrics';
import { TrendDirection } from '../metrics/trend';

export const HEALTH_REWORK_WINDOW_DAYS = 14;
export const HEALTH_REWORK_BASELINE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const NO_OBSERVATIONS = 'No observations';

export interface HealthReadout {
  id: string;
  label: string;
  windowLabel: string;
  hasObservations: boolean;
  displayValue: string;
  direction: TrendDirection | null;
  directionLine: string | null;
}

export interface ReworkRoleRate {
  role: string;
  bouncedCount: number;
  completedCount: number;
  rate: number | null;
}

export interface ReworkReadout extends HealthReadout {
  byRole: ReworkRoleRate[];
  verdict: SuboptimalityVerdict | null;
}

export interface BubbleHealthTrendsPayload {
  traverseTime: HealthReadout;
  velocity: HealthReadout;
  bottleneck: HealthReadout;
  rework: ReworkReadout;
}

export function reworkBreakdownByRole(
  records: CompletedTicketRecord[],
  windowStartMs: number,
  windowEndMs: number
): ReworkRoleRate[] {
  const inWindow = records.filter((r) => r.completedAtMs >= windowStartMs && r.completedAtMs < windowEndMs);
  const byRole = new Map<string, { bounced: number; total: number }>();
  for (const record of inWindow) {
    if (!record.bounced) {
      continue;
    }
    const role = record.bouncedFromRole ?? '(unknown)';
    const entry = byRole.get(role) ?? { bounced: 0, total: 0 };
    entry.total += 1;
    entry.bounced += 1;
    byRole.set(role, entry);
  }
  return [...byRole.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([role, counts]) => ({
      role,
      bouncedCount: counts.bounced,
      completedCount: counts.total,
      rate: counts.total > 0 ? counts.bounced / counts.total : null,
    }));
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function trendDirection(direction: TrendDirection): TrendDirection | null {
  return direction === 'unknown' ? null : direction;
}

function traverseTimeReadout(cycleTime: CycleTimeResult): HealthReadout {
  const windowLabel = `last ${DEFAULT_CYCLE_TIME_RECENT_WINDOW} tickets`;
  if (cycleTime.sampleCount === 0) {
    return {
      id: 'traverse-time',
      label: 'Traverse time',
      windowLabel,
      hasObservations: false,
      displayValue: NO_OBSERVATIONS,
      direction: null,
      directionLine: null,
    };
  }
  return {
    id: 'traverse-time',
    label: 'Traverse time',
    windowLabel,
    hasObservations: true,
    displayValue: `median ${formatDurationMs(cycleTime.medianMs as number)}`,
    direction: trendDirection(cycleTime.trend.direction),
    directionLine: null,
  };
}

function velocityReadout(velocity: VelocityResult): HealthReadout {
  const windowLabel = `${velocity.rollingWindowDays}-day rolling`;
  if (velocity.rollingWindowCount === 0) {
    return {
      id: 'velocity',
      label: 'Velocity',
      windowLabel,
      hasObservations: false,
      displayValue: NO_OBSERVATIONS,
      direction: null,
      directionLine: null,
    };
  }
  return {
    id: 'velocity',
    label: 'Velocity',
    windowLabel,
    hasObservations: true,
    displayValue: `${velocity.rollingWindowCount} closed`,
    direction: trendDirection(velocity.trend.direction),
    directionLine: null,
  };
}

function bottleneckReadout(stageDwell: StageDwellReportResult): HealthReadout {
  const windowLabel = `${stageDwell.windowHours}h window`;
  if (!stageDwell.bottleneck) {
    return {
      id: 'bottleneck',
      label: 'Bottleneck stage',
      windowLabel,
      hasObservations: false,
      displayValue: NO_OBSERVATIONS,
      direction: null,
      directionLine: null,
    };
  }
  return {
    id: 'bottleneck',
    label: 'Bottleneck stage',
    windowLabel,
    hasObservations: true,
    displayValue: stageDwell.bottleneck.role,
    direction: null,
    directionLine: null,
  };
}

function reworkReadout(records: CompletedTicketRecord[], nowMs: number): ReworkReadout {
  const windowStartMs = nowMs - HEALTH_REWORK_WINDOW_DAYS * DAY_MS;
  const baselineStartMs = windowStartMs - HEALTH_REWORK_BASELINE_DAYS * DAY_MS;
  const signal = computeReworkSignal(records, windowStartMs, nowMs, baselineStartMs);
  const verdict = signal.hasSample ? diagnoseReworkSignal(signal) : null;
  const windowLabel = `${HEALTH_REWORK_WINDOW_DAYS}-day window`;
  const byRole = reworkBreakdownByRole(records, windowStartMs, nowMs);

  if (!signal.hasSample) {
    return {
      id: 'rework',
      label: 'Rework rate',
      windowLabel,
      hasObservations: false,
      displayValue: NO_OBSERVATIONS,
      direction: null,
      directionLine: null,
      byRole: [],
      verdict: null,
    };
  }

  return {
    id: 'rework',
    label: 'Rework rate',
    windowLabel,
    hasObservations: true,
    displayValue: formatPercent(signal.reworkRate as number),
    direction: null,
    directionLine: verdict ? verdict.likelyCause : null,
    byRole,
    verdict,
  };
}

export function buildBubbleHealthTrends(
  deliveryMetrics: DeliveryMetrics,
  stageDwell: StageDwellReportResult,
  reworkRecords: CompletedTicketRecord[],
  nowMs: number
): BubbleHealthTrendsPayload {
  return {
    traverseTime: traverseTimeReadout(deliveryMetrics.cycleTime),
    velocity: velocityReadout(deliveryMetrics.velocity),
    bottleneck: bottleneckReadout(stageDwell),
    rework: reworkReadout(reworkRecords, nowMs),
  };
}

export function readoutByFeatureName(payload: BubbleHealthTrendsPayload, readoutName: string): HealthReadout | ReworkReadout {
  const key = readoutName.trim().toLowerCase();
  if (key === 'traverse time') {
    return payload.traverseTime;
  }
  if (key === 'rework rate') {
    return payload.rework;
  }
  if (key === 'bottleneck stage') {
    return payload.bottleneck;
  }
  if (key === 'velocity') {
    return payload.velocity;
  }
  throw new Error(`unknown health readout "${readoutName}"`);
}
