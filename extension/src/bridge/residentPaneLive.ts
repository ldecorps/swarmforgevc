// BL-522: live mono-router panes for the bridge Mini App / JSON feed.

import {
  readTmuxSocket,
  readSwarmRoles,
  getPaneBaseIndex,
  resolveAgentPaneTarget,
  capturePane,
  SwarmRole,
} from '../swarm/tmuxClient';
import { stripAnsi } from '../panel/ansi';
import {
  RESIDENT_PANE_SPY_DEFAULT_LINES,
  RESIDENT_PANE_SPY_ROLE_SEARCH_LINES,
  readMonoRouterActiveRole,
  resolveResidentRoleIdentity,
  resolveResidentHeldTicketMetaForRoles,
  formatResidentSpyHeader,
  formatClaimEnteredAgo,
} from '../concierge/residentPaneSpy';
import { readRoleModelId } from '../swarm/backendSwitch';
import { formatModelDisplayName } from '../swarm/modelDisplayName';

export interface PaneLiveSnapshot {
  available: boolean;
  roleLabel?: string;
  paneText?: string;
  sessionTarget?: string;
  modelLabel?: string;
  ticketId?: string;
  ticketTitle?: string;
  claimEnteredAtMs?: number;
  claimEnteredAgo?: string;
  header?: string;
}

/** @deprecated Use PaneLiveSnapshot — kept for existing imports. */
export type ResidentPaneLiveSnapshot = PaneLiveSnapshot;

export interface MonoRouterLiveScreenSnapshot {
  available: boolean;
  resident: PaneLiveSnapshot;
  coordinator: PaneLiveSnapshot;
}

function unavailablePane(): PaneLiveSnapshot {
  return { available: false };
}

function withHeader(
  snap: PaneLiveSnapshot,
  prefix: 'Resident' | 'Coordinator',
  options: { includeClaimEnteredAgo?: boolean } = {}
): PaneLiveSnapshot {
  if (!snap.available || !snap.roleLabel) {
    return snap;
  }
  const claimEnteredAgo =
    options.includeClaimEnteredAgo && snap.claimEnteredAtMs !== undefined
      ? formatClaimEnteredAgo(snap.claimEnteredAtMs)
      : undefined;
  return {
    ...snap,
    claimEnteredAgo,
    header: formatResidentSpyHeader(
      {
        roleLabel: snap.roleLabel,
        modelLabel: snap.modelLabel,
        ticketId: snap.ticketId,
        ticketTitle: snap.ticketTitle,
      },
      prefix,
      { includeSession: false }
    ),
  };
}

function tryCaptureRolePane(
  targetPath: string,
  socketPath: string,
  roleEntry: SwarmRole,
  roles: SwarmRole[],
  paneBaseIndex: number,
  monoRouterActiveRole?: string
): PaneLiveSnapshot | undefined {
  const target = resolveAgentPaneTarget(socketPath, roleEntry.session, paneBaseIndex);
  const captured = capturePane(socketPath, target, -RESIDENT_PANE_SPY_DEFAULT_LINES);
  if (captured.exitCode !== 0) {
    return undefined;
  }
  const paneText = stripAnsi(captured.stdout ?? '');
  if (!paneText.trim()) {
    return undefined;
  }
  const roleSearchCaptured = capturePane(socketPath, target, -RESIDENT_PANE_SPY_ROLE_SEARCH_LINES);
  const roleSearchText = stripAnsi(roleSearchCaptured.stdout ?? paneText);
  const identity = resolveResidentRoleIdentity(roleSearchText, roleEntry, roles, monoRouterActiveRole);
  const modelId = readRoleModelId(targetPath, identity.modelRole);
  const heldTicket = resolveResidentHeldTicketMetaForRoles(targetPath, [
    monoRouterActiveRole,
    identity.modelRole,
    roleEntry.role,
  ].filter((role, index, rolesToTry): role is string => !!role && rolesToTry.indexOf(role) === index));
  return {
    available: true,
    roleLabel: identity.roleLabel,
    paneText,
    sessionTarget: target,
    modelLabel: modelId ? formatModelDisplayName(modelId) : undefined,
    ...heldTicket,
  };
}

export function captureResidentPaneLive(targetPath: string): PaneLiveSnapshot | undefined {
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
  const activeRole = readMonoRouterActiveRole(targetPath);
  for (const role of ordered) {
    const roleEntry = roles.find((r) => r.role === role);
    if (!roleEntry) {
      continue;
    }
    const snap = tryCaptureRolePane(targetPath, socketPath, roleEntry, roles, paneBaseIndex, activeRole);
    if (snap) {
      return snap;
    }
  }
  return undefined;
}

export function captureCoordinatorPaneLive(targetPath: string): PaneLiveSnapshot | undefined {
  const socketPath = readTmuxSocket(targetPath);
  if (!socketPath) {
    return undefined;
  }
  const roles = readSwarmRoles(targetPath);
  const roleEntry = roles.find((r) => r.role === 'coordinator');
  if (!roleEntry) {
    return undefined;
  }
  return tryCaptureRolePane(targetPath, socketPath, roleEntry, roles, getPaneBaseIndex(socketPath));
}

export function captureMonoRouterLiveScreen(targetPath: string): MonoRouterLiveScreenSnapshot {
  const residentRaw = captureResidentPaneLive(targetPath);
  const coordinatorRaw = captureCoordinatorPaneLive(targetPath);
  const resident = withHeader(residentRaw ? { ...residentRaw, available: true } : unavailablePane(), 'Resident', {
    includeClaimEnteredAgo: true,
  });
  const coordinator = withHeader(
    coordinatorRaw ? { ...coordinatorRaw, available: true } : unavailablePane(),
    'Coordinator'
  );
  return {
    available: resident.available,
    resident,
    coordinator,
  };
}
