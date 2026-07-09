#!/usr/bin/env node
/**
 * BL-143: coordinator-facing queue status. Default output lists only real
 * .handoff payload counts per role - sidecar files (.chase.json, .nudge)
 * are hidden unless --debug is passed, so a coordinator (agent or human)
 * checking "is there pending work" never mistakes chaser metadata for a
 * queued parcel.
 *
 * Usage: node queue-status.js [--debug]
 *
 * Runnable from the repo root or any .worktrees/<role>/ checkout, same
 * project-root resolution as swarm-metrics.ts/list-dead-letters.ts.
 * Read-only, headless: no VS Code required.
 */

import * as path from 'path';
import { computeRoleQueueView, RoleQueueView } from '../swarm/inboxVisibility';
import { resolveProjectRoot, loadRoles, runCliMain } from './swarm-metrics';

export function formatQueueStatus(views: RoleQueueView[], debug: boolean): string {
  return views
    .map((v) => {
      const base = `[${v.role}] ${v.payloads.length} pending`;
      if (!debug || v.sidecars.length === 0) {
        return base;
      }
      const sidecarList = v.sidecars.map((s) => `${s.name} (${s.kind})`).join(', ');
      return `${base} | sidecars (debug): ${sidecarList}`;
    })
    .join('\n');
}

export function main(): void {
  const debug = process.argv.includes('--debug');
  const projectRoot = resolveProjectRoot(process.cwd());
  const roles = loadRoles(projectRoot);

  const views = roles.map((r) =>
    computeRoleQueueView(
      r.role,
      path.join(r.worktreePath, '.swarmforge', 'handoffs', 'inbox', 'new'),
      path.join(r.worktreePath, '.swarmforge', 'handoffs', 'inbox', 'in_process'),
      debug
    )
  );

  console.log(formatQueueStatus(views, debug));
}

if (require.main === module) {
  runCliMain(main);
}
