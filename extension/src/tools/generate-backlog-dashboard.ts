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
import { resolveProjectRoot, resolveMainWorktreePath, loadRoles, runCliMain } from './swarm-metrics';

export function main(): void {
  const projectRoot = resolveProjectRoot(process.cwd());
  const roles = loadRoles(projectRoot);
  const mainWorktreePath = resolveMainWorktreePath(projectRoot, roles);

  const dashboard = computeBacklogDashboard(
    mainWorktreePath,
    roles.map((r) => ({ role: r.role, worktreePath: r.worktreePath }))
  );
  process.stdout.write(JSON.stringify(dashboard, null, 2) + '\n');
}

if (require.main === module) {
  runCliMain(main);
}
