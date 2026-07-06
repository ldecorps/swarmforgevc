"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.truncateSummary = truncateSummary;
exports.buildBadgeMap = buildBadgeMap;
const swarmState_1 = require("../swarm/swarmState");
const SUMMARY_MAX_LENGTH = 40;
function truncateSummary(title) {
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
function compareTicketIds(a, b) {
    return a.localeCompare(b, undefined, { numeric: true });
}
function resolveItemHolder(item, targetPath) {
    if (!item.assignedTo) {
        return null;
    }
    // When live routing is requested (targetPath given), findLiveHolder is
    // the sole source of truth — the same resolver the backlog row's
    // holderMap uses. Falling back to the static assignedTo YAML field
    // when it resolves to null resurfaced a phantom tile badge for a
    // ticket whose parcel already left every stage inbox (dropped after
    // completion, or never routed at all), disagreeing with the backlog
    // row's "queued" state for the same ticket (BL-079). Only skip live
    // resolution entirely — and fall back to assignedTo — when no
    // targetPath is given at all.
    if (!targetPath) {
        return item.assignedTo;
    }
    const liveHolder = (0, swarmState_1.findLiveHolder)(targetPath, item.id);
    return liveHolder || null;
}
function groupItemsByHolder(items, targetPath) {
    const byHolder = new Map();
    for (const item of items) {
        if (item.status !== 'active') {
            continue;
        }
        const holder = resolveItemHolder(item, targetPath);
        if (!holder) {
            continue;
        }
        const bucket = byHolder.get(holder) ?? [];
        bucket.push({ item, holder });
        byHolder.set(holder, bucket);
    }
    return byHolder;
}
function formatBadgeEntry(entries) {
    entries.sort((a, b) => compareTicketIds(a.item.id, b.item.id));
    const [primary, ...rest] = entries;
    return {
        id: primary.item.id,
        summary: truncateSummary(primary.item.title),
        holder: primary.holder,
        heldTicketIds: entries.map((e) => e.item.id),
        ...(rest.length > 0 ? { extraCount: rest.length } : {}),
    };
}
function buildBadgeMap(items, targetPath) {
    // A tile's role can hold more than one active parcel at once (e.g. a
    // hardender batch); grouping first — rather than writing straight into
    // the result map — avoids each item silently overwriting the previous
    // one for the same holder (BL-068 regression: only the last item
    // processed ever survived, and the rest just vanished from the tile).
    const byHolder = groupItemsByHolder(items, targetPath);
    const badges = {};
    for (const [tileRole, entries] of byHolder) {
        badges[tileRole] = formatBadgeEntry(entries);
    }
    return badges;
}
//# sourceMappingURL=badgeSummary.js.map