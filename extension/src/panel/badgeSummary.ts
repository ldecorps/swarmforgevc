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
  // Set when this tile's role holds more than one active parcel (e.g. a
  // hardender batch): the count of parcels NOT shown as the primary badge
  // (BL-068). Omitted (not zero) for a single-parcel holder.
  extraCount?: number;
}

function compareTicketIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

export function buildBadgeMap(
  items: BacklogItem[],
  targetPath?: string
): Record<string, BadgeWithHolder> {
  // A tile's role can hold more than one active parcel at once (e.g. a
  // hardender batch); grouping first — rather than writing straight into
  // the result map — avoids each item silently overwriting the previous
  // one for the same holder (BL-068 regression: only the last item
  // processed ever survived, and the rest just vanished from the tile).
  const byHolder = new Map<string, { item: BacklogItem; holder: string }[]>();

  for (const item of items) {
    if (item.status === 'active' && item.assignedTo) {
      // When live routing is requested (targetPath given), findLiveHolder is
      // the sole source of truth — the same resolver the backlog row's
      // holderMap uses. Falling back to the static assignedTo YAML field
      // when it resolves to null resurfaced a phantom tile badge for a
      // ticket whose parcel already left every stage inbox (dropped after
      // completion, or never routed at all), disagreeing with the backlog
      // row's "queued" state for the same ticket (BL-079). Only skip live
      // resolution entirely — and fall back to assignedTo — when no
      // targetPath is given at all.
      const resolvedHolder = targetPath ? findLiveHolder(targetPath, item.id) : item.assignedTo;
      if (!resolvedHolder) {
        continue;
      }
      const bucket = byHolder.get(resolvedHolder) ?? [];
      bucket.push({ item, holder: resolvedHolder });
      byHolder.set(resolvedHolder, bucket);
    }
  }

  const badges: Record<string, BadgeWithHolder> = {};
  for (const [tileRole, entries] of byHolder) {
    entries.sort((a, b) => compareTicketIds(a.item.id, b.item.id));
    const [primary, ...rest] = entries;
    badges[tileRole] = {
      id: primary.item.id,
      summary: truncateSummary(primary.item.title),
      holder: primary.holder,
      ...(rest.length > 0 ? { extraCount: rest.length } : {}),
    };
  }
  return badges;
}
