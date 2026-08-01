// BL-696: /redeploy skill — compile extension and restart the cursor bridge.

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

/** Parse `/redeploy` or `/r` (case-insensitive, no args). */
export function parseRedeployCommand(text: string): boolean {
  return /^\/(?:redeploy|r)\s*$/i.test(text.trim());
}

export function redeployScriptPath(repoRoot: string): string {
  return path.join(repoRoot, 'swarmforge', 'scripts', 'redeploy_cursor_bridge.sh');
}

export function redeployLogPath(repoRoot: string): string {
  return path.join(repoRoot, '.swarmforge', 'operator', 'redeploy-cursor-bridge.log');
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readRedeployLock(repoRoot: string): { pid: number } | undefined {
  const lockPath = path.join(repoRoot, '.swarmforge', 'operator', 'redeploy-bridge.lock');
  if (!fs.existsSync(lockPath)) {
    return undefined;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { pid?: number };
    if (typeof raw.pid !== 'number') {
      return undefined;
    }
    if (!isPidAlive(raw.pid)) {
      fs.unlinkSync(lockPath);
      return undefined;
    }
    return { pid: raw.pid };
  } catch {
    return undefined;
  }
}

function writeRedeployLock(repoRoot: string, pid: number): void {
  const lockPath = path.join(repoRoot, '.swarmforge', 'operator', 'redeploy-bridge.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, `${JSON.stringify({ pid, startedAtMs: Date.now() }, null, 2)}\n`, 'utf8');
}

export type StartRedeployResult =
  | { ok: true; logPath: string; pid: number }
  | { ok: false; reason: 'already-running' | 'missing-script' | 'spawn-failed'; detail: string };

export function startRedeployRun(repoRoot: string, spawnFn: typeof spawn = spawn): StartRedeployResult {
  const existing = readRedeployLock(repoRoot);
  if (existing) {
    return {
      ok: false,
      reason: 'already-running',
      detail: `pid ${existing.pid}`,
    };
  }
  const script = redeployScriptPath(repoRoot);
  if (!fs.existsSync(script)) {
    return { ok: false, reason: 'missing-script', detail: script };
  }
  const logPath = redeployLogPath(repoRoot);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const outFd = fs.openSync(logPath, 'a');
  const errFd = fs.openSync(logPath, 'a');
  try {
    const child = spawnFn('bash', [script, repoRoot], {
      detached: true,
      stdio: ['ignore', outFd, errFd],
    });
    child.unref();
    const pid = child.pid;
    if (pid === undefined) {
      return { ok: false, reason: 'spawn-failed', detail: 'no pid from spawn' };
    }
    writeRedeployLock(repoRoot, pid);
    return { ok: true, logPath, pid };
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }
}

export function formatRedeployStartMessage(result: Extract<StartRedeployResult, { ok: true }>): string {
  return [
    `🔄 Redeploy started (pid ${result.pid}): compile → stop → restart.`,
    'This bridge will restart shortly; send /status once it is back.',
    `Log: ${result.logPath}`,
  ].join('\n');
}

export function formatRedeployFailureMessage(result: Extract<StartRedeployResult, { ok: false }>): string {
  if (result.reason === 'already-running') {
    return `Redeploy already running (${result.detail}). Wait for it to finish.`;
  }
  if (result.reason === 'missing-script') {
    return `Redeploy script not found at ${result.detail}`;
  }
  return `Could not start redeploy: ${result.detail}`;
}
