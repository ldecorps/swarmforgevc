// BL-526: live pipeline STATUS GRID snapshot for the bridge Mini App.
// BL-1188: prefers the same live pipeline_stage_cli.bb report Telegram's
// board already uses (BL-487) over the coordinator-written cache, which
// only advances on sync and read as "everyone is at coordinator" for any
// ticket the cache had not yet caught up to.

import { execFileSync } from 'child_process';
import * as path from 'path';
import { readBacklogFolders, BacklogItem } from '../panel/backlogReader';
import {
  computePipelineBoard,
  renderPipelineBoardGridOnly,
  PipelineBoardData,
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

/**
 * Sync counterpart of telegram-front-desk-bot.ts's async
 * `readLiveRoleHeldTickets` (BL-487) - same live source
 * (`pipeline_stage_cli.bb report`), same loud-failure contract (BL-814: a
 * computation that did not run must never read as "ran and found
 * nothing"). Sync because capturePipelineGridLive's only caller
 * (bridgeServer.ts's JSON route table) invokes `compute` synchronously and
 * does not await it - matching every other route in that table.
 */
export function readLiveRoleHeldTickets(targetPath: string): Record<string, string[]> {
  const cli = path.join(targetPath, 'swarmforge', 'scripts', 'pipeline_stage_cli.bb');
  const stdout = execFileSync('bb', [cli, targetPath, 'report'], { encoding: 'utf8' });
  const stageMap = JSON.parse(stdout) as Record<string, string>;
  return invertTicketStageToRoleHeldTickets(stageMap);
}

// BL-831: exported so the Bubble Pipeline page (bubblePipelinePage.ts) can
// drive the identical live-report-with-cache-fallback resolution this
// module's own capturePipelineGridLive uses, rather than reimplementing it
// as a second read model (BL-831 invariant 1).
export function resolveRoleHeld(targetPath: string): Record<string, string[]> {
  try {
    return readLiveRoleHeldTickets(targetPath);
  } catch {
    // BL-1188 invariant: the cache is a fallback only for when the live
    // report is UNAVAILABLE (bb missing, script error, torn stdout) - never
    // a silent substitute while the live report could have been read.
    return invertTicketStageToRoleHeldTickets(readTicketStageMap(targetPath));
  }
}

export interface LivePipelineBoard {
  data: PipelineBoardData;
  // BL-831: active+paused ticket records keyed by id, for consumers (the
  // Bubble Pipeline page) that need ticket prose (description, etc.)
  // alongside the board's own placement data - never a second read of the
  // backlog tree.
  byId: Record<string, BacklogItem>;
}

/**
 * BL-831 invariant 1: the ONE place ticketMeta/paused/roleHeld are built and
 * handed to computePipelineBoard for the live bridge - capturePipelineGridLive
 * (Mini App board) and the Bubble Pipeline page both call this rather than
 * each deriving their own stage placement.
 */
export function computeLivePipelineBoard(targetPath: string): LivePipelineBoard {
  const folders = readBacklogFolders(targetPath);
  const ticketMeta: Record<string, PipelineBoardTicketMeta> = {};
  const byId: Record<string, BacklogItem> = {};
  for (const item of folders.active) {
    byId[item.id] = item;
    ticketMeta[item.id] = {
      epic: item.epic,
      type: item.type,
      title: item.title,
      filename: item.filename,
      location: 'active',
    };
  }
  for (const item of folders.paused) {
    byId[item.id] = item;
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
  // BL-1188 invariant: recomputed from live swarm state on every call - no
  // memoization/caching of a prior tick's roleHeld or rendered result here.
  const roleHeld = resolveRoleHeld(targetPath);
  const data = computePipelineBoard(roleHeld, paused, ticketMeta, {
    activeIds: folders.active.map((item) => item.id),
  });
  return { data, byId };
}

export function capturePipelineGridLive(targetPath: string, nowMs: number = Date.now()): PipelineGridLiveSnapshot {
  const { data } = computeLivePipelineBoard(targetPath);
  return {
    boardText: renderPipelineBoardGridOnly(data, nowMs),
    rowCount: data.rows.length,
  };
}

// BL-831 pipeline-page-blurb-source-03: bounded so the Pipeline page's main
// view stays scannable (same spirit as the grid caption's own title
// truncation, BL-956) - the first sentence of the ticket's description:,
// falling back to its title when it has none.
const BUBBLE_PIPELINE_BLURB_MAX_CHARS = 160;

// required_wiring anchor: blurb
export function blurb(item: BacklogItem): string {
  if (!item.description) {
    return item.title;
  }
  const match = item.description.match(/^[^.!?\n]*[.!?]/);
  const candidate = (match ? match[0] : item.description.split('\n')[0]).trim();
  return candidate.length > BUBBLE_PIPELINE_BLURB_MAX_CHARS
    ? `${candidate.slice(0, BUBBLE_PIPELINE_BLURB_MAX_CHARS - 1)}…`
    : candidate;
}
