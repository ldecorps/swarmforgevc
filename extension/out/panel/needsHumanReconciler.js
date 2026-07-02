"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NeedsHumanReconciler = void 0;
/**
 * Combines the two independent needs-human signal sources for a role — the
 * pane question detector (BL-045/054) and the stuck-in-process chaser
 * escalation (BL-067) — into one tile state. Without this, each source
 * broadcasts only its own state changes, so one source's "false" can clear
 * the tile while the other source still considers the role needs-human,
 * silently dropping the visible escalation. The combined state is true
 * whenever EITHER source is true, and only clears once BOTH are false.
 */
class NeedsHumanReconciler {
    questionRoles = new Set();
    stuckRoles = new Set();
    combinedRoles = new Set();
    applyQuestionEvents(events) {
        for (const event of events) {
            if (event.needsHuman) {
                this.questionRoles.add(event.role);
            }
            else {
                this.questionRoles.delete(event.role);
            }
        }
        return this.recompute();
    }
    applyStuckRoles(stuckRoles) {
        this.stuckRoles.clear();
        for (const role of stuckRoles) {
            this.stuckRoles.add(role);
        }
        return this.recompute();
    }
    recompute() {
        const combined = new Set([...this.questionRoles, ...this.stuckRoles]);
        const deltas = [];
        for (const role of combined) {
            if (!this.combinedRoles.has(role)) {
                deltas.push({ role, needsHuman: true });
            }
        }
        for (const role of this.combinedRoles) {
            if (!combined.has(role)) {
                deltas.push({ role, needsHuman: false });
            }
        }
        this.combinedRoles = combined;
        return deltas;
    }
}
exports.NeedsHumanReconciler = NeedsHumanReconciler;
//# sourceMappingURL=needsHumanReconciler.js.map