/**
 * BL-147: the escalation of last resort for a genuinely-wedged pane.
 * `ChaserMonitor.triggerRespawn` is only called once handoffd's own
 * clear-input + retry-and-confirm has already been exhausted (BL-137).
 * From here, every automatic respawn must still go through
 * `respawnAgent`'s existing busy-vs-wedged precheck
 * (`performVerifiedRespawn`/`isPaneActivelyProcessing`) - a pane showing
 * Claude Code's "esc to interrupt" busy footer is never touched, closing
 * the mid-turn-injection incident that motivated 5ef8dd9's blanket
 * disable. Bounded by the same `ChaserMonitorConfig` limits
 * (maxRecoveryAttempts, respawnCooldownSeconds) already used elsewhere; on
 * exhaustion the role falls back to the existing needs-human escalation
 * (`setStuckEscalation`), never silently abandoned.
 */

export interface WedgedRespawnConfig {
  maxRecoveryAttempts: number;
  respawnCooldownSeconds: number;
}

export interface RespawnOutcome {
  success: boolean;
  message: string;
  skippedBusy?: boolean;
}

export interface WedgedRespawnAdapters {
  respawnAgent: (role: string) => RespawnOutcome;
  setStuckEscalation: (role: string, escalated: boolean) => void;
}

export type WedgedRespawnAction = 'respawned' | 'skipped-busy' | 'skipped-cooldown' | 'escalated';

interface RespawnState {
  attempts: number;
  lastRespawnAtMs: number | null;
}

const state = new Map<string, RespawnState>();

function getState(role: string): RespawnState {
  return state.get(role) ?? { attempts: 0, lastRespawnAtMs: null };
}

export function resetWedgedRespawnState(role?: string): void {
  if (role) {
    state.delete(role);
  } else {
    state.clear();
  }
}

// Pure so the bound/cooldown gating is testable without a real clock or a
// real respawn.
export function decideWedgedRespawnAction(
  attempts: number,
  lastRespawnAtMs: number | null,
  nowMs: number,
  config: WedgedRespawnConfig
): 'respawn' | 'skip-cooldown' | 'escalate' {
  if (attempts >= config.maxRecoveryAttempts) {
    return 'escalate';
  }
  if (lastRespawnAtMs !== null && nowMs - lastRespawnAtMs < config.respawnCooldownSeconds * 1000) {
    return 'skip-cooldown';
  }
  return 'respawn';
}

export function handleWedgedRespawnTrigger(
  role: string,
  nowMs: number,
  config: WedgedRespawnConfig,
  adapters: WedgedRespawnAdapters
): WedgedRespawnAction {
  const current = getState(role);
  const decision = decideWedgedRespawnAction(current.attempts, current.lastRespawnAtMs, nowMs, config);

  if (decision === 'escalate') {
    adapters.setStuckEscalation(role, true);
    return 'escalated';
  }
  if (decision === 'skip-cooldown') {
    return 'skipped-cooldown';
  }

  const result = adapters.respawnAgent(role);
  if (result.skippedBusy) {
    // The pane was never touched - it was not actually stuck, so this must
    // not consume the bound or move the role any closer to escalation.
    return 'skipped-busy';
  }

  state.set(role, { attempts: current.attempts + 1, lastRespawnAtMs: nowMs });
  return 'respawned';
}
