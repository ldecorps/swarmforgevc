// BL-759: disk-reading pipeline-drain helpers extracted from
// telegram-front-desk-bot.ts so Cursor-operator modules can use them
// without forming an import cycle back into the bot. Decisions unchanged —
// same roles.tsv + inboxChaser scans as before.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseRolesTsv } from '../swarm/swarmState';
import { buildRoleInboxes } from '../watchdog/chaserMonitor';
import { scanInboxNew, scanInProcess } from '../swarm/inboxChaser';

/** Live roles from `.swarmforge/roles.tsv` (same source as notify-dead-letters). */
export function resolveLiveRoles(targetPath: string): { role: string; worktreePath: string }[] {
  try {
    return parseRolesTsv(fs.readFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), 'utf8')).map((r) => ({
      role: r.role,
      worktreePath: r.worktreePath,
    }));
  } catch {
    return [];
  }
}

/**
 * True when no parcel sits in any live role's inbox/new or in_process
 * (BL-423 drain-empty definition).
 */
export function isPipelineEmpty(targetPath: string): boolean {
  const roles = resolveLiveRoles(targetPath).map((r) => r.role);
  const roleInboxes = buildRoleInboxes(targetPath, roles);
  return roleInboxes.every(
    ({ inboxNewDir, inProcessDir }) =>
      scanInboxNew(inboxNewDir).length === 0 && scanInProcess(inProcessDir).length === 0
  );
}
