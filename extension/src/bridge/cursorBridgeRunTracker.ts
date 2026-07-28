// In-memory tracker for the active Cursor agent run (same bridge process).

export const MAX_RUN_PROGRESS_LINES = 12;

export interface CursorBridgeActiveRun {
  prompt: string;
  startedAtMs: number;
  progressLines: string[];
}

let activeRun: CursorBridgeActiveRun | undefined;

export function parseUpdateCommand(text: string): boolean {
  return /^\/update\s*$/i.test(text.trim());
}

export function beginActiveRun(prompt: string, nowMs = Date.now()): void {
  activeRun = { prompt, startedAtMs: nowMs, progressLines: [] };
}

export function recordActiveRunProgress(line: string, maxLines = MAX_RUN_PROGRESS_LINES): void {
  if (!activeRun) {
    return;
  }
  activeRun.progressLines.push(line);
  if (activeRun.progressLines.length > maxLines) {
    activeRun.progressLines = activeRun.progressLines.slice(-maxLines);
  }
}

export function endActiveRun(): void {
  activeRun = undefined;
}

export function readActiveRun(): CursorBridgeActiveRun | undefined {
  return activeRun;
}

export function isActiveRunInFlight(): boolean {
  return activeRun !== undefined;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

function previewPrompt(prompt: string, maxLen = 120): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLen) {
    return oneLine;
  }
  return `${oneLine.slice(0, maxLen - 1)}…`;
}

export function formatActiveRunUpdate(run: CursorBridgeActiveRun, nowMs = Date.now()): string {
  const lines = [
    'Agent run in progress',
    `Prompt: ${previewPrompt(run.prompt)}`,
    `Elapsed: ${formatElapsed(nowMs - run.startedAtMs)}`,
  ];
  if (run.progressLines.length > 0) {
    lines.push('', 'Recent activity:', ...run.progressLines);
  } else {
    lines.push('', 'Recent activity: (none yet)');
  }
  return lines.join('\n');
}

export function formatIdleUpdateMessage(): string {
  return 'No Cursor agent run in progress. Send a prompt or use /status.';
}
