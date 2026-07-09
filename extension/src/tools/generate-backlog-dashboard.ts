#!/usr/bin/env node
/**
 * BL-097: generates backlog.json for the Pages-hosted PWA dashboard.
 *
 * Usage: node generate-backlog-dashboard.js > backlog.json
 *
 * Thin presenter over computeBacklogDashboard (metrics/backlogDashboard.ts) -
 * no derivation logic here, matching this ticket's own non-behavioral gate
 * ("the workflow YAML holds no logic beyond invoking it and publishing").
 * Prints ONLY the JSON payload to stdout so the GitHub Action can redirect
 * it straight to a file.
 */

import { computeBacklogDashboard } from '../metrics/backlogDashboard';
import { resolveCliMainWorktreeContext, printJsonToStdout, runCliMain } from './swarm-metrics';

export function main(): void {
  const { mainWorktreePath, roleWorktrees } = resolveCliMainWorktreeContext();
  const dashboard = computeBacklogDashboard(mainWorktreePath, roleWorktrees);
  printJsonToStdout(dashboard);
}

if (require.main === module) {
  runCliMain(main);
}
