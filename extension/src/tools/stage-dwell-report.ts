#!/usr/bin/env node
/**
 * BL-102: stage-dwell & bottleneck report - the coordinator's swarm-
 * optimizer instrument, as a CLI. Reports per-stage queue-wait and
 * processing dwell over a selectable window (default 24h), the bottleneck
 * stage and its multiple over the next slowest, and outlier honesty.
 *
 * Usage: node stage-dwell-report.js [--hours N] [--json]
 *
 * Runnable from the repo root or any .worktrees/<role>/ checkout, same as
 * swarm-metrics.ts. Read-only, headless: no VS Code required. Fed by
 * metrics/stageDwell.ts - the SAME computation the bridge's /stage-dwell
 * endpoint calls (metrics-09 spirit: CLI and bridge report the same numbers).
 */

import {
  computeStageDwellReportForRoles,
  DEFAULT_STAGE_DWELL_WINDOW_HOURS,
  StageDwellReport,
  StageDwellReportResult,
  BottleneckSummary,
  DwellStats,
} from '../metrics/stageDwell';
import { formatDurationMs, NO_SAMPLE_PLACEHOLDER } from '../metrics/swarmMetrics';
import { resolveProjectRoot, loadRoles, printJsonToStdout, runCliMain, formatTrend } from './swarm-metrics';

function formatMs(ms: number | null): string {
  return ms === null ? NO_SAMPLE_PLACEHOLDER : formatDurationMs(ms);
}

function formatDwellStats(label: string, stats: DwellStats): string {
  const outlierNote = stats.outliersMs.length > 0 ? ` (+${stats.outliersMs.length} outlier(s))` : '';
  return `${label} median ${formatMs(stats.medianMs)} / p90 ${formatMs(stats.p90Ms)} / max ${formatMs(stats.maxMs)}${outlierNote}`;
}

function formatStageLine(stage: StageDwellReport): string {
  const trendText = formatTrend(stage.trend, formatDurationMs);
  return (
    `${stage.role}: ${stage.parcelsProcessed} parcel(s) - ` +
    `${formatDwellStats('wait', stage.queueWait)}, ${formatDwellStats('processing', stage.processing)}${trendText}`
  );
}

function formatBottleneckLine(bottleneck: BottleneckSummary | null): string {
  if (!bottleneck) {
    return 'Bottleneck: (no stage processed a parcel this window)';
  }
  const multipleText = bottleneck.multipleOverNext === null ? '' : ` (${bottleneck.multipleOverNext.toFixed(1)}x the next slowest stage)`;
  return `Bottleneck: ${bottleneck.role}${multipleText}`;
}

export function formatStageDwellReport(result: StageDwellReportResult): string {
  const lines = [
    `Stage dwell (${result.windowHours}h window, ${result.windowStartIso} .. ${result.windowEndIso}):`,
    ...result.stages.map(formatStageLine),
    formatBottleneckLine(result.bottleneck),
  ];
  if (result.unparseableCount > 0) {
    lines.push(`(${result.unparseableCount} handoff header(s) could not be parsed and were skipped)`);
  }
  return lines.join('\n');
}

interface CliArgs {
  json: boolean;
  hours: number;
}

function parseArgs(argv: string[]): CliArgs {
  let hours = DEFAULT_STAGE_DWELL_WINDOW_HOURS;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') {
      json = true;
    } else if (argv[i] === '--hours') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        hours = value;
      }
      i++;
    }
  }
  return { json, hours };
}

export function main(): void {
  const { json, hours } = parseArgs(process.argv.slice(2));
  const projectRoot = resolveProjectRoot(process.cwd());
  const roles = loadRoles(projectRoot);
  const result = computeStageDwellReportForRoles(roles, Date.now(), hours);

  if (json) {
    printJsonToStdout(result);
  } else {
    console.log(formatStageDwellReport(result));
  }
}

if (require.main === module) {
  runCliMain(main);
}
