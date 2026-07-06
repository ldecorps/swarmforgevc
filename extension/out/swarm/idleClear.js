"use strict";
// BL-076: sends "/clear" to a role's pane once it has been drained-idle
// (no work held or queued, no pending question, no recent human keystroke,
// no output change) through a settle window, so the next parcel starts with
// a fresh context window. Context exhaustion is a recurring real failure
// (implicated in the BL-067 overnight stall); the pipeline protocol is
// already context-free between parcels (every handoff says re-read role +
// constitution), so clearing at the right moment costs nothing.
//
// BL-141: drained-idle alone is no longer sufficient — clearing also
// requires the context window to be at least fullnessThresholdPercent full,
// so a role that goes idle early with a mostly-empty window is not cleared
// needlessly. See contextFullness.ts for how the percent itself is derived
// (exact telemetry when a backend reports it, a deterministic proxy metric
// otherwise).
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdleClearTracker = void 0;
exports.decideIdleClear = decideIdleClear;
exports.startIdleClearMonitor = startIdleClearMonitor;
exports.stopIdleClearMonitor = stopIdleClearMonitor;
function hasPendingWork(status) {
    return status.hasInProcessWork || status.hasQueuedNew;
}
// BL-141: below the fullness threshold, skip regardless of how long the role
// has been drained-idle — that safety gate alone was too aggressive.
function isBelowFullnessThreshold(status, config) {
    return status.contextFullness.percent < config.fullnessThresholdPercent;
}
// The gates that never depend on elapsed time: any one of these blocks a
// clear regardless of how long the role has sat idle (hardener split, kept
// under CRAP 6 — see decideIdleClear below for the settle-window half).
function isBlockedByStaticGates(status, alreadyCleared, config) {
    return (!config.enabled ||
        alreadyCleared ||
        hasPendingWork(status) ||
        status.needsHumanPending ||
        status.drainInProgress ||
        isBelowFullnessThreshold(status, config));
}
function isWithinSettleWindow(status, nowMs, config) {
    if (status.lastHumanInputMs !== null) {
        const sinceInputSeconds = (nowMs - status.lastHumanInputMs) / 1000;
        if (sinceInputSeconds < config.settleWindowSeconds) {
            return true;
        }
    }
    const quietSeconds = (nowMs - status.lastActivityMs) / 1000;
    return quietSeconds < config.settleWindowSeconds;
}
// Pure: every safety gate from the ticket's scenario table, split across the
// two helpers above so each stays independently testable and low-complexity.
function decideIdleClear(status, alreadyCleared, nowMs, config) {
    if (isBlockedByStaticGates(status, alreadyCleared, config)) {
        return 'skip';
    }
    if (isWithinSettleWindow(status, nowMs, config)) {
        return 'skip';
    }
    return 'clear';
}
// Tracks the "already cleared while idle" state per role so a drained-idle
// agent is cleared exactly once, and re-arms the moment it holds work again
// (in_process or a freshly queued item) so the NEXT idle period clears again.
class IdleClearTracker {
    cleared = new Set();
    evaluate(status, nowMs, config) {
        if (status.hasInProcessWork || status.hasQueuedNew) {
            this.cleared.delete(status.role);
            return 'skip';
        }
        const alreadyCleared = this.cleared.has(status.role);
        const decision = decideIdleClear(status, alreadyCleared, nowMs, config);
        if (decision === 'clear') {
            this.cleared.add(status.role);
        }
        return decision;
    }
    reset() {
        this.cleared.clear();
    }
}
exports.IdleClearTracker = IdleClearTracker;
function startIdleClearMonitor(config, adapters) {
    const tracker = new IdleClearTracker();
    const intervalId = setInterval(() => {
        const nowMs = Date.now();
        for (const status of adapters.getRoleStatuses()) {
            const decision = tracker.evaluate(status, nowMs, config);
            if (decision === 'clear') {
                adapters.sendClear(status.role);
                // BL-141 context-clear-75-03: explicitly label when the decision
                // was made on the proxy metric, never leaving that implicit.
                const fullnessNote = `${status.contextFullness.percent}% full` +
                    (status.contextFullness.source === 'proxy' ? ' (proxy mode)' : '');
                adapters.log(`Cleared idle context for ${status.role} (${fullnessNote}).`);
            }
        }
    }, config.pollIntervalSeconds * 1000);
    return intervalId;
}
function stopIdleClearMonitor(intervalId) {
    if (intervalId) {
        clearInterval(intervalId);
    }
}
//# sourceMappingURL=idleClear.js.map