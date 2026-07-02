"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordHumanInput = recordHumanInput;
exports.lastHumanInputMs = lastHumanInputMs;
exports.resetHumanInputTracker = resetHumanInputTracker;
// BL-076: tracks when a human last typed into a role's pane, independent of
// whether the pane's rendered output has visibly changed yet (a live
// conversation in progress must never be cleared out from under the human,
// even before the agent has responded). Module-level singleton, mirroring
// watchdog/paneActivity.ts's pattern.
const lastInputByRole = new Map();
function recordHumanInput(role, nowMs = Date.now()) {
    lastInputByRole.set(role, nowMs);
}
function lastHumanInputMs(role) {
    return lastInputByRole.get(role) ?? null;
}
function resetHumanInputTracker() {
    lastInputByRole.clear();
}
//# sourceMappingURL=humanInputTracker.js.map