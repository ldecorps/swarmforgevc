// BL-239: read-only "is this role currently gated" snapshot for the
// Telegram narrator - a NEW state builder kept out of buildBridgeState (the
// ~1s SSE poll loop bridgeState.ts's own comments document as deliberately
// cheap: roles.tsv/backlog/heartbeat/runlog only, never tmux/git). This
// follows buildDeliveryMetricsState/buildHolisticState/buildStageDwellState's
// established posture instead: a separate builder, computed only by whatever
// caller actually needs it, on its own cadence.
//
// The live capture chain mirrors gateAnswerLive.ts's resolveLiveTarget +
// capturePane call chain, deliberately duplicated rather than imported: this
// is a read-only narration concern, gateAnswerLive.ts is the security-
// sensitive gate-answer WRITE path, and the two have no shared lifecycle
// worth coupling.
import { readTmuxSocket, readSwarmRoles, resolveAgentPaneTarget, getPaneBaseIndex, capturePane } from '../swarm/tmuxClient';
import { detectNeedsHuman, extractQuestionSnippet } from '../panel/needsHumanDetection';

export interface RoleGateState {
  role: string;
  gated: boolean;
  snippet?: string;
}

export function computeRoleGateStates(
  roles: string[],
  capturePaneText: (role: string) => string | undefined
): RoleGateState[] {
  return roles.map((role) => {
    const text = capturePaneText(role);
    const gated = detectNeedsHuman(text);
    const state: RoleGateState = { role, gated };
    if (gated) {
      const snippet = extractQuestionSnippet(text);
      if (snippet) {
        state.snippet = snippet;
      }
    }
    return state;
  });
}

function resolveLiveTarget(targetPath: string, socketPath: string, role: string): string | undefined {
  const roleEntry = readSwarmRoles(targetPath).find((entry) => entry.role === role);
  if (!roleEntry) {
    return undefined;
  }
  return resolveAgentPaneTarget(socketPath, roleEntry.session, getPaneBaseIndex(socketPath));
}

export function computeRoleGateStatesLive(targetPath: string, roles: string[]): RoleGateState[] {
  const socketPath = readTmuxSocket(targetPath);
  if (!socketPath) {
    return roles.map((role) => ({ role, gated: false }));
  }
  return computeRoleGateStates(roles, (role) => {
    const target = resolveLiveTarget(targetPath, socketPath, role);
    if (!target) {
      return undefined;
    }
    const captured = capturePane(socketPath, target);
    return captured.exitCode === 0 ? captured.stdout : undefined;
  });
}
