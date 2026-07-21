#!/usr/bin/env node
/**
 * BL-251: prints the needs-human-approval section for briefing_email_lib.bb
 * to shell out to and fold into the daily briefing. Reuses
 * computeBacklogDashboard's own needsApproval field unchanged (the SAME
 * computation backlog.json/the PWA already carry) - never a second
 * "pending" derivation, so the briefing and the PWA can never disagree.
 *
 * No translation pass (unlike generate-backlog-dashboard.js's own CLI):
 * the briefing is English-only prose, and running a translation session
 * here would add unwanted side effects (network calls, cache writes) to
 * what should stay a lightweight, read-only shell-out.
 *
 * Usage: node needs-approval-line.js
 */
import { computeBacklogDashboard, NeedsApprovalEntry } from '../metrics/backlogDashboard';
import { resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

export function formatNeedsApprovalSection(entries: NeedsApprovalEntry[]): string {
  if (entries.length === 0) {
    return 'Needs approval: nothing awaiting approval.';
  }
  const lines = entries.map((entry) => `  - ${entry.id}: ${entry.title}`);
  return ['Needs approval:', ...lines].join('\n');
}

export function main(): void {
  const { mainWorktreePath, roleWorktrees } = resolveCliMainWorktreeContext();
  const dashboard = computeBacklogDashboard(mainWorktreePath, roleWorktrees);
  console.log(formatNeedsApprovalSection(dashboard.needsApproval));
}

if (require.main === module) {
  runCliMain(main);
}
