"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.truncateSummary = truncateSummary;
exports.buildBadgeMap = buildBadgeMap;
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
function buildBadgeMap(items) {
    const badges = {};
    for (const item of items) {
        if (item.status === 'active' && item.assignedTo) {
            badges[item.assignedTo] = {
                id: item.id,
                summary: truncateSummary(item.title),
            };
        }
    }
    return badges;
}
//# sourceMappingURL=badgeSummary.js.map