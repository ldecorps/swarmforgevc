#!/usr/bin/env node
/**
 * BL-143/BL-323: coordinator-facing queue status. Default output reports
 * new/in_process counts per role SEPARATELY (never flattened into one
 * "N pending" count) - sidecar files (.chase.json, .nudge) are hidden
 * unless --debug is passed, so a coordinator (agent or human) checking
 * "is there pending work" never mistakes chaser metadata for a queued
 * parcel, and never reads an in_process claim as "0 pending" the way a
 * combined count did (BL-323's own ~4-hour real stall: new/ was empty,
 * in_process held an orphaned parcel, and every count-based surface
 * reported it identically to a genuinely idle role).
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

// BL-323: the one place "no work" vs "work claimed by nobody" is decided -
// pure so it is independently testable from the sidecar-suffix formatting
// below. There is no liveness signal here (a genuinely live agent's
// in_process claim is indistinguishable from an orphaned one without the
// stale-claim reaper's own pid/session signal, explicitly a separate,
// future slice) - a non-empty in_process with an empty new/ is always
// reported as "claimed by nobody" on the conservative assumption that it
// is worth a human/coordinator glance either way, rather than silently
// reading identically to true idle.
export function formatRoleStatus(v: RoleQueueView): string {
  const newCount = v.newPayloads.length;
  const inProcessCount = v.inProcessPayloads.length;
  if (newCount === 0 && inProcessCount === 0) {
    return `[${v.role}] no work pending`;
  }
  if (newCount > 0) {
    const inProcessSuffix = inProcessCount > 0 ? `, ${inProcessCount} in_process` : '';
    return `[${v.role}] ${newCount} new pending${inProcessSuffix}`;
  }
  return `[${v.role}] work claimed by nobody (${inProcessCount} in_process, 0 new)`;
}

export function formatQueueStatus(views: RoleQueueView[], debug: boolean): string {
  return views
    .map((v) => {
      const base = formatRoleStatus(v);
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
