// BL-521: pure render for the standing "Resident Spy" Telegram topic - a
// monospace snapshot of the live resident agent pane (tmux capture-pane),
// change-gated on the body (role + pane text) so an unchanged pane does not
// bump the footer every concierge tick. I/O half is residentPaneSpySync.ts.

import * as fs from 'fs';
import * as path from 'path';
import { formatUpdatedAtLabel } from './pipelineBoard';
import { lookupBacklogItemById, readBacklogFolders } from '../panel/backlogReader';
import { extractTicketId, findTicketIdInText, readHandoffHeaderRecordsWithBatches } from '../metrics/swarmMetrics';
import { mailboxDir, parseRolesTsv, readPipelineStages } from '../swarm/swarmState';

export const RESIDENT_PANE_SPY_MESSAGE_MAX_LENGTH = 4000;
export const SWARM_LIVE_SCREEN_NAME = 'Swarm Live Screen';
/** @deprecated Use SWARM_LIVE_SCREEN_NAME */
export const MONO_ROUTER_LIVE_SCREEN_NAME = SWARM_LIVE_SCREEN_NAME;
/** @deprecated Use SWARM_LIVE_SCREEN_NAME */
export const RESIDENT_PANE_SPY_TOPIC_NAME = SWARM_LIVE_SCREEN_NAME;
export const RESIDENT_PANE_SPY_DEFAULT_LINES = 40;
// Wider scrollback for role banner search — the SwarmForge title scrolls off
// the default tail while the agent is mid-tool-run.
export const RESIDENT_PANE_SPY_ROLE_SEARCH_LINES = 300;

const ROLE_BANNER = /\bSwarmForge\s+(\S+)/gi;

export interface ResidentRoleIdentity {
  roleLabel: string;
  modelRole: string;
}

export interface ResidentPaneSpySnapshot {
  roleLabel: string;
  paneText: string;
  sessionTarget?: string;
  modelLabel?: string;
  ticketId?: string;
  ticketTitle?: string;
  claimEnteredAtMs?: number;
  claimEnteredAgo?: string;
}

export function formatClaimEnteredAgo(claimEnteredAtMs: number, nowMs: number = Date.now()): string {
  const elapsedSec = Math.max(0, Math.floor((nowMs - claimEnteredAtMs) / 1000));
  if (elapsedSec < 60) {
    return `entered ${elapsedSec}s ago`;
  }
  const elapsedMin = Math.floor(elapsedSec / 60);
  if (elapsedMin < 60) {
    return `entered ${elapsedMin}m ago`;
  }
  const elapsedHr = Math.floor(elapsedMin / 60);
  if (elapsedHr < 48) {
    return `entered ${elapsedHr}h ago`;
  }
  const elapsedDay = Math.floor(elapsedHr / 24);
  return `entered ${elapsedDay}d ago`;
}

/** BL-1046: compact claim age for phone grid tiles ("32m", not "entered 32m ago"). */
export function formatClaimAgeCompact(claimEnteredAtMs: number, nowMs: number = Date.now()): string {
  const elapsedSec = Math.max(0, Math.floor((nowMs - claimEnteredAtMs) / 1000));
  if (elapsedSec < 60) {
    return `${elapsedSec}s`;
  }
  const elapsedMin = Math.floor(elapsedSec / 60);
  if (elapsedMin < 60) {
    return `${elapsedMin}m`;
  }
  const elapsedHr = Math.floor(elapsedMin / 60);
  if (elapsedHr < 48) {
    return `${elapsedHr}h`;
  }
  const elapsedDay = Math.floor(elapsedHr / 24);
  return `${elapsedDay}d`;
}

export function formatResidentSpyHeader(
  snap: Pick<ResidentPaneSpySnapshot, 'roleLabel' | 'modelLabel' | 'sessionTarget' | 'ticketId' | 'ticketTitle'>,
  prefix: string = 'Resident',
  options: { includeSession?: boolean } = {}
): string {
  const model = snap.modelLabel ? ` on ${snap.modelLabel}` : '';
  const ticket =
    snap.ticketId !== undefined
      ? ` - ${snap.ticketId}${snap.ticketTitle ? ` - ${snap.ticketTitle}` : ''}`
      : '';
  const includeSession = options.includeSession ?? true;
  const session = includeSession && snap.sessionTarget ? ` (${snap.sessionTarget})` : '';
  return `${prefix}: ${snap.roleLabel}${model}${ticket}${session}`;
}

export interface ResidentHeldTicketMeta {
  ticketId?: string;
  ticketTitle?: string;
  claimEnteredAtMs?: number;
  /** BL-1046: in_process parcels beyond the earliest claim (batch seats). */
  heldParcelCount?: number;
}

function readRoleEntry(targetPath: string, modelRole: string) {
  const rolesFile = path.join(targetPath, '.swarmforge', 'roles.tsv');
  if (!fs.existsSync(rolesFile)) {
    return undefined;
  }
  return parseRolesTsv(fs.readFileSync(rolesFile, 'utf8')).find((entry) => entry.role === modelRole);
}

export function extractTicketIdFromHandoffHeaders(headers: Record<string, string>): string | null {
  const fromTask = headers.task ? extractTicketId(headers.task) : null;
  if (fromTask) {
    return fromTask;
  }
  return headers.message ? findTicketIdInText(headers.message) : null;
}

function readInProcessClaimsForRole(
  targetPath: string,
  modelRole: string
): { earliest?: { ticketId: string; claimEnteredAtMs?: number }; heldParcelCount: number } {
  const roleEntry = readRoleEntry(targetPath, modelRole);
  if (!roleEntry) {
    return { heldParcelCount: 0 };
  }
  const inProcessDir = mailboxDir(roleEntry, 'inbox', 'in_process');
  let earliest: { ticketId: string; claimEnteredAtMs?: number } | undefined;
  let heldParcelCount = 0;
  for (const headers of readHandoffHeaderRecordsWithBatches(inProcessDir)) {
    const ticketId = extractTicketIdFromHandoffHeaders(headers);
    if (!ticketId) {
      continue;
    }
    heldParcelCount += 1;
    const ms = headers.dequeued_at ? Date.parse(headers.dequeued_at) : NaN;
    const claimEnteredAtMs = Number.isNaN(ms) ? undefined : ms;
    if (!earliest) {
      earliest = { ticketId, claimEnteredAtMs };
      continue;
    }
    if (claimEnteredAtMs !== undefined && (earliest.claimEnteredAtMs === undefined || claimEnteredAtMs < earliest.claimEnteredAtMs)) {
      earliest = { ticketId, claimEnteredAtMs };
    }
  }
  return { earliest, heldParcelCount };
}

// BL-1189 invariant 1: a ticket that has moved out of backlog/active (a
// bookkeep-closed ticket, most commonly) must never read as primary working
// now, even when a role's in_process claim file for it was never cleared -
// BL-600 stayed "working" on four tiles this way through a close cascade.
// lookupBacklogItemById searches every folder including done/, so presence
// alone cannot distinguish a live claim from a stale one; only active/
// membership can.
function isTicketActive(targetPath: string, ticketId: string): boolean {
  const needle = ticketId.toUpperCase();
  return readBacklogFolders(targetPath).active.some((item) => item.id.toUpperCase() === needle);
}

export function resolveResidentHeldTicketMeta(targetPath: string, modelRole: string): ResidentHeldTicketMeta {
  const { earliest: claim, heldParcelCount } = readInProcessClaimsForRole(targetPath, modelRole);
  const ticketId =
    claim?.ticketId ??
    readPipelineStages(targetPath).find((stage) => stage.role === modelRole)?.heldTicketIds[0];
  if (!ticketId || !isTicketActive(targetPath, ticketId)) {
    return {};
  }
  const claimEnteredAtMs = claim?.claimEnteredAtMs;
  const parcelCount = heldParcelCount > 1 ? heldParcelCount : undefined;
  const item = lookupBacklogItemById(targetPath, ticketId);
  return {
    ticketId: item?.id ?? ticketId,
    ...(item?.title !== undefined ? { ticketTitle: item.title } : {}),
    ...(claimEnteredAtMs !== undefined ? { claimEnteredAtMs } : {}),
    ...(parcelCount !== undefined ? { heldParcelCount: parcelCount } : {}),
  };
}

export function resolveResidentHeldTicketMetaForRoles(
  targetPath: string,
  modelRoles: readonly string[]
): ResidentHeldTicketMeta {
  for (const modelRole of modelRoles) {
    const meta = resolveResidentHeldTicketMeta(targetPath, modelRole);
    if (meta.ticketId) {
      return meta;
    }
  }
  return {};
}

// BL-1189 invariant 2: across one capture, a given ticket is primary
// working on at most one seat - the FIRST role (in the caller's processing
// order) to report it keeps the attribution; any later role reporting the
// SAME ticket in the same capture had it demoted-or-omitted rather than
// shown as an equal, independent "working now" claim on a second tile.
// `claimedTicketIds` is mutated in place (threaded across the caller's
// per-role loop for one capture) - never persisted between captures, so a
// genuine re-claim on the NEXT capture is unaffected.
export function dedupePrimaryWorkingTicket(
  claimedTicketIds: Set<string>,
  meta: ResidentHeldTicketMeta
): ResidentHeldTicketMeta {
  if (!meta.ticketId) {
    return meta;
  }
  if (claimedTicketIds.has(meta.ticketId)) {
    return {};
  }
  claimedTicketIds.add(meta.ticketId);
  return meta;
}

export function readMonoRouterActiveRole(targetPath: string): string | undefined {
  try {
    const role = fs
      .readFileSync(path.join(targetPath, '.swarmforge', 'mono-router-active-role'), 'utf8')
      .trim();
    return role || undefined;
  } catch {
    return undefined;
  }
}

function rosterEntryForToken(
  token: string,
  roles: ReadonlyArray<{ role: string; displayName: string }>
): { role: string; displayName: string } | undefined {
  const lower = token.toLowerCase();
  return (
    roles.find((entry) => entry.displayName.toLowerCase() === lower) ??
    roles.find((entry) => entry.role.toLowerCase() === lower)
  );
}

export function inferRoleLabelFromPane(
  paneText: string,
  roles?: ReadonlyArray<{ role: string; displayName: string }>
): string {
  if (!roles?.length) {
    const match = /\bSwarmForge\s+(\S+)/i.exec(paneText);
    return match?.[1] ?? 'unknown';
  }
  let lastKnown: string | undefined;
  for (const match of paneText.matchAll(ROLE_BANNER)) {
    const token = match[1];
    if (rosterEntryForToken(token, roles)) {
      lastKnown = token;
    }
  }
  return lastKnown ?? 'unknown';
}

export function resolveResidentRoleIdentity(
  paneText: string,
  homeRoleEntry: { role: string; displayName: string },
  roles: ReadonlyArray<{ role: string; displayName: string }>,
  activeRoleId?: string
): ResidentRoleIdentity {
  if (activeRoleId) {
    const active = roles.find((entry) => entry.role === activeRoleId);
    if (active) {
      return { roleLabel: active.displayName, modelRole: active.role };
    }
  }
  const banner = inferRoleLabelFromPane(paneText, roles);
  if (banner !== 'unknown') {
    const matched = rosterEntryForToken(banner, roles);
    if (matched) {
      return { roleLabel: matched.displayName, modelRole: matched.role };
    }
    return { roleLabel: banner, modelRole: homeRoleEntry.role };
  }
  return { roleLabel: homeRoleEntry.displayName, modelRole: homeRoleEntry.role };
}

/** Keep the TAIL of the pane (what the agent is doing NOW). */
export function trimPaneToBudget(paneText: string, maxBodyChars: number): string {
  const normalized = paneText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (normalized.length <= maxBodyChars) {
    return normalized;
  }
  const lines = normalized.split('\n');
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const add = line.length + (kept.length > 0 ? 1 : 0);
    if (used + add > maxBodyChars) {
      break;
    }
    kept.unshift(line);
    used += add;
  }
  return kept.join('\n');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderHeader(snap: ResidentPaneSpySnapshot): string {
  return formatResidentSpyHeader(snap);
}

export function renderResidentPaneSpyBody(snap: ResidentPaneSpySnapshot): string {
  const header = renderHeader(snap);
  const maxPane = Math.max(200, RESIDENT_PANE_SPY_MESSAGE_MAX_LENGTH - header.length - 80);
  const pane = trimPaneToBudget(snap.paneText.trimEnd(), maxPane);
  const paneBlock = pane.length > 0 ? pane : '(pane empty)';
  return `${header}\n\n${paneBlock}`;
}

export function renderResidentPaneSpyFooter(lastChangeMs: number): string {
  return `updated at ${formatUpdatedAtLabel(lastChangeMs)}`;
}

export function renderResidentPaneSpy(snap: ResidentPaneSpySnapshot, lastChangeMs: number): string {
  return `${renderResidentPaneSpyBody(snap)}\n\n${renderResidentPaneSpyFooter(lastChangeMs)}`;
}

export function wrapResidentPaneSpyHtml(boardText: string): string {
  return `<pre>${escapeHtml(boardText)}</pre>`;
}
