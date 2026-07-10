#!/usr/bin/env node
/**
 * BL-256: the "what merged / what's blocked" section of the daily
 * briefing. Reuses gitHistoryAdapter.ts (deriveTicketLifecycles/runGitLog)
 * for the merged digest and ticketHoldingWindows.ts
 * (readRoleHoldingWindows) for the blocked/stalled digest - this CLI
 * composes/formats those existing sources via briefingDigest.ts's pure
 * functions, never re-derives lifecycle or holding-window logic itself.
 * "Since the last briefing" is the second-most-recent docs/briefings/*.md
 * filename (today's own file, about to be sent, is the most recent) -
 * falling back to a 24h window when fewer than two briefings exist yet.
 *
 * Usage: node briefing-digest-line.js
 */
import * as fs from 'fs';
import * as path from 'path';
import { computeMergedSince, computeBlockedTickets, MergedTicketEntry, BlockedTicketEntry } from '../metrics/briefingDigest';
import { deriveTicketLifecycles, runGitLog } from '../metrics/gitHistoryAdapter';
import { readRoleHoldingWindows, TicketHoldingWindow } from '../metrics/ticketHoldingWindows';
import { formatDurationMs } from '../metrics/swarmMetrics';
import { readPwaBaseUrl, buildTicketDeepLink } from '../metrics/pwaDeepLinks';
import { resolveProjectRoot, loadRoles, runCliMain } from './swarm-metrics';

const FALLBACK_SINCE_WINDOW_MS = 24 * 60 * 60 * 1000;

// The second-most-recent committed briefing's own date names the cutoff -
// the most recent one is today's own file (about to be sent by this same
// sweep), not a prior briefing to diff against.
export function sinceLastBriefingMs(briefingsDir: string, nowMs: number): number {
  let files: string[];
  try {
    files = fs
      .readdirSync(briefingsDir)
      .filter((f) => f.endsWith('.md'))
      .sort();
  } catch {
    return nowMs - FALLBACK_SINCE_WINDOW_MS;
  }
  if (files.length < 2) {
    return nowMs - FALLBACK_SINCE_WINDOW_MS;
  }
  const priorDayKey = files[files.length - 2].replace(/\.md$/, '');
  const ms = Date.parse(`${priorDayKey}T00:00:00Z`);
  return Number.isNaN(ms) ? nowMs - FALLBACK_SINCE_WINDOW_MS : ms;
}

function formatWithLink(ticketId: string, deepLink: (id: string) => string | null): string {
  const link = deepLink(ticketId);
  return link ? `${ticketId} (${link})` : ticketId;
}

export function formatMergedBlockedDigest(
  merged: MergedTicketEntry[],
  blocked: BlockedTicketEntry[],
  deepLink: (ticketId: string) => string | null
): string {
  const mergedLine =
    merged.length === 0
      ? 'Merged since last briefing: none.'
      : 'Merged since last briefing: ' + merged.map((m) => formatWithLink(m.ticketId, deepLink)).join(', ');
  const blockedLine =
    blocked.length === 0
      ? 'Blocked/stalled: none.'
      : 'Blocked/stalled: ' +
        blocked.map((b) => `${formatWithLink(b.ticketId, deepLink)} (${b.role}, open ${formatDurationMs(b.openMs)})`).join(', ');
  return [mergedLine, blockedLine].join('\n');
}

export function main(): void {
  const projectRoot = resolveProjectRoot(process.cwd());
  const roles = loadRoles(projectRoot);
  const nowMs = Date.now();

  const briefingsDir = path.join(projectRoot, 'docs', 'briefings');
  const sinceMs = sinceLastBriefingMs(briefingsDir, nowMs);
  const lifecycles = deriveTicketLifecycles(runGitLog(projectRoot, 'backlog'));
  const merged = computeMergedSince(lifecycles, sinceMs);

  const windowsByRole: Record<string, TicketHoldingWindow[]> = {};
  for (const role of roles) {
    windowsByRole[role.role] = readRoleHoldingWindows(role.worktreePath);
  }
  const blocked = computeBlockedTickets(windowsByRole, nowMs);

  const pwaBaseUrl = readPwaBaseUrl(projectRoot);
  console.log(formatMergedBlockedDigest(merged, blocked, (id) => buildTicketDeepLink(pwaBaseUrl, id)));
}

if (require.main === module) {
  runCliMain(main);
}
