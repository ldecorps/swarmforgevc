// BL-526: live pipeline STATUS GRID snapshot for the bridge Mini App.

import { readBacklogFolders } from '../panel/backlogReader';
import {
  computePipelineBoard,
  renderPipelineBoardGridOnly,
  PipelineBoardPausedItem,
  PipelineBoardTicketMeta,
} from '../concierge/pipelineBoard';
import {
  readTicketStageMap,
  invertTicketStageToRoleHeldTickets,
} from '../swarm/swarmState';

export interface PipelineGridLiveSnapshot {
  boardText: string;
  rowCount: number;
}

export function capturePipelineGridLive(targetPath: string, nowMs: number = Date.now()): PipelineGridLiveSnapshot {
  const folders = readBacklogFolders(targetPath);
  const ticketMeta: Record<string, PipelineBoardTicketMeta> = {};
  for (const item of folders.active) {
    ticketMeta[item.id] = {
      epic: item.epic,
      type: item.type,
      title: item.title,
      filename: item.filename,
      location: 'active',
    };
  }
  for (const item of folders.paused) {
    ticketMeta[item.id] = {
      epic: item.epic,
      type: item.type,
      title: item.title,
      filename: item.filename,
      location: 'paused',
    };
  }
  const paused: PipelineBoardPausedItem[] = folders.paused.map((item) => ({
    id: item.id,
    humanApproval: item.humanApproval === 'pending' || item.humanApproval === 'approved'
      ? item.humanApproval
      : undefined,
    priority: item.priority,
    type: item.type,
    epic: item.epic,
  }));
  const roleHeld = invertTicketStageToRoleHeldTickets(readTicketStageMap(targetPath));
  const data = computePipelineBoard(roleHeld, paused, ticketMeta, {
    activeIds: folders.active.map((item) => item.id),
  });
  return {
    boardText: renderPipelineBoardGridOnly(data, nowMs),
    rowCount: data.rows.length,
  };
}
