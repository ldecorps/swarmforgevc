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
import { readLifecycleSnapshot } from '../metrics/lifecycleSnapshot';
import {
  computeNotDoneBurndownSeries,
  buildNotDoneBurndownSvg,
  renderNotDoneBurndownPng,
  NOT_DONE_BURNDOWN_DIAGRAM_NAME,
} from '../metrics/notDoneBurndown';
import { resolveProjectRoot, printJsonToStdout, runCliMain } from './swarm-metrics';
import { parseSnapshotPath } from './briefingSnapshotArgs';
import type { RenderedDiagram } from './render-briefing-diagrams';

// BL-897: snapshotPath, when given and usable (readLifecycleSnapshot
// degrades to null on missing/unreadable/stale), skips the full-history
// walk entirely - the shared, already-derived lifecycle records win over a
// fresh runGitLog/deriveTicketLifecycles call.
export function renderBriefingBurndown(
  projectRoot: string,
  nowMs: number = Date.now(),
  snapshotPath?: string
): RenderedDiagram[] {
  const shared = snapshotPath ? readLifecycleSnapshot(snapshotPath, nowMs) : null;
  const lifecycles = shared ?? [...deriveTicketLifecycles(runGitLog(projectRoot, 'backlog/', 'main')).values()];
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
  const snapshotPath = parseSnapshotPath(process.argv.slice(2));
  const diagrams = renderBriefingBurndown(projectRoot, Date.now(), snapshotPath);
  printJsonToStdout(diagrams);
}

if (require.main === module) {
  runCliMain(main);
}
