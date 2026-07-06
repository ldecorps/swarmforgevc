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

import type { ContextFullness } from './contextFullness';

export interface IdleClearConfig {
  enabled: boolean;
  settleWindowSeconds: number;
  // BL-141: minimum context-window fullness (0-100) required before an
  // otherwise-eligible drained-idle role is actually cleared.
  fullnessThresholdPercent: number;
}

export interface RoleIdleStatus {
  role: string;
  hasInProcessWork: boolean;
  hasQueuedNew: boolean;
  needsHumanPending: boolean;
  drainInProgress: boolean;
  // ms since epoch of the most recent human keystroke sent to this pane, or
  // null if none observed this session.
  lastHumanInputMs: number | null;
  // ms since epoch of the most recent pane/outbox activity (BL-067's
  // paneActivity tracking) — the pane has been "output-quiet" since this.
  lastActivityMs: number;
  // BL-141: how full the role's context window currently is, and which
  // tier (telemetry vs proxy) produced that reading.
  contextFullness: ContextFullness;
}

export type IdleClearDecision = 'clear' | 'skip';

// Pure: every safety gate from the ticket's scenario table in one place, so
// each unsafe state is independently testable.
export function decideIdleClear(
  status: RoleIdleStatus,
  alreadyCleared: boolean,
  nowMs: number,
  config: IdleClearConfig
): IdleClearDecision {
  if (!config.enabled) {
    return 'skip';
  }
  if (alreadyCleared) {
    return 'skip';
  }
  if (status.hasInProcessWork || status.hasQueuedNew) {
    return 'skip';
  }
  if (status.needsHumanPending) {
    return 'skip';
  }
  if (status.drainInProgress) {
    return 'skip';
  }
  // BL-141: below the fullness threshold, skip regardless of how long the
  // role has been drained-idle — that safety gate alone was too aggressive.
  if (status.contextFullness.percent < config.fullnessThresholdPercent) {
    return 'skip';
  }
  if (status.lastHumanInputMs !== null) {
    const sinceInputSeconds = (nowMs - status.lastHumanInputMs) / 1000;
    if (sinceInputSeconds < config.settleWindowSeconds) {
      return 'skip';
    }
  }
  const quietSeconds = (nowMs - status.lastActivityMs) / 1000;
  if (quietSeconds < config.settleWindowSeconds) {
    return 'skip';
  }
  return 'clear';
}

// Tracks the "already cleared while idle" state per role so a drained-idle
// agent is cleared exactly once, and re-arms the moment it holds work again
// (in_process or a freshly queued item) so the NEXT idle period clears again.
export class IdleClearTracker {
  private cleared = new Set<string>();

  evaluate(status: RoleIdleStatus, nowMs: number, config: IdleClearConfig): IdleClearDecision {
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

  reset(): void {
    this.cleared.clear();
  }
}

export interface IdleClearAdapters {
  getRoleStatuses: () => RoleIdleStatus[];
  sendClear: (role: string) => void;
  log: (message: string) => void;
}

export interface IdleClearMonitorConfig extends IdleClearConfig {
  pollIntervalSeconds: number;
}

export function startIdleClearMonitor(
  config: IdleClearMonitorConfig,
  adapters: IdleClearAdapters
): NodeJS.Timeout {
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

export function stopIdleClearMonitor(intervalId: NodeJS.Timeout | null): void {
  if (intervalId) {
    clearInterval(intervalId);
  }
}
