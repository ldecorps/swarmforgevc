// BL-703: swarm liveness helpers for Cursor-as-expeditor gates.
// Pure verdicts + thin I/O wrapping readLiveSwarmRoles (tmux ∩ sessions.tsv).

import { readLiveSwarmRoles, type SwarmRole } from '../swarm/tmuxClient';
import { PIPELINE_CHAIN } from '../swarm/rolePack';

export interface LivenessSnapshot {
  roles: Array<{ role: string; session: string }>;
}

export function buildLivenessSnapshot(roles: SwarmRole[]): LivenessSnapshot {
  return {
    roles: roles.map((r) => ({ role: r.role, session: r.session })),
  };
}

export function isSwarmLive(snapshot: LivenessSnapshot): boolean {
  return snapshot.roles.length > 0;
}

/** Full-pack role up = any pipeline role other than specifier is live. */
export function fullPackPipelineRolesUp(snapshot: LivenessSnapshot): string[] {
  const pipeline = new Set(PIPELINE_CHAIN.map((r) => r.toLowerCase()));
  return snapshot.roles
    .map((r) => r.role)
    .filter((role) => {
      const lower = role.toLowerCase();
      if (lower === 'specifier' || lower === 'coordinator') {
        return false;
      }
      return pipeline.has(lower) || pipeline.has(role);
    });
}

export function formatSwarmLiveRefuse(snapshot: LivenessSnapshot, verb: string): string {
  const names = snapshot.roles.map((r) => r.role).join(', ') || '(unknown)';
  return [
    `Cannot ${verb}: swarm is live (${names}).`,
    'Clear with /drain-swarm or /stop, or confirm Stop & run to drain-stop then continue.',
  ].join('\n');
}

export function formatFullPackRefuse(upRoles: string[], verb: string): string {
  return [
    `Cannot ${verb}: full-pack pipeline role(s) up (${upRoles.join(', ')}).`,
    'Stop the swarm first; /hydrate and /mint start specifier only from a stopped state.',
  ].join('\n');
}

export function stopAndRunButtons(verb: string, args?: string): Array<Array<{ text: string; callbackData: string }>> {
  const payload = args ? `${verb} ${args}` : verb;
  return [
    [
      { text: 'Stop & run', callbackData: `op:stop-and-run:${payload}` },
      { text: 'Cancel', callbackData: 'op:cancel' },
    ],
  ];
}

/** Probe live tmux roles for the target repo (I/O). */
export function probeSwarmLiveness(repoRoot: string): LivenessSnapshot {
  return buildLivenessSnapshot(readLiveSwarmRoles(repoRoot));
}

export type AwaitSwarmDrainDeps = {
  probe?: (repoRoot: string) => LivenessSnapshot;
  sleep?: (ms: number) => Promise<void>;
  nowMs?: () => number;
};

/**
 * Poll until the swarm is down (or timeout). Used by Stop & run after a
 * drain-stop so the follow-on pilot/autopilot does not race live tmux.
 */
export async function awaitSwarmDrain(
  repoRoot: string,
  opts: { timeoutMs?: number; pollMs?: number } & AwaitSwarmDrainDeps = {}
): Promise<{ cleared: boolean; snapshot: LivenessSnapshot }> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const pollMs = opts.pollMs ?? 1_000;
  const probe = opts.probe ?? probeSwarmLiveness;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const nowMs = opts.nowMs ?? Date.now;
  const deadline = nowMs() + timeoutMs;
  let snapshot = probe(repoRoot);
  while (isSwarmLive(snapshot)) {
    if (nowMs() >= deadline) {
      return { cleared: false, snapshot };
    }
    await sleep(pollMs);
    snapshot = probe(repoRoot);
  }
  return { cleared: true, snapshot };
}
