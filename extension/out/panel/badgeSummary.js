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
function buildBadgeMap(items, targetPath) {
    // A tile's role can hold more than one active parcel at once (e.g. a
    // hardender batch); grouping first — rather than writing straight into
    // the result map — avoids each item silently overwriting the previous
    // one for the same holder (BL-068 regression: only the last item
    // processed ever survived, and the rest just vanished from the tile).
    const byHolder = new Map();
    for (const item of items) {
        if (item.status === 'active' && item.assignedTo) {
            let liveHolder = null;
            if (targetPath) {
                liveHolder = (0, swarmState_1.findLiveHolder)(targetPath, item.id);
            }
            const resolvedHolder = liveHolder || item.assignedTo;
            const bucket = byHolder.get(resolvedHolder) ?? [];
            bucket.push({ item, holder: resolvedHolder });
            byHolder.set(resolvedHolder, bucket);
        }
    }
    const badges = {};
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
//# sourceMappingURL=badgeSummary.js.map