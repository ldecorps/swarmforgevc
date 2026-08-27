#!/usr/bin/env node
/**
 * Shift-velocity PNG for briefing_email_lib.bb (BL-1184). Same [{name, base64}]
 * contract as render-briefing-burndown.js.
 */
import { readLifecycleSnapshot } from '../metrics/lifecycleSnapshot';
import { runGitLog, deriveTicketLifecycles } from '../metrics/gitHistoryAdapter';
import { computeDailyShiftVelocitySeries } from '../metrics/shiftVelocity';
import {
  buildShiftVelocitySvg,
  renderShiftVelocityPng,
  SHIFT_VELOCITY_DIAGRAM_NAME,
} from '../metrics/shiftVelocityChart';
import {
  appendShiftVelocityRecord,
} from '../metrics/shiftVelocityTelemetryStore';
import { resolveProjectRoot, printJsonToStdout, runCliMain } from './swarm-metrics';
import { parseSnapshotPath } from './briefingSnapshotArgs';
import type { RenderedDiagram } from './render-briefing-diagrams';

function recordTodayIfNeeded(projectRoot: string, nowMs: number, series: ReturnType<typeof computeDailyShiftVelocitySeries>): void {
  if (series.series.length === 0) {
    return;
  }
  const last = series.series[series.series.length - 1];
  appendShiftVelocityRecord(projectRoot, {
    at: new Date(nowMs).toISOString(),
    dayLabel: last.label,
    landedMax: last.landedMax,
    windowHours: series.windowHours,
  });
}

export function renderBriefingShiftVelocity(
  projectRoot: string,
  nowMs: number = Date.now(),
  snapshotPath?: string
): RenderedDiagram[] {
  const shared = snapshotPath ? readLifecycleSnapshot(snapshotPath, nowMs) : null;
  const lifecycles =
    shared ?? [...deriveTicketLifecycles(runGitLog(projectRoot, 'backlog/', 'main')).values()];
  const series = computeDailyShiftVelocitySeries(lifecycles, nowMs);
  if (series.series.length === 0) {
    throw new Error('shift-velocity series is empty');
  }
  recordTodayIfNeeded(projectRoot, nowMs, series);
  const svg = buildShiftVelocitySvg(series);
  const png = renderShiftVelocityPng(svg);
  return [{ name: SHIFT_VELOCITY_DIAGRAM_NAME, base64: png.toString('base64') }];
}

export function main(): void {
  const projectRoot = resolveProjectRoot(process.cwd());
  const snapshotPath = parseSnapshotPath(process.argv.slice(2));
  const diagrams = renderBriefingShiftVelocity(projectRoot, Date.now(), snapshotPath);
  printJsonToStdout(diagrams);
}

if (require.main === module) {
  runCliMain(main);
}
