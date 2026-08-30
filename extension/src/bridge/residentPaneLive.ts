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
  dedupePrimaryWorkingTicket,
  formatResidentSpyHeader,
  formatClaimEnteredAgo,
} from '../concierge/residentPaneSpy';
import { readRoleModelId } from '../swarm/backendSwitch';
import { formatModelDisplayName } from '../swarm/modelDisplayName';
import { resolveSwarmConfigPath, configHasRotationRouter } from '../swarm/swarmLauncher';

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
  heldParcelCount?: number;
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
  /** BL-929: true when the running pack is a rotation (mono-router) pack -
   *  the one layout with a Resident tile and a global ticket strip. The
   *  shared renderer (residentSpyUiHtml.ts, loaded by both the Mini App and
   *  Bubble Live) reads this instead of inferring layout client-side. */
  monoRouterLayout: boolean;
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
  monoRouterActiveRole?: string,
  claimedTicketIds: Set<string> = new Set()
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
  const rawHeldTicket = resolveResidentHeldTicketMetaForRoles(targetPath, [
    monoRouterActiveRole,
    identity.modelRole,
    roleEntry.role,
  ].filter((role, index, rolesToTry): role is string => !!role && rolesToTry.indexOf(role) === index));
  // BL-1189 invariant 2: this tile's claim is demoted-or-omitted (never an
  // equal, independent "working now" strip) when an earlier-processed tile
  // in the SAME capture already claimed the same ticket.
  const heldTicket = dedupePrimaryWorkingTicket(claimedTicketIds, rawHeldTicket);
  return {
    available: true,
    roleLabel: identity.roleLabel,
    paneText,
    sessionTarget: target,
    modelLabel: modelId ? formatModelDisplayName(modelId) : undefined,
    ...heldTicket,
  };
}

// BL-929 invariant 1: the mono-router active-role marker's signature has NO
// place for it - a structural guarantee, not just a behavioral one, that
// its presence, absence or contents can never decide layout.
// handoff_lib.bb's write-mono-router-active-role! keeps the marker
// maintained throughout a standing full pack's whole run (measured
// 2026-08-18: mtime fourteen minutes into a full-forge launch), so treating
// it as evidence renders a RESIDENT tile and a global ticket strip under a
// pack that has neither. Layout is decided from positive evidence of the
// running pack instead: the effective pack config's own `config rotation
// router` declaration (the strongest signal - present in every rotation
// pack's conf, absent from every standing pack's, no launch-time
// transient) when resolvable, else the live session count. The live count
// is already correct on its own but briefly reads <= 2 while a full pack's
// sessions come up one at a time, so it is the fallback, not the primary
// signal.
export function decideMonoRouterLayout(evidence: {
  configRotationRouter?: boolean;
  liveRoleCount: number;
}): boolean {
  if (evidence.configRotationRouter !== undefined) {
    return evidence.configRotationRouter;
  }
  return evidence.liveRoleCount <= 2;
}

function isMonoRouterLayout(_targetPath: string, liveRoles: SwarmRole[]): boolean {
  const configPath = resolveSwarmConfigPath();
  return decideMonoRouterLayout({
    configRotationRouter: configPath ? configHasRotationRouter(configPath) : undefined,
    liveRoleCount: liveRoles.length,
  });
}

// BL-929 invariant 2: a tile never displays another role's identity. This
// is the ONLY place a pane's identity can be overridden by another role's
// id at all, and it is bounded to exactly one case - monoLayout true AND
// this pane IS the coder/resident pane - so a non-coder pane, or any pane
// under a non-mono-router layout, always returns undefined here and keeps
// its own identity downstream in resolveResidentRoleIdentity.
export function monoRouterActiveRoleForPane(
  monoLayout: boolean,
  role: string,
  activeRole: string | undefined
): string | undefined {
  return monoLayout && role === 'coder' ? activeRole : undefined;
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
  // BL-1189 invariant 2: shared across every tile in this one capture, so
  // only the first tile to claim a given ticket keeps it.
  const claimedTicketIds = new Set<string>();
  return orderLiveScreenRoles(liveRoles).map((roleEntry) => {
    const id = liveScreenPaneId(roleEntry, monoLayout);
    const label = liveScreenPaneLabel(roleEntry, monoLayout);
    const monoActive = monoRouterActiveRoleForPane(monoLayout, roleEntry.role, activeRole);
    const raw = tryCaptureRolePane(targetPath, socketPath, roleEntry, roles, paneBaseIndex, monoActive, claimedTicketIds);
    const showClaimEntered = id === 'resident' || roleEntry.role === 'coder';
    const pane = withHeader(raw ? { ...raw, available: true } : unavailablePane(), label, {
      includeClaimEnteredAgo: showClaimEntered,
    });
    return { id, label, pane };
  });
}

export function captureMonoRouterLiveScreenUncached(targetPath: string): MonoRouterLiveScreenSnapshot {
  const panes = captureLiveScreenPanes(targetPath);
  const resident =
    panes.find((entry) => entry.id === 'resident')?.pane ??
    withHeader(unavailablePane(), 'Resident', { includeClaimEnteredAgo: true });
  const coordinator =
    panes.find((entry) => entry.id === 'coordinator')?.pane ??
    withHeader(unavailablePane(), 'Coordinator');
  const anyAvailable = panes.some((entry) => entry.pane.available);
  // Recomputed rather than derived from `panes` (e.g. "does any entry carry
  // id 'resident'"): a mono-router pack whose coder pane fails to capture
  // this tick would otherwise misread as a standing pack. Same inputs
  // captureLiveScreenPanes already used, so the layout this snapshot
  // reports always matches the layout its own panes were built under.
  const monoRouterLayout = isMonoRouterLayout(targetPath, readLiveSwarmRoles(targetPath));
  return {
    available: anyAvailable,
    resident,
    coordinator,
    panes,
    monoRouterLayout,
  };
}

// BL-881: the Resident Spy Mini App polls /resident-pane faster than this
// synchronous tmux + filesystem walk can finish under load, so overlapping
// polls pile onto the bridge's single event-loop thread and wedge it. A
// short TTL cache lets back-to-back polls for the same targetPath share one
// walk instead of each paying for their own. Keyed by targetPath so two
// roots never share a snapshot.
export const RESIDENT_PANE_CACHE_TTL_MS = 5_000;

interface CachedLiveScreen {
  snapshot: MonoRouterLiveScreenSnapshot;
  capturedAtMs: number;
}

const liveScreenCacheByTargetPath = new Map<string, CachedLiveScreen>();

export function captureMonoRouterLiveScreen(
  targetPath: string,
  nowMs: number = Date.now()
): MonoRouterLiveScreenSnapshot {
  const cached = liveScreenCacheByTargetPath.get(targetPath);
  if (cached && nowMs - cached.capturedAtMs < RESIDENT_PANE_CACHE_TTL_MS) {
    return cached.snapshot;
  }
  const snapshot = captureMonoRouterLiveScreenUncached(targetPath);
  liveScreenCacheByTargetPath.set(targetPath, { snapshot, capturedAtMs: nowMs });
  return snapshot;
}

/** Test hook: forces the next captureMonoRouterLiveScreen call to re-walk. */
export function clearResidentPaneLiveCache(): void {
  liveScreenCacheByTargetPath.clear();
}
