// BL-522: live resident-pane capture for the bridge Mini App / JSON feed.

import {
  readTmuxSocket,
  readSwarmRoles,
  getPaneBaseIndex,
  resolveAgentPaneTarget,
  capturePane,
} from '../swarm/tmuxClient';
import { stripAnsi } from '../panel/ansi';
import {
  RESIDENT_PANE_SPY_DEFAULT_LINES,
  RESIDENT_PANE_SPY_ROLE_SEARCH_LINES,
  resolveResidentRoleIdentity,
} from '../concierge/residentPaneSpy';
import { readRoleModelId } from '../swarm/backendSwitch';
import { formatModelDisplayName } from '../swarm/modelDisplayName';

export interface ResidentPaneLiveSnapshot {
  roleLabel: string;
  paneText: string;
  sessionTarget: string;
  modelLabel?: string;
}

export function captureResidentPaneLive(targetPath: string): ResidentPaneLiveSnapshot | undefined {
  const socketPath = readTmuxSocket(targetPath);
  if (!socketPath) {
    return undefined;
  }
  const roles = readSwarmRoles(targetPath);
  const ordered = [
    'coder',
    ...roles.map((r) => r.role).filter((role) => role !== 'coder' && role !== 'coordinator'),
  ];
  const paneBaseIndex = getPaneBaseIndex(socketPath);
  for (const role of ordered) {
    const roleEntry = roles.find((r) => r.role === role);
    if (!roleEntry) {
      continue;
    }
    const target = resolveAgentPaneTarget(socketPath, roleEntry.session, paneBaseIndex);
    const captured = capturePane(socketPath, target, -RESIDENT_PANE_SPY_DEFAULT_LINES);
    if (captured.exitCode !== 0) {
      continue;
    }
    const paneText = stripAnsi(captured.stdout ?? '');
    if (!paneText.trim()) {
      continue;
    }
    const roleSearchCaptured = capturePane(socketPath, target, -RESIDENT_PANE_SPY_ROLE_SEARCH_LINES);
    const roleSearchText = stripAnsi(roleSearchCaptured.stdout ?? paneText);
    const identity = resolveResidentRoleIdentity(roleSearchText, roleEntry, roles);
    const modelId = readRoleModelId(targetPath, identity.modelRole);
    return {
      roleLabel: identity.roleLabel,
      paneText,
      sessionTarget: target,
      modelLabel: modelId ? formatModelDisplayName(modelId) : undefined,
    };
  }
  return undefined;
}
