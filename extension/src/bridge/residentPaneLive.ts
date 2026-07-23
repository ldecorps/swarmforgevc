// BL-522: live swarm panes for the bridge Mini App / JSON feed.

import {
  readTmuxSocket,
  readSwarmRoles,
  readLiveSwarmRoles,
  getPaneBaseIndex,
  resolveAgentPaneTarget,
  capturePane,
  SwarmRole,
} from '../swarm/tmuxClient';
import { PIPELINE_CHAIN } from '../swarm/rolePack';
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

export interface LiveScreenPaneEntry {
  id: string;
  label: string;
  pane: PaneLiveSnapshot;
}

export interface MonoRouterLiveScreenSnapshot {
  available: boolean;
  resident: PaneLiveSnapshot;
  coordinator: PaneLiveSnapshot;
  panes: LiveScreenPaneEntry[];
}

export const LIVE_SCREEN_ROLE_ORDER: readonly string[] = ['coordinator', ...PIPELINE_CHAIN];

function unavailablePane(): PaneLiveSnapshot {
  return { available: false };
}

function withHeader(
  snap: PaneLiveSnapshot,
  label: string,
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
      label,
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

function isMonoRouterLayout(targetPath: string, liveRoles: SwarmRole[]): boolean {
  if (readMonoRouterActiveRole(targetPath)) {
    return true;
  }
  return liveRoles.length <= 2;
}

export function orderLiveScreenRoles(liveRoles: SwarmRole[]): SwarmRole[] {
  const byRole = new Map(liveRoles.map((entry) => [entry.role, entry]));
  const ordered: SwarmRole[] = [];
  for (const roleId of LIVE_SCREEN_ROLE_ORDER) {
    const entry = byRole.get(roleId);
    if (entry) {
      ordered.push(entry);
    }
  }
  for (const entry of liveRoles) {
    if (!ordered.includes(entry)) {
      ordered.push(entry);
    }
  }
  return ordered;
}

export function liveScreenPaneId(roleEntry: SwarmRole, monoLayout: boolean): string {
  if (monoLayout && roleEntry.role === 'coder') {
    return 'resident';
  }
  return roleEntry.role;
}

export function liveScreenPaneLabel(roleEntry: SwarmRole, monoLayout: boolean): string {
  if (monoLayout && roleEntry.role === 'coder') {
    return 'Resident';
  }
  return roleEntry.displayName || roleEntry.role;
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

export function captureLiveScreenPanes(targetPath: string): LiveScreenPaneEntry[] {
  const socketPath = readTmuxSocket(targetPath);
  if (!socketPath) {
    return [];
  }
  const roles = readSwarmRoles(targetPath);
  const liveRoles = readLiveSwarmRoles(targetPath);
  const monoLayout = isMonoRouterLayout(targetPath, liveRoles);
  const paneBaseIndex = getPaneBaseIndex(socketPath);
  const activeRole = readMonoRouterActiveRole(targetPath);
  return orderLiveScreenRoles(liveRoles).map((roleEntry) => {
    const id = liveScreenPaneId(roleEntry, monoLayout);
    const label = liveScreenPaneLabel(roleEntry, monoLayout);
    const monoActive = monoLayout && roleEntry.role === 'coder' ? activeRole : undefined;
    const raw = tryCaptureRolePane(targetPath, socketPath, roleEntry, roles, paneBaseIndex, monoActive);
    const showClaimEntered = id === 'resident' || roleEntry.role === 'coder';
    const pane = withHeader(raw ? { ...raw, available: true } : unavailablePane(), label, {
      includeClaimEnteredAgo: showClaimEntered,
    });
    return { id, label, pane };
  });
}

export function captureMonoRouterLiveScreen(targetPath: string): MonoRouterLiveScreenSnapshot {
  const panes = captureLiveScreenPanes(targetPath);
  const resident =
    panes.find((entry) => entry.id === 'resident')?.pane ??
    withHeader(unavailablePane(), 'Resident', { includeClaimEnteredAgo: true });
  const coordinator =
    panes.find((entry) => entry.id === 'coordinator')?.pane ??
    withHeader(unavailablePane(), 'Coordinator');
  const anyAvailable = panes.some((entry) => entry.pane.available);
  return {
    available: anyAvailable,
    resident,
    coordinator,
    panes,
  };
}
