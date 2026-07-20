// BL-521: pure render for the standing "Resident Spy" Telegram topic - a
// monospace snapshot of the live resident agent pane (tmux capture-pane),
// change-gated on the body (role + pane text) so an unchanged pane does not
// bump the footer every concierge tick. I/O half is residentPaneSpySync.ts.

import { formatUpdatedAtLabel } from './pipelineBoard';

export const RESIDENT_PANE_SPY_MESSAGE_MAX_LENGTH = 4000;
export const RESIDENT_PANE_SPY_TOPIC_NAME = 'Resident Spy';
export const RESIDENT_PANE_SPY_DEFAULT_LINES = 40;
// Wider scrollback for role banner search — the SwarmForge title scrolls off
// the default tail while the agent is mid-tool-run.
export const RESIDENT_PANE_SPY_ROLE_SEARCH_LINES = 300;

const ROLE_BANNER = /SwarmForge\s+(\S+)/i;

export interface ResidentRoleIdentity {
  roleLabel: string;
  modelRole: string;
}

export interface ResidentPaneSpySnapshot {
  roleLabel: string;
  paneText: string;
  sessionTarget?: string;
  modelLabel?: string;
}

export function formatResidentSpyHeader(snap: Pick<ResidentPaneSpySnapshot, 'roleLabel' | 'modelLabel' | 'sessionTarget'>): string {
  const model = snap.modelLabel ? ` on ${snap.modelLabel}` : '';
  const session = snap.sessionTarget ? ` (${snap.sessionTarget})` : '';
  return `Resident: ${snap.roleLabel}${model}${session}`;
}

export function inferRoleLabelFromPane(paneText: string): string {
  const match = paneText.match(ROLE_BANNER);
  return match?.[1] ?? 'unknown';
}

export function resolveResidentRoleIdentity(
  paneText: string,
  homeRoleEntry: { role: string; displayName: string },
  roles: ReadonlyArray<{ role: string; displayName: string }>
): ResidentRoleIdentity {
  const banner = inferRoleLabelFromPane(paneText);
  if (banner !== 'unknown') {
    const matched =
      roles.find((entry) => entry.displayName.toLowerCase() === banner.toLowerCase()) ??
      roles.find((entry) => entry.role.toLowerCase() === banner.toLowerCase());
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
