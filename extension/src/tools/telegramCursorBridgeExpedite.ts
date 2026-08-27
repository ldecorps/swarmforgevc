// BL-696: /expedite skill — spawn offline expeditor with Telegram progress.

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const TICKET_PATTERN = /^BL-\d+$/i;

export function normalizeExpediteTicket(raw: string | undefined, fallback = 'BL-696'): string | undefined {
  const candidate = (raw ?? fallback).trim().toUpperCase();
  return TICKET_PATTERN.test(candidate) ? candidate : undefined;
}

/** Parse `/expedite` or `/expedite BL-696` (case-insensitive). */
export function parseExpediteTicket(text: string, defaultTicket = 'BL-696'): string | undefined {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/expedite(?:\s+(\S+))?\s*$/i);
  if (!match) {
    return undefined;
  }
  return normalizeExpediteTicket(match[1], defaultTicket);
}

/** Parse `/reexpedite` or `/reexpedite BL-696` (case-insensitive). */
export function parseReexpediteTicket(text: string, defaultTicket = 'BL-696'): string | undefined {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/reexpedite(?:\s+(\S+))?\s*$/i);
  if (!match) {
    return undefined;
  }
  return normalizeExpediteTicket(match[1], defaultTicket);
}

export function expediteScriptPath(repoRoot: string): string {
  return path.join(repoRoot, 'swarmforge', 'scripts', 'expedite_with_progress.sh');
}

export function reexpediteScriptPath(repoRoot: string): string {
  return path.join(repoRoot, 'swarmforge', 'scripts', 'reexpedite_from_wip.sh');
}

export function expediteLogPath(repoRoot: string, ticket: string): string {
  return path.join(repoRoot, '.swarmforge', 'operator', `expedite-${ticket}.log`);
}

export function isExpediteScriptPresent(repoRoot: string): boolean {
  return fs.existsSync(expediteScriptPath(repoRoot));
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readExpediteLock(repoRoot: string): { ticket: string; pid: number } | undefined {
  const lockPath = path.join(repoRoot, '.swarmforge', 'operator', 'expedite-bridge.lock');
  if (!fs.existsSync(lockPath)) {
    return undefined;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { ticket?: string; pid?: number };
    if (typeof raw.pid !== 'number' || !raw.ticket) {
      return undefined;
    }
    if (!isPidAlive(raw.pid)) {
      fs.unlinkSync(lockPath);
      return undefined;
    }
    return { ticket: raw.ticket, pid: raw.pid };
  } catch {
    return undefined;
  }
}

function writeExpediteLock(repoRoot: string, ticket: string, pid: number): void {
  const lockPath = path.join(repoRoot, '.swarmforge', 'operator', 'expedite-bridge.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, `${JSON.stringify({ ticket, pid, startedAtMs: Date.now() }, null, 2)}\n`, 'utf8');
}

export type StartExpediteResult =
  | { ok: true; ticket: string; logPath: string; pid: number }
  | { ok: false; reason: 'already-running' | 'missing-script' | 'spawn-failed'; detail: string };

export function startExpediteRun(
  repoRoot: string,
  ticket: string,
  spawnFn: typeof spawn = spawn
): StartExpediteResult {
  return startExpediteScript(repoRoot, ticket, expediteScriptPath(repoRoot), spawnFn);
}

export function startReexpediteRun(
  repoRoot: string,
  ticket: string,
  spawnFn: typeof spawn = spawn
): StartExpediteResult {
  return startExpediteScript(repoRoot, ticket, reexpediteScriptPath(repoRoot), spawnFn);
}

function startExpediteScript(
  repoRoot: string,
  ticket: string,
  script: string,
  spawnFn: typeof spawn
): StartExpediteResult {
  const normalized = normalizeExpediteTicket(ticket);
  if (!normalized) {
    return { ok: false, reason: 'spawn-failed', detail: 'invalid ticket id' };
  }
  const existing = readExpediteLock(repoRoot);
  if (existing) {
    return {
      ok: false,
      reason: 'already-running',
      detail: `${existing.ticket} (pid ${existing.pid})`,
    };
  }
  if (!fs.existsSync(script)) {
    return { ok: false, reason: 'missing-script', detail: script };
  }
  const logPath = expediteLogPath(repoRoot, normalized);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const outFd = fs.openSync(logPath, 'a');
  const errFd = fs.openSync(logPath, 'a');
  try {
    const child = spawnFn('bash', [script, repoRoot, normalized], {
      detached: true,
      stdio: ['ignore', outFd, errFd],
      env: { ...process.env, EXPEDITE_NOTIFY: '1' },
    });
    child.unref();
    const pid = child.pid;
    if (pid === undefined) {
      return { ok: false, reason: 'spawn-failed', detail: 'no pid from spawn' };
    }
    writeExpediteLock(repoRoot, normalized, pid);
    return { ok: true, ticket: normalized, logPath, pid };
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }
}

export function formatExpediteStartMessage(result: Extract<StartExpediteResult, { ok: true }>): string {
  return [
    `🛡 Expedite ${result.ticket} started (pid ${result.pid}).`,
    'Stage updates will appear in this topic.',
    `Log: ${result.logPath}`,
  ].join('\n');
}

export function formatReexpediteStartMessage(result: Extract<StartExpediteResult, { ok: true }>): string {
  return [
    `🔄 WIP checkpoint and restart for ${result.ticket} started (pid ${result.pid}).`,
    'The divergent run will be abandoned, main WIP committed, then expedite relaunched.',
    `Log: ${result.logPath}`,
  ].join('\n');
}

export function formatExpediteFailureMessage(result: Extract<StartExpediteResult, { ok: false }>): string {
  if (result.reason === 'already-running') {
    return `Expedite already running: ${result.detail}. Wait for it to finish or stop the process.`;
  }
  if (result.reason === 'missing-script') {
    return `Expedite script not found at ${result.detail}`;
  }
  return `Could not start expedite: ${result.detail}`;
}
