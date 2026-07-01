"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextEligibleItem = nextEligibleItem;
const MAX_PRIORITY = Number.MAX_SAFE_INTEGER;
function nextEligibleItem(items) {
    const doneIds = new Set(items.filter((i) => i.status === 'done').map((i) => i.id));
    const active = items
        .filter((i) => i.status === 'active')
        .sort((a, b) => (a.priority ?? MAX_PRIORITY) - (b.priority ?? MAX_PRIORITY));
    for (const item of active) {
        const blocked = item.dependsOn?.some((dep) => !doneIds.has(dep)) ?? false;
        if (!blocked) {
            return item;
        }
    }
    return null;
}
//# sourceMappingURL=backlogLoop.js.map