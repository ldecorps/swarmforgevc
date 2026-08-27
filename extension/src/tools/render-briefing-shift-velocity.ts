#!/usr/bin/env node
/**
 * Shift-velocity PNG for the daily briefing email (BL-1184). Same JSON
 * [{name, base64}] contract as render-briefing-burndown.ts.
 */
import { runGitLog } from '../metrics/gitHistoryAdapter';
import {
  buildShiftVelocityHistoryFromGitEntries,
  computeDailyShiftVelocitySeries,
} from '../metrics/shiftVelocity';
import {
  SHIFT_VELOCITY_DIAGRAM_NAME,
  buildShiftVelocitySvg,
  renderShiftVelocityPng,
} from '../metrics/shiftVelocityChart';
import { resolveProjectRoot, printJsonToStdout, runCliMain } from './swarm-metrics';
import type { RenderedDiagram } from './render-briefing-diagrams';

const DEFAULT_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export function renderBriefingShiftVelocity(
  projectRoot: string,
  nowMs: number = Date.now(),
  windowDays: number = DEFAULT_WINDOW_DAYS
): RenderedDiagram[] {
  const history = buildShiftVelocityHistoryFromGitEntries(runGitLog(projectRoot, 'backlog/', 'main'));
  const series = computeDailyShiftVelocitySeries(history.closedAtMs, nowMs);
  const windowStartMs = nowMs - windowDays * DAY_MS;
  const windowed = series.filter((point) => Date.parse(point.periodStart) >= windowStartMs);
  if (windowed.length === 0) {
    throw new Error('shift-velocity series is empty');
  }
  const svg = buildShiftVelocitySvg({ points: windowed, windowDays: windowed.length });
  const png = renderShiftVelocityPng(svg);
  return [{ name: SHIFT_VELOCITY_DIAGRAM_NAME, base64: png.toString('base64') }];
}

export function main(): void {
  const projectRoot = resolveProjectRoot(process.cwd());
  const diagrams = renderBriefingShiftVelocity(projectRoot);
  printJsonToStdout(diagrams);
}

if (require.main === module) {
  runCliMain(main);
}
