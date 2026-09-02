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
  SeatDwellDetail,
  computeSeatDwellDetail,
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

// BL-1319: the ops seat-and-model view. The report above names stages only -
// that is the optimizer's answer and the fold is what makes it correct. This
// section is the sanctioned seat-level detail behind that fold, on an ops
// surface rather than in the bridge payload.
//
// Rendered ONLY where a stage actually runs more than one seat. A single-seat
// swarm's report is byte-identical to what it was before this ticket, which
// is the same losslessness the fold itself promises.
export function formatSeatDwellDetail(seats: SeatDwellDetail[]): string {
  const byStage = new Map<string, SeatDwellDetail[]>();
  for (const seat of seats) {
    const existing = byStage.get(seat.stage);
    if (existing) {
      existing.push(seat);
    } else {
      byStage.set(seat.stage, [seat]);
    }
  }
  const multiSeat = [...byStage.entries()].filter(([, rows]) => rows.length > 1);
  if (multiSeat.length === 0) {
    return '';
  }
  const lines = ['Seats:'];
  for (const [stage, rows] of multiSeat) {
    lines.push(`  ${stage}: ${rows.length} seat(s)`);
    for (const row of rows) {
      lines.push(
        `    ${row.seat} (${row.agent}): ${row.parcelsProcessed} parcel(s) - ` +
          `${formatDwellStats('wait', row.queueWait)}, ${formatDwellStats('processing', row.processing)}`
      );
    }
  }
  return lines.join('\n');
}

interface CliArgs {
  json: boolean;
  hours: number;
}

function parseHoursFlag(argv: string[]): number {
  const hoursIdx = argv.indexOf('--hours');
  const value = hoursIdx === -1 ? NaN : Number(argv[hoursIdx + 1]);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_STAGE_DWELL_WINDOW_HOURS;
}

export function parseArgs(argv: string[]): CliArgs {
  return { json: argv.includes('--json'), hours: parseHoursFlag(argv) };
}

export function main(): void {
  const { json, hours } = parseArgs(process.argv.slice(2));
  const projectRoot = resolveProjectRoot(process.cwd());
  const roles = loadRoles(projectRoot);
  const nowMs = Date.now();
  const result = computeStageDwellReportForRoles(roles, nowMs, hours);
  const seats = computeSeatDwellDetail(roles, nowMs, hours);

  if (json) {
    // The seat detail rides the ops CLI's own JSON, never the bridge's
    // /stage-dwell payload - that one stays seat-free.
    printJsonToStdout({ ...result, seats });
  } else {
    console.log(formatStageDwellReport(result));
    const seatText = formatSeatDwellDetail(seats);
    if (seatText) {
      console.log(seatText);
    }
  }
}

if (require.main === module) {
  runCliMain(main);
}
