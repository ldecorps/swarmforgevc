// BL-696: /log skill — tail operator logs to Telegram.

import * as fs from 'fs';
import * as path from 'path';
import { expediteLogPath, normalizeExpediteTicket, readExpediteLock } from './telegramCursorBridgeExpedite';
import { readRedeployLock, redeployLogPath } from './telegramCursorBridgeRedeploy';

export const DEFAULT_LOG_TAIL_LINES = 40;
export const DEFAULT_LOG_MAX_CHARS = 3800;

export type LogTarget =
  | { kind: 'auto' }
  | { kind: 'expedite'; ticket: string }
  | { kind: 'redeploy' }
  | { kind: 'bridge' };

/** Parse `/log`, `/log expedite [BL-xxx]`, `/log redeploy`, `/log bridge`. */
export function parseLogCommand(text: string, defaultTicket = 'BL-696'): LogTarget | undefined {
  const match = text.trim().match(/^\/log(?:\s+(\S+)(?:\s+(\S+))?)?\s*$/i);
  if (!match) {
    return undefined;
  }
  const kind = match[1]?.toLowerCase();
  const arg = match[2];
  if (!kind) {
    return { kind: 'auto' };
  }
  if (kind === 'redeploy') {
    return { kind: 'redeploy' };
  }
  if (kind === 'bridge') {
    return { kind: 'bridge' };
  }
  if (kind === 'expedite') {
    const ticket = normalizeExpediteTicket(arg, defaultTicket);
    return ticket ? { kind: 'expedite', ticket } : undefined;
  }
  return undefined;
}

export function bridgeSupervisorLogPath(repoRoot: string): string {
  return path.join(repoRoot, '.swarmforge', 'operator', 'cursor-bridge-supervisor.log');
}

export function resolveLogTarget(
  repoRoot: string,
  target: LogTarget,
  expediteLock = readExpediteLock(repoRoot),
  redeployLock = readRedeployLock(repoRoot)
): Exclude<LogTarget, { kind: 'auto' }> {
  if (target.kind !== 'auto') {
    return target;
  }
  if (expediteLock) {
    return { kind: 'expedite', ticket: expediteLock.ticket };
  }
  if (redeployLock) {
    return { kind: 'redeploy' };
  }
  return { kind: 'bridge' };
}

export function logPathForTarget(repoRoot: string, target: Exclude<LogTarget, { kind: 'auto' }>): string {
  switch (target.kind) {
    case 'expedite':
      return expediteLogPath(repoRoot, target.ticket);
    case 'redeploy':
      return redeployLogPath(repoRoot);
    case 'bridge':
      return bridgeSupervisorLogPath(repoRoot);
  }
}

export function logLabelForTarget(target: Exclude<LogTarget, { kind: 'auto' }>): string {
  switch (target.kind) {
    case 'expedite':
      return `Expedite ${target.ticket}`;
    case 'redeploy':
      return 'Redeploy';
    case 'bridge':
      return 'Bridge supervisor';
  }
}

export function tailTextLines(text: string, maxLines: number): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return text;
  }
  return lines.slice(-maxLines).join('\n');
}

export function truncateTelegramLog(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `…${text.slice(-(maxChars - 1))}`;
}

export function readLogTail(
  filePath: string,
  maxLines = DEFAULT_LOG_TAIL_LINES,
  maxChars = DEFAULT_LOG_MAX_CHARS,
  readFile: (path: string, encoding: 'utf8') => string = fs.readFileSync,
  exists: (path: string) => boolean = fs.existsSync
): string {
  if (!exists(filePath)) {
    return '';
  }
  try {
    const raw = readFile(filePath, 'utf8');
    return truncateTelegramLog(tailTextLines(raw, maxLines), maxChars);
  } catch {
    return '';
  }
}

export function formatLogTelegramMessage(
  repoRoot: string,
  target: LogTarget,
  maxLines = DEFAULT_LOG_TAIL_LINES,
  maxChars = DEFAULT_LOG_MAX_CHARS,
  readTail: typeof readLogTail = readLogTail
): string {
  const resolved = resolveLogTarget(repoRoot, target);
  const filePath = logPathForTarget(repoRoot, resolved);
  const label = logLabelForTarget(resolved);
  const body = readTail(filePath, maxLines, maxChars);
  if (!body) {
    return `${label} log\n(path: ${filePath})\n(empty or missing)`;
  }
  return `${label} log (last ${maxLines} lines)\n${filePath}\n\n\`\`\`\n${body}\n\`\`\``;
}
