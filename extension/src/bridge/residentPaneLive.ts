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
import { isPaneActivelyProcessing } from '../panel/agentPaneState';
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

/**
 * BL-1160's palette, unextended: the whole set a tile's dot may paint.
 * CPU, model and ticket cues are explicitly not status kinds.
 */
export type PaneActivitySignal = 'ok' | 'stale' | 'err';

export interface PaneLiveSnapshot {
  available: boolean;
  roleLabel?: string;
  paneText?: string;
  /**
   * BL-1243: THIS PANE's own activity, derived from the pane text this same
   * capture already holds. BL-1160 taught the UI to prefer it
   * (resolvePaneStatusKind in residentSpyUiHtml.ts) and deliberately left the
   * writer for later, saying not to fake one from aggregate data; this is
   * that writer. Absent means "no per-pane answer" and the UI falls back to
   * whole-poll freshness exactly as before.
   */
  activitySignal?: PaneActivitySignal;
  sessionTarget?: string;
  modelLabel?: string;
  ticketId?: string;
  ticketTitle?: string;
  claimEnteredAtMs?: number;
  claimEnteredAgo?: string;
  heldParcelCount?: number;
  header?: string;
  /**
   * BL-775 invariant 3: set only when the capture itself ran and failed for
   * a nameable reason (tmux capture-pane's own stderr, or an empty-output
   * verdict) — never a bare status code. Absent means "no pane here at
   * all" (the role isn't part of the running pack), which the UI reads as
   * idle, not broken.
   */
  reason?: string;
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

function unavailablePane(reason?: string): PaneLiveSnapshot {
  return reason ? { available: false, reason } : { available: false };
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

/**
 * BL-1243: one pane's own activity, from the text the Live Screen poll already
 * captured. Pure - no tmux, no probe, no second poll. That is the operator's
 * own stop condition on this ticket ("Is that a big runtime overhead? If so
 * don't do it"), so the derivation has to be CPU on data already paid for or
 * it must not ship at all.
 *
 * The mapping is not a free choice; the palette and scenario 01 decide it
 * between them. Only ok/stale/err exist, tiles polled together must be able to
 * DIFFER, and a busy agent is plainly the healthy one - so an alive-but-idle
 * pane can only be `stale`. It reads honestly too: `stale` on this dot means
 * "nothing is happening here", which for a pane whose text shows no live turn
 * is exactly true, and it is what makes a grid of dots tell the operator where
 * the work is.
 *
 * The two no-text cases are NOT the same, and collapsing them is how a tile
 * goes green on nothing:
 *   - no capture at all (`undefined`) means there is no pane here to speak
 *     for. No signal; the snapshot marks the pane unavailable and the UI's
 *     existing branch hides the dot, exactly as before this ticket.
 *   - a capture that came back BLANK is a pane we looked at and saw nothing
 *     on. Returning `undefined` there would hand the answer to the whole-poll
 *     aggregate - and the aggregate is precisely the thing that knows nothing
 *     about this pane, so inheriting its green is the fake-from-aggregate
 *     move BL-1160 refused and invariant 1 forbids. `stale` is the honest
 *     floor: no evidence this pane is doing anything.
 */
export function derivePaneActivitySignal(paneText: string | undefined): PaneActivitySignal | undefined {
  if (paneText === undefined) {
    return undefined;
  }
  if (!paneText.trim()) {
    return 'stale';
  }
  return isPaneActivelyProcessing(paneText) ? 'ok' : 'stale';
}

/**
 * BL-775 invariant 3: a discriminated result rather than `| undefined`, so
 * the ONE caller that needs to show a human why (captureLiveScreenPanes, the
 * Live Screen's own capture path) can, while the other two callers — which
 * only ever cared about truthy/falsy — keep their exact prior behaviour by
 * reading `.ok` instead of truthiness.
 */
type RolePaneCaptureResult = { ok: true; snapshot: PaneLiveSnapshot } | { ok: false; reason: string };

function tryCaptureRolePane(
  targetPath: string,
  socketPath: string,
  roleEntry: SwarmRole,
  roles: SwarmRole[],
  paneBaseIndex: number,
  monoRouterActiveRole?: string,
  claimedTicketIds: Set<string> = new Set()
): RolePaneCaptureResult {
  const target = resolveAgentPaneTarget(socketPath, roleEntry.session, paneBaseIndex);
  const captured = capturePane(socketPath, target, -RESIDENT_PANE_SPY_DEFAULT_LINES);
  if (captured.exitCode !== 0) {
    return { ok: false, reason: captured.stderr.trim() || `pane capture failed for ${roleEntry.role}` };
  }
  const paneText = stripAnsi(captured.stdout ?? '');
  if (!paneText.trim()) {
    return { ok: false, reason: `pane ${roleEntry.role} produced no output` };
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
    ok: true,
    snapshot: {
      available: true,
      roleLabel: identity.roleLabel,
      paneText,
      // Derived from `paneText` above - the capture this function already made,
      // never a second one (BL-1243 invariant 2).
      activitySignal: derivePaneActivitySignal(paneText),
      sessionTarget: target,
      modelLabel: modelId ? formatModelDisplayName(modelId) : undefined,
      ...heldTicket,
    },
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
    const result = tryCaptureRolePane(targetPath, socketPath, roleEntry, roles, paneBaseIndex, activeRole);
    if (result.ok) {
      return result.snapshot;
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
  const result = tryCaptureRolePane(targetPath, socketPath, roleEntry, roles, getPaneBaseIndex(socketPath));
  return result.ok ? result.snapshot : undefined;
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
    const result = tryCaptureRolePane(targetPath, socketPath, roleEntry, roles, paneBaseIndex, monoActive, claimedTicketIds);
    const showClaimEntered = id === 'resident' || roleEntry.role === 'coder';
    const pane = withHeader(result.ok ? result.snapshot : unavailablePane(result.reason), label, {
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
