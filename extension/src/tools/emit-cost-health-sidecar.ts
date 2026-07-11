#!/usr/bin/env node
/**
 * BL-272: headless entrypoint for BL-213's deterministic cost & health
 * sidecar emitter. Mirrors extension.ts's onBriefingDue host path exactly
 * (compute -> write -> commit, notify/costHealthSidecar.ts, unchanged) so a
 * swarm running headless (no VS Code extension host) still gets
 * docs/briefings/<date>.json emitted for the day. Idempotent: an unchanged
 * day's sidecar is not committed twice (commitCostHealthSidecar already
 * fails closed on a no-op `git commit`).
 *
 * Usage: node emit-cost-health-sidecar.js
 * Prints "EMITTED <path>" on a new/changed commit, "NOOP <path>" when the
 * sidecar content was unchanged (no duplicate commit).
 */
import { resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';
import { computeCostHealthSidecar, writeCostHealthSidecar, commitCostHealthSidecar } from '../notify/costHealthSidecar';

// Exported (same "CLI main() run only via execFileSync is coverage-invisible"
// lesson this codebase's other CLIs already established - e.g.
// not-done-count-line.ts's formatNotDoneCountLine) so the branch is
// exercised in-process instead of only through the compiled CLI's
// subprocess test.
export function formatEmitResult(committed: boolean, filePath: string): string {
  return `${committed ? 'EMITTED' : 'NOOP'} ${filePath}`;
}

export function main(): void {
  const { mainWorktreePath, roleWorktrees } = resolveCliMainWorktreeContext();
  const sidecar = computeCostHealthSidecar(mainWorktreePath, roleWorktrees);
  const filePath = writeCostHealthSidecar(mainWorktreePath, sidecar);
  const committed = commitCostHealthSidecar(mainWorktreePath, filePath, sidecar.dateIso);
  console.log(formatEmitResult(committed, filePath));
}

if (require.main === module) {
  runCliMain(main);
}
