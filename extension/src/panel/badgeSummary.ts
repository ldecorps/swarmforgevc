import { BacklogItem } from './backlogReader';
import { findLiveHolder } from '../swarm/swarmState';

const SUMMARY_MAX_LENGTH = 40;

export function truncateSummary(title: string): string {
  let summary = title;

  // Strip leading section prefix (e.g., "backlog panel — ") keeping what makes the item distinct
  const sectionMatch = summary.match(/^[^—]*—\s*(.*)$/);
  if (sectionMatch) {
    summary = sectionMatch[1].trim();
  }

  // Truncate to max length with ellipsis if needed
  if (summary.length > SUMMARY_MAX_LENGTH) {
    summary = summary.substring(0, SUMMARY_MAX_LENGTH - 1) + '…';
  }

  return summary;
}

export interface Badge {
  id: string;
  summary: string;
}

export interface BadgeWithHolder extends Badge {
  holder?: string;
}

export function buildBadgeMap(
  items: BacklogItem[],
  targetPath?: string
): Record<string, BadgeWithHolder> {
  const badges: Record<string, BadgeWithHolder> = {};
  for (const item of items) {
    if (item.status === 'active' && item.assignedTo) {
      // For active items, find the live holder (current role holding the parcel)
      // For todo items, use the intended assignee
      let holder = item.assignedTo;
      let liveHolder: string | null = null;
      if (targetPath && item.status === 'active') {
        liveHolder = findLiveHolder(targetPath, item.id);
        if (liveHolder) {
          holder = liveHolder;
        }
      }

      badges[holder] = {
        id: item.id,
        summary: truncateSummary(item.title),
        holder: liveHolder || item.assignedTo,
      };
    }
  }
  return badges;
}
