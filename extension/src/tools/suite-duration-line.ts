#!/usr/bin/env node
/**
 * BL-252: prints ONE plain-text line - the unit-test suite-duration trend
 * plus the BL-078 regression-warn flag - for briefing_email_lib.bb (a
 * Babashka script with no way to import compiled TS) to shell out to and
 * fold into the daily briefing. Reuses computeSuiteDurationTrend and
 * formatSuiteDurationTrendLine unchanged - the SAME functions already
 * wired into the bridge's /metrics route the holistic UI reads, so the
 * briefing can never disagree with the live UI about what "regressing"
 * means.
 *
 * Usage: node suite-duration-line.js
 *
 * Runnable from the repo root or any .worktrees/<role>/ checkout, same
 * project-root resolution as swarm-metrics.ts/queue-status.ts. Read-only,
 * headless: no VS Code required.
 */

import { computeSuiteDurationTrend } from '../metrics/deliveryMetrics';
import { resolveMainWorktreePath, resolveProjectRoot, loadRoles, formatSuiteDurationTrendLine, runCliMain } from './swarm-metrics';

export function main(): void {
  const projectRoot = resolveProjectRoot(process.cwd());
  const roles = loadRoles(projectRoot);
  const mainWorktreePath = resolveMainWorktreePath(projectRoot, roles);
  const roleWorktrees = roles.map((r) => ({ role: r.role, worktreePath: r.worktreePath }));

  const trend = computeSuiteDurationTrend(mainWorktreePath, roleWorktrees, Date.now());
  console.log(formatSuiteDurationTrendLine(trend));
}

if (require.main === module) {
  runCliMain(main);
}
