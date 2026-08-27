// BL-649: pending approval announcement at swarm start — bridge/concierge hook
// POST new Approvals topic message when the pending set is non-empty at bot up.

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { readBacklogFolders } from '../panel/backlogReader';
import { computeNeedsApproval } from '../metrics/backlogDashboard';
import {
  PendingApprovalAnnouncementTicket,
  PendingApprovalsAnnouncementAdapters,
  PendingApprovalsAnnouncementResult,
  runPendingApprovalsAnnouncement,
} from './pendingApprovalsAnnouncement';
import {
  readApprovalsAnnouncementMarker,
  withApprovalsAnnouncementMarker,
} from './pendingApprovalsAnnouncementMarker';
import type { TickState } from './conciergeTick';

export type TickStateReader = (targetPath: string) => TickState;
export type TickStateWriter = (targetPath: string, state: TickState) => void;

function relBacklogYamlPath(targetPath: string, ticketId: string): string | undefined {
  for (const folder of ['active', 'paused']) {
    const dir = path.join(targetPath, 'backlog', folder);
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(ticketId) && name.endsWith('.yaml')) {
        return `backlog/${folder}/${name}`;
      }
    }
  }
  return undefined;
}

function parseGitTimestamp(stdout: string): number | undefined {
  const line = stdout.split('\n').map((row) => row.trim()).find((row) => row.length > 0);
  if (!line || !/^[0-9]+$/.test(line)) {
    return undefined;
  }
  const seconds = Number.parseInt(line, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

export function readApprovalPendingSinceMs(targetPath: string, ticketId: string): number | undefined {
  const rel = relBacklogYamlPath(targetPath, ticketId);
  if (!rel) {
    return undefined;
  }
  try {
    const stdout = execFileSync('git', ['log', '-1', '--format=%at', '-S', 'human_approval: pending', '--', rel], {
      cwd: targetPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseGitTimestamp(stdout);
  } catch {
    return undefined;
  }
}

function ticketsFromBacklog(targetPath: string): PendingApprovalAnnouncementTicket[] {
  const folders = readBacklogFolders(targetPath);
  return computeNeedsApproval(folders.active, folders.paused).map((item) => ({
    id: item.id,
    title: item.title,
    approvalContext: item.approvalContext,
    pendingSinceMs: readApprovalPendingSinceMs(targetPath, item.id),
  }));
}

export async function runPendingApprovalAnnouncementHook(
  targetPath: string,
  adapters: PendingApprovalsAnnouncementAdapters,
  nowMs: number,
  readState: TickStateReader,
  writeState: TickStateWriter
): Promise<PendingApprovalsAnnouncementResult> {
  const tickets = ticketsFromBacklog(targetPath);
  const state = readState(targetPath);
  const marker = readApprovalsAnnouncementMarker(state);
  const result = await runPendingApprovalsAnnouncement(tickets, marker, adapters, nowMs);
  if (result.marker) {
    writeState(targetPath, withApprovalsAnnouncementMarker(state, result.marker));
  }
  return result;
}
