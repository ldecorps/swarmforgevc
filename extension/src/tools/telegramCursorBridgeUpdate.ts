// BL-696: /update — short summary of agent / expedite / swarm activity.

import * as fs from 'fs';
import * as path from 'path';
import {
  formatActiveRunUpdate,
  readActiveRun,
  type CursorBridgeActiveRun,
} from '../bridge/cursorBridgeRunTracker';
import { readExpediteLock } from './telegramCursorBridgeExpedite';
import { readRedeployLock } from './telegramCursorBridgeRedeploy';

export interface ExpediteProgressSnapshot {
  ticket: string;
  stage?: string;
  status?: string;
  detail?: string;
  line?: string;
  updatedAtMs?: number;
}

export interface ActiveTicketSnapshot {
  id: string;
  assignedTo?: string;
  title?: string;
}

export interface UpdateSnapshot {
  agentRun?: CursorBridgeActiveRun;
  bridgeBusy: boolean;
  expedite?: ExpediteProgressSnapshot;
  redeployPid?: number;
  activeTickets: ActiveTicketSnapshot[];
  nowMs?: number;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

export function parseExpediteProgressRaw(raw: unknown): ExpediteProgressSnapshot | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const ticket = typeof record.ticket === 'string' ? record.ticket : undefined;
  if (!ticket) {
    return undefined;
  }
  return {
    ticket,
    stage: typeof record.stage === 'string' ? record.stage : undefined,
    status: typeof record.status === 'string' ? record.status : undefined,
    detail: typeof record.detail === 'string' ? record.detail : undefined,
    line: typeof record.line === 'string' ? record.line : undefined,
    updatedAtMs: typeof record['updated-at-ms'] === 'number' ? record['updated-at-ms'] : undefined,
  };
}

export function parseActiveTicketYaml(raw: string): ActiveTicketSnapshot | undefined {
  const idMatch = raw.match(/^id:\s*(BL-\d+)/m);
  if (!idMatch) {
    return undefined;
  }
  const assigned = raw.match(/^assigned_to:\s*(\S+)/m);
  const title = raw.match(/^title:\s*"?([^"\n]+)"?/m);
  return {
    id: idMatch[1],
    assignedTo: assigned?.[1],
    title: title?.[1]?.trim(),
  };
}

export function formatExpediteUpdate(progress: ExpediteProgressSnapshot, nowMs = Date.now()): string {
  const lines = [`Expedite ${progress.ticket}`];
  if (progress.line) {
    lines.push(progress.line);
  } else {
    const stage = progress.stage ?? 'unknown';
    const status = progress.status ?? 'unknown';
    lines.push(`${stage} — ${status}`);
    if (progress.detail) {
      lines.push(progress.detail);
    }
  }
  if (typeof progress.updatedAtMs === 'number') {
    lines.push(`Last progress: ${formatElapsed(nowMs - progress.updatedAtMs)} ago`);
  }
  return lines.join('\n');
}

export function formatSwarmUpdate(tickets: ActiveTicketSnapshot[]): string {
  if (tickets.length === 0) {
    return 'Swarm: sleeping';
  }
  const lines = ['Swarm: working'];
  for (const ticket of tickets.slice(0, 5)) {
    const role = ticket.assignedTo ?? 'unassigned';
    const title = ticket.title ? ` — ${ticket.title}` : '';
    lines.push(`• ${ticket.id} @ ${role}${title}`);
  }
  if (tickets.length > 5) {
    lines.push(`• …and ${tickets.length - 5} more`);
  }
  return lines.join('\n');
}

export function formatUpdateMessage(snapshot: UpdateSnapshot): string {
  const nowMs = snapshot.nowMs ?? Date.now();
  const sections: string[] = [];

  if (snapshot.agentRun) {
    sections.push(formatActiveRunUpdate(snapshot.agentRun, nowMs));
  } else {
    sections.push(
      snapshot.bridgeBusy
        ? 'Cursor agent: busy (run finishing or starting).'
        : 'Cursor agent: idle.'
    );
  }

  if (snapshot.expedite) {
    sections.push(formatExpediteUpdate(snapshot.expedite, nowMs));
  }

  if (snapshot.redeployPid !== undefined) {
    sections.push(`Redeploy running (pid ${snapshot.redeployPid}).`);
  }

  sections.push(formatSwarmUpdate(snapshot.activeTickets));
  return sections.join('\n\n');
}

/** Backward-compatible alias used by older call sites. */
export function formatOperationalUpdateMessage(repoRoot: string, nowMs = Date.now()): string {
  return formatUpdateMessage({ ...collectUpdateSnapshot(repoRoot, false), nowMs });
}

export function readExpediteProgress(
  repoRoot: string,
  ticket?: string
): ExpediteProgressSnapshot | undefined {
  const lock = readExpediteLock(repoRoot);
  const chosen = ticket ?? lock?.ticket;
  if (!chosen) {
    return undefined;
  }
  const progressPath = path.join(repoRoot, '.swarmforge', 'expedite', chosen, 'progress.json');
  if (!fs.existsSync(progressPath)) {
    return lock ? { ticket: chosen, status: 'running', detail: `pid ${lock.pid}` } : undefined;
  }
  try {
    const parsed = parseExpediteProgressRaw(JSON.parse(fs.readFileSync(progressPath, 'utf8')));
    return parsed ?? { ticket: chosen };
  } catch {
    return { ticket: chosen, status: 'running' };
  }
}

export function readActiveTickets(repoRoot: string): ActiveTicketSnapshot[] {
  const activeDir = path.join(repoRoot, 'backlog', 'active');
  if (!fs.existsSync(activeDir)) {
    return [];
  }
  const files = fs
    .readdirSync(activeDir)
    .filter((name) => name.endsWith('.yaml'))
    .sort();
  const tickets: ActiveTicketSnapshot[] = [];
  for (const name of files) {
    try {
      const parsed = parseActiveTicketYaml(fs.readFileSync(path.join(activeDir, name), 'utf8'));
      if (parsed) {
        tickets.push(parsed);
      }
    } catch {
      // skip unreadable ticket files
    }
  }
  return tickets;
}

export function collectUpdateSnapshot(repoRoot: string, bridgeBusy: boolean): UpdateSnapshot {
  const redeploy = readRedeployLock(repoRoot);
  return {
    agentRun: readActiveRun(),
    bridgeBusy,
    expedite: readExpediteProgress(repoRoot),
    redeployPid: redeploy?.pid,
    activeTickets: readActiveTickets(repoRoot),
  };
}
