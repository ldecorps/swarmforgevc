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

export function main(): void {
  const { mainWorktreePath, roleWorktrees } = resolveCliMainWorktreeContext();
  const sidecar = computeCostHealthSidecar(mainWorktreePath, roleWorktrees);
  const filePath = writeCostHealthSidecar(mainWorktreePath, sidecar);
  const committed = commitCostHealthSidecar(mainWorktreePath, filePath, sidecar.dateIso);
  console.log(`${committed ? 'EMITTED' : 'NOOP'} ${filePath}`);
}

if (require.main === module) {
  runCliMain(main);
}
