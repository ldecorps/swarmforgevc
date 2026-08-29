// BL-603: the registry of BL-594 behaviour-trend series published on the
// live holistic console's trends board.
//
// Adding a series is ONE edit: append an entry here. Neither
// buildTrendsBoardState nor the console renderer carries a per-series list,
// so a registered series appears on the board without either being touched.
//
// Every loader obeys the same honesty rule: no records means an EMPTY point
// array. None of them manufactures a zero-valued point to stand in for a
// period a producer never recorded, and none of them invents a series for a
// producer that has not landed a source reader yet - that reads as "no data
// yet", which is exactly what it is.

import { TrendSeriesPoint } from './trend';
import { TrendsBoardContext, TrendsBoardSeriesSource, meanPointsByPeriod, sumPointsByPeriod } from './trendsBoard';

import { readOutcomeRecords } from './humanLoopReliabilityStore';
import { aggregateOutcomeSuccessRate } from './humanLoopReliability';
import { readRotationEvents } from './rotationDynamicsStore';
import { aggregateRotationDynamics } from './rotationDynamics';
import { readSelfHealEvents } from './selfHealTelemetryStore';
import { aggregateSelfHealCounts } from './selfHealTelemetry';
import { readAlertRecords } from './alertTelemetryStore';
import { aggregateFalsePositiveRate } from './alertTelemetry';
import { computeIntakeBalance, deriveIntakeBalanceEvents } from './deliveryMetrics';
import { runGitLog } from './gitHistoryAdapter';
import { readCompactionRecords } from './compactionTelemetryStore';
import { aggregateCompactionCadence } from './compactionCadence';
import { aggregateHandoffLatencyByRole, gatherRoleHandoffLatencyRecords } from './handoffLatency';
import { parseRolesTsv, RoleEntry } from '../swarm/swarmState';
import { globalTokenTrendSeries, aggregateGlobalTokenBuckets } from './globalTokenConsumption';
import { readTranscriptUsage } from './transcriptUsage';

import * as fs from 'fs';
import * as path from 'path';

const DAY_MS = 24 * 60 * 60 * 1000;
const TRAILING_WINDOW_DAYS = 30;

function windowStartMs(nowMs: number): number {
  return nowMs - TRAILING_WINDOW_DAYS * DAY_MS;
}

function roleEntries(targetPath: string): RoleEntry[] {
  try {
    return parseRolesTsv(fs.readFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), 'utf8'));
  } catch {
    return [];
  }
}

// ── the nine BL-594 series ──────────────────────────────────────────────

const humanLoopReliability: TrendsBoardSeriesSource = {
  id: 'human-loop-reliability',
  label: 'Human-loop reliability',
  producer: 'humanLoopReliability.ts',
  loadPoints({ targetPath }) {
    const records = readOutcomeRecords(targetPath);
    if (records.length === 0) return [];
    return aggregateOutcomeSuccessRate(records, DAY_MS);
  },
};

const monoRouterRotation: TrendsBoardSeriesSource = {
  id: 'mono-router-rotation',
  label: 'Mono-router rotation',
  producer: 'rotationDynamics.ts',
  loadPoints({ targetPath, nowMs }) {
    const events = readRotationEvents(targetPath);
    if (events.length === 0) return [];
    return aggregateRotationDynamics(events, {
      startMs: windowStartMs(nowMs),
      endMs: nowMs,
      homeRole: 'coder',
    }).rotationsTrend.series;
  },
};

const selfHealEvents: TrendsBoardSeriesSource = {
  id: 'self-heal-events',
  label: 'Self-heal events',
  producer: 'selfHealTelemetry.ts',
  loadPoints({ targetPath, nowMs }) {
    // BL-597 landed but merge 2e37477ec dropped its production emit sites
    // (BL-1273 restores them), so this reads as no data yet today. That is
    // the honest answer: a flat line at zero here would read as "the swarm
    // never self-heals", the exact false green BL-597 exists to prevent.
    const events = readSelfHealEvents(targetPath);
    if (events.length === 0) return [];
    const byType = aggregateSelfHealCounts(events, { startMs: windowStartMs(nowMs), endMs: nowMs });
    return sumPointsByPeriod(Object.values(byType).map((trend) => trend.series));
  },
};

const falseAlarmRate: TrendsBoardSeriesSource = {
  id: 'false-alarm-rate',
  label: 'False-alarm rate',
  producer: 'alertTelemetry.ts',
  loadPoints({ targetPath }) {
    const records = readAlertRecords(targetPath);
    if (records.length === 0) return [];
    return aggregateFalsePositiveRate(records, DAY_MS);
  },
};

const intakeBalance: TrendsBoardSeriesSource = {
  id: 'intake-balance',
  label: 'Intake balance (filed - closed)',
  producer: 'deliveryMetrics.ts',
  loadPoints({ targetPath, nowMs }) {
    const events = deriveIntakeBalanceEvents(runGitLog(targetPath, 'backlog'));
    if (events.filedAtMs.length === 0 && events.closedAtMs.length === 0) return [];
    return computeIntakeBalance(events, nowMs).trend.series;
  },
};

const humanDecisionLatency: TrendsBoardSeriesSource = {
  id: 'human-decision-latency',
  label: 'Human decision latency',
  producer: 'humanDecisionLatency.ts',
  loadPoints() {
    // BL-600's aggregator is pure over ask/verdict pairs and no source
    // reader has landed to supply them, so there is nothing to plot. A
    // consumer slice does not add the instrumentation (out of scope); it
    // reports the absence honestly instead.
    return [];
  },
};

const compactionCadence: TrendsBoardSeriesSource = {
  id: 'compaction-cadence',
  label: 'Compaction cadence',
  producer: 'compactionCadence.ts',
  loadPoints({ targetPath, nowMs }) {
    const records = readCompactionRecords(targetPath);
    if (records.length === 0) return [];
    const roles = roleEntries(targetPath).map((entry) => entry.role);
    const perRole = aggregateCompactionCadence(records, roles, nowMs);
    // Cadence is a per-hour RATE, so roles combine by mean, not by sum.
    return meanPointsByPeriod(
      perRole.filter((role) => role.trend !== null).map((role) => (role.trend as { series: TrendSeriesPoint[] }).series)
    );
  },
};

const handoffLatency: TrendsBoardSeriesSource = {
  id: 'handoff-latency',
  label: 'Handoff latency (median)',
  producer: 'handoffLatency.ts',
  loadPoints({ targetPath, nowMs }) {
    const records = roleEntries(targetPath).flatMap((entry) => gatherRoleHandoffLatencyRecords(entry, nowMs));
    if (records.length === 0) return [];
    const perRole = aggregateHandoffLatencyByRole(records, { startMs: windowStartMs(nowMs), endMs: nowMs });
    // A median latency is not additive across roles either.
    return meanPointsByPeriod(perRole.map((role) => role.medianTrend.series));
  },
};

const globalTokenConsumption: TrendsBoardSeriesSource = {
  id: 'global-token-tokens',
  label: 'Global token consumption',
  producer: 'globalTokenConsumption.ts',
  loadPoints({ targetPath }) {
    const entries = roleEntries(targetPath);
    const recordsByRole: Record<string, ReturnType<typeof readTranscriptUsage>> = {};
    for (const entry of entries) {
      recordsByRole[entry.role] = readTranscriptUsage(entry.worktreePath);
    }
    const total = Object.values(recordsByRole).reduce((sum, records) => sum + records.length, 0);
    if (total === 0) return [];
    return globalTokenTrendSeries(
      aggregateGlobalTokenBuckets({
        recordsByRole,
        expectedRoles: entries.map((entry) => entry.role),
        bucketMs: DAY_MS,
      })
    );
  },
};

/** The published board. One entry per series; order is the board's order. */
export const TRENDS_BOARD_SERIES: TrendsBoardSeriesSource[] = [
  humanLoopReliability,
  monoRouterRotation,
  selfHealEvents,
  falseAlarmRate,
  intakeBalance,
  humanDecisionLatency,
  compactionCadence,
  handoffLatency,
  globalTokenConsumption,
];

/** Exported for the acceptance's reachability check. */
export function registeredSeriesIds(
  registry: TrendsBoardSeriesSource[] = TRENDS_BOARD_SERIES
): string[] {
  return registry.map((source) => source.id);
}

export { TrendsBoardContext };
