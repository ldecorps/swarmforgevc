import { SwarmRole, readTmuxSocket, getPaneBaseIndex, resolveAgentPaneTarget, getPanePid } from './tmuxClient';
import { SampledRole } from '../metrics/resourceTelemetry';

// BL-264: resolves one role's live pid via the SAME tmux discovery chain
// PaneTailer already uses (readTmuxSocket -> getPaneBaseIndex ->
// resolveAgentPaneTarget -> getPanePid) - reuse, not a second discovery
// path. Recomputed fresh on every call, never cached, so a respawned
// pane's new pid is picked up on the sampler's NEXT tick rather than a pid
// resolved once at start time going stale.
export function resolvePanePid(targetPath: string, session: string): number | null {
  const socketPath = readTmuxSocket(targetPath);
  if (!socketPath) {
    return null;
  }
  const paneBaseIndex = getPaneBaseIndex(socketPath);
  const target = resolveAgentPaneTarget(socketPath, session, paneBaseIndex);
  const pidText = getPanePid(socketPath, target);
  if (!pidText) {
    return null;
  }
  const pid = Number(pidText);
  return Number.isFinite(pid) ? pid : null;
}

// Pure given resolvePid (defaults to the real, tmux-shelling resolvePanePid
// above): maps each discovered SwarmRole into the SampledRole shape
// startResourceSampler expects. getPid is a LAZY closure - not resolved
// here - so each sampler tick re-resolves the live pid rather than one
// captured at wiring time.
export function buildSampledRoles(
  targetPath: string,
  roles: SwarmRole[],
  resolvePid: (targetPath: string, session: string) => number | null = resolvePanePid
): SampledRole[] {
  return roles.map((swarmRole) => ({
    role: swarmRole.role,
    getPid: () => resolvePid(targetPath, swarmRole.session),
  }));
}
