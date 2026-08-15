#!/usr/bin/env node
/**
 * Not-done ticket burndown PNG for briefing_email_lib.bb (Babashka cannot
 * import compiled TS/npm packages). Same shell-out + JSON
 * [{name, base64}...] contract as render-briefing-diagrams.js so handoffd
 * can merge this chart into the daily briefing's cid-PNG attachments.
 *
 * Usage: node render-briefing-burndown.js
 *
 * A non-zero exit (git history unavailable, empty series, render failure)
 * is the daemon's signal to omit the burndown this run — never crash the
 * briefing send.
 */
import { runGitLog, deriveTicketLifecycles } from '../metrics/gitHistoryAdapter';
import {
  computeNotDoneBurndownSeries,
  buildNotDoneBurndownSvg,
  renderNotDoneBurndownPng,
  NOT_DONE_BURNDOWN_DIAGRAM_NAME,
} from '../metrics/notDoneBurndown';
import { resolveProjectRoot, printJsonToStdout, runCliMain } from './swarm-metrics';
import type { RenderedDiagram } from './render-briefing-diagrams';

export function renderBriefingBurndown(projectRoot: string, nowMs: number = Date.now()): RenderedDiagram[] {
  const history = runGitLog(projectRoot, 'backlog/', 'main');
  const lifecycles = [...deriveTicketLifecycles(history).values()];
  const series = computeNotDoneBurndownSeries(lifecycles, nowMs);
  if (series.series.length === 0) {
    throw new Error('not-done burndown series is empty');
  }
  const svg = buildNotDoneBurndownSvg(series);
  const png = renderNotDoneBurndownPng(svg);
  return [{ name: NOT_DONE_BURNDOWN_DIAGRAM_NAME, base64: png.toString('base64') }];
}

export function main(): void {
  const projectRoot = resolveProjectRoot(process.cwd());
  const diagrams = renderBriefingBurndown(projectRoot);
  printJsonToStdout(diagrams);
}

if (require.main === module) {
  runCliMain(main);
}
