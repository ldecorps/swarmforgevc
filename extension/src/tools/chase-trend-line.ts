#!/usr/bin/env node
/**
 * BL-256 qa-bounce-chase-trends-03: the pipeline-health section of the
 * daily briefing - reuses BL-098's durably-logged chase/nudge telemetry
 * (swarmMetrics.ts's computeChaserTelemetry, the SAME reader
 * swarm-metrics.ts's own "Chaser telemetry" line already uses) over two
 * adjacent windows to get an up/down/flat direction via the SAME shared
 * trend.ts computeTrend every other briefing trend already uses.
 *
 * Scope note: no distinct "QA-bounce rate" counter exists anywhere in
 * this codebase (grep-confirmed - the closest raw signal,
 * .swarmforge/reroute-state/ + run-log.jsonl, has no existing reader,
 * TS or bb). REUSE, don't re-derive (this ticket's own constraint) rules
 * out inventing one here; this reports the chase/nudge/dead-letter/
 * respawn counts and their trend - the real, already-computed "pipeline-
 * health circuit-breaker inputs" telemetry BL-098 exists for.
 *
 * Usage: node chase-trend-line.js
 */
import { computeChaserTelemetry, readChaserTelemetryEvents, ChaserTelemetry, ChaserTelemetryEvent } from '../metrics/swarmMetrics';
import { computeTrend, TrendResult } from '../metrics/trend';
import { resolveProjectRoot, loadRoles, runCliMain, formatTrend } from './swarm-metrics';

export const CHASE_TREND_WINDOW_DAYS = 7;

// The event types applyChaserEvent (swarmMetrics.ts) buckets into
// chases/nudges/deadLetters/respawns - kept in sync with that same set,
// each event counted once regardless of its own optional `count` field
// (matching applyChaserEvent's own `bucket[field] += 1` semantics exactly).
const COUNTED_EVENT_TYPES = new Set(['chase', 'nudge', 'dead-letter', 'respawn']);

// computeChaserTelemetry (swarmMetrics.ts) has NO upper bound - its window
// is "windowDays back from nowMs through the newest event in the log,"
// which is fine for a CURRENT total (nothing is ever logged with a future
// timestamp in real usage) but cannot produce a true, exclusively-bounded
// PRIOR window: calling it with an earlier nowMs still picks up every
// newer (i.e. "current window") event too, since there is still no upper
// cutoff. This reads the raw event log directly and buckets into two
// explicit, non-overlapping [start, end) windows instead.
//
// Split out of countEventsInWindow (below) so each function's own
// complexity - and CRAP score - stays low independently, same pattern as
// dependency-gate.ts's mediaJsFilesForScopePath split.
function isCountedEventInWindow(event: ChaserTelemetryEvent, roleSet: Set<string>, startMs: number, endMs: number): boolean {
  if (!roleSet.has(event.role) || !COUNTED_EVENT_TYPES.has(event.type)) {
    return false;
  }
  const atMs = Date.parse(event.at);
  return !Number.isNaN(atMs) && atMs >= startMs && atMs < endMs;
}

function countEventsInWindow(events: ChaserTelemetryEvent[], roleNames: string[], startMs: number, endMs: number): number {
  const roleSet = new Set(roleNames);
  let count = 0;
  for (const event of events) {
    if (isCountedEventInWindow(event, roleSet, startMs, endMs)) {
      count += 1;
    }
  }
  return count;
}

// Two adjacent, non-overlapping CHASE_TREND_WINDOW_DAYS windows (current
// vs immediately prior) fed through the SAME computeTrend every other
// briefing trend (velocity/burndown/cycleTime/suite-duration) already
// uses, so this trend's up/down/flat reads consistently with the rest of
// the briefing.
export function computeChaseTrend(targetPath: string, roleNames: string[], nowMs: number = Date.now()): TrendResult {
  const windowMs = CHASE_TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const events = readChaserTelemetryEvents(targetPath);
  const currentTotal = countEventsInWindow(events, roleNames, nowMs - windowMs, nowMs);
  const priorTotal = countEventsInWindow(events, roleNames, nowMs - 2 * windowMs, nowMs - windowMs);
  return computeTrend([
    { periodStart: new Date(nowMs - 2 * windowMs).toISOString(), value: priorTotal },
    { periodStart: new Date(nowMs - windowMs).toISOString(), value: currentTotal },
  ]);
}

export function formatChaseTrendLine(current: ChaserTelemetry, trend: TrendResult, roleNames: string[]): string {
  const totalChases = roleNames.reduce((sum, r) => sum + (current[r]?.chases ?? 0), 0);
  const totalNudges = roleNames.reduce((sum, r) => sum + (current[r]?.nudges ?? 0), 0);
  const totalDeadLetters = roleNames.reduce((sum, r) => sum + (current[r]?.deadLetters ?? 0), 0);
  if (totalChases === 0 && totalNudges === 0 && totalDeadLetters === 0) {
    return `Chase/nudge trend: no chase or nudge activity in the trailing ${CHASE_TREND_WINDOW_DAYS}d.`;
  }
  const trendText = formatTrend(trend, (v) => `${v}`);
  return (
    `Chase/nudge trend: ${totalChases} chase(s), ${totalNudges} nudge(s), ${totalDeadLetters} dead-letter(s)` +
    ` over the trailing ${CHASE_TREND_WINDOW_DAYS}d${trendText}`
  );
}

export function main(): void {
  const projectRoot = resolveProjectRoot(process.cwd());
  const roleNames = loadRoles(projectRoot).map((r) => r.role);
  const current = computeChaserTelemetry(projectRoot, roleNames);
  const trend = computeChaseTrend(projectRoot, roleNames);
  console.log(formatChaseTrendLine(current, trend, roleNames));
}

if (require.main === module) {
  runCliMain(main);
}
