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
function buildBadgeMap(items, targetPath) {
    const badges = {};
    for (const item of items) {
        if (item.status === 'active' && item.assignedTo) {
            // For active items, find the live holder (current role holding the parcel)
            // For todo items, use the intended assignee
            let holder = item.assignedTo;
            let liveHolder = null;
            if (targetPath && item.status === 'active') {
                liveHolder = (0, swarmState_1.findLiveHolder)(targetPath, item.id);
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
//# sourceMappingURL=badgeSummary.js.map