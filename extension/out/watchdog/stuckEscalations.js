"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setStuckEscalation = setStuckEscalation;
exports.escalatedStuckRoles = escalatedStuckRoles;
exports.clearStuckEscalations = clearStuckEscalations;
/**
 * Roles escalated by the stuck-in-process chaser (BL-067): chases exhausted
 * with no recovery. The chaser writes this registry; SwarmPanel reads it each
 * poll and surfaces the needs-human red border on the role's tile. Kept as a
 * host-side singleton so detection works with or without the panel open.
 */
const escalatedRoles = new Set();
function setStuckEscalation(role, escalated) {
    if (escalated) {
        escalatedRoles.add(role);
    }
    else {
        escalatedRoles.delete(role);
    }
}
function escalatedStuckRoles() {
    return [...escalatedRoles];
}
function clearStuckEscalations() {
    escalatedRoles.clear();
}
//# sourceMappingURL=stuckEscalations.js.map