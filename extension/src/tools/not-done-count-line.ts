#!/usr/bin/env node
/**
 * BL-263: prints ONE plain-text line - the not-done ticket total - for
 * briefing_email_lib.bb (a Babashka script with no way to import compiled
 * TS) to shell out to and fold into the daily briefing. Reuses
 * computeBacklogDashboard's own notDoneCount field unchanged (the SAME
 * number the PWA reads from backlog.json) - never a second "not done"
 * derivation, so the briefing and the PWA can never disagree.
 *
 * Usage: node not-done-count-line.js
 */
import { computeBacklogDashboard } from '../metrics/backlogDashboard';
import { resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

export function formatNotDoneCountLine(notDoneCount: number): string {
  return `Not done: ${notDoneCount} ticket${notDoneCount === 1 ? '' : 's'}`;
}

export function main(): void {
  const { mainWorktreePath, roleWorktrees } = resolveCliMainWorktreeContext();
  const dashboard = computeBacklogDashboard(mainWorktreePath, roleWorktrees);
  console.log(formatNotDoneCountLine(dashboard.notDoneCount));
}

if (require.main === module) {
  runCliMain(main);
}
