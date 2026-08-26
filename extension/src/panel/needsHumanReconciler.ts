import { NeedsHumanEvent } from './paneTailer';

/**
 * Combines the two independent needs-human signal sources for a role — the
 * pane question detector (BL-045/054) and the stuck-in-process chaser
 * escalation (BL-067) — into one tile state. Without this, each source
 * broadcasts only its own state changes, so one source's "false" can clear
 * the tile while the other source still considers the role needs-human,
 * silently dropping the visible escalation. The combined state is true
 * whenever EITHER source is true, and only clears once BOTH are false.
 */
export class NeedsHumanReconciler {
  private readonly questionRoles = new Set<string>();
  private readonly stuckRoles = new Set<string>();
  private combinedRoles = new Set<string>();

  applyQuestionEvents(events: NeedsHumanEvent[]): NeedsHumanEvent[] {
    for (const event of events) {
      if (event.needsHuman) {
        this.questionRoles.add(event.role);
      } else {
        this.questionRoles.delete(event.role);
      }
    }
    return this.recompute();
  }

  applyStuckRoles(stuckRoles: Iterable<string>): NeedsHumanEvent[] {
    this.stuckRoles.clear();
    for (const role of stuckRoles) {
      this.stuckRoles.add(role);
    }
    return this.recompute();
  }

  private recompute(): NeedsHumanEvent[] {
    const combined = new Set<string>([...this.questionRoles, ...this.stuckRoles]);
    const deltas: NeedsHumanEvent[] = [];
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
