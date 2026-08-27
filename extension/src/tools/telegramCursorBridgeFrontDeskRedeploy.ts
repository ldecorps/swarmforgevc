// BL-710: /redeploy frontdesk — compile extension and bounce front desk supervisor.

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

/** Parse `/redeploy frontdesk` variants (case-insensitive, no extra args). */
export function parseFrontDeskRedeployCommand(text: string): boolean {
  return /^\/redeploy(?:[\s_-]+front(?:[\s_-]*desk)?)\s*$/i.test(text.trim());
}

export function frontDeskRedeployScriptPath(repoRoot: string): string {
  return path.join(repoRoot, 'swarmforge', 'scripts', 'redeploy_front_desk.sh');
}

export function frontDeskRedeployLogPath(repoRoot: string): string {
  return path.join(repoRoot, '.swarmforge', 'operator', 'redeploy-front-desk.log');
}

function frontDeskRedeployLockPath(repoRoot: string): string {
  return path.join(repoRoot, '.swarmforge', 'operator', 'redeploy-front-desk.lock');
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readFrontDeskRedeployLock(repoRoot: string): { pid: number } | undefined {
  const lockPath = frontDeskRedeployLockPath(repoRoot);
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

function writeFrontDeskRedeployLock(repoRoot: string, pid: number): void {
  const lockPath = frontDeskRedeployLockPath(repoRoot);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, `${JSON.stringify({ pid, startedAtMs: Date.now() }, null, 2)}\n`, 'utf8');
}

export type StartFrontDeskRedeployResult =
  | { ok: true; logPath: string; pid: number }
  | { ok: false; reason: 'already-running' | 'missing-script' | 'spawn-failed'; detail: string };

export function startFrontDeskRedeployRun(
  repoRoot: string,
  spawnFn: typeof spawn = spawn
): StartFrontDeskRedeployResult {
  const existing = readFrontDeskRedeployLock(repoRoot);
  if (existing) {
    return {
      ok: false,
      reason: 'already-running',
      detail: `pid ${existing.pid}`,
    };
  }
  const script = frontDeskRedeployScriptPath(repoRoot);
  if (!fs.existsSync(script)) {
    return { ok: false, reason: 'missing-script', detail: script };
  }
  const logPath = frontDeskRedeployLogPath(repoRoot);
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
    writeFrontDeskRedeployLock(repoRoot, pid);
    return { ok: true, logPath, pid };
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }
}

export function formatFrontDeskRedeployStartMessage(
  result: Extract<StartFrontDeskRedeployResult, { ok: true }>
): string {
  return [
    '🔄 Front desk redeploy started (pid ' +
      `${result.pid}): compile → stop → restart the front desk (bridge + bot).`,
    'The front desk will reload swarm.env on restart.',
    `Log: ${result.logPath}`,
  ].join('\n');
}

export function formatFrontDeskRedeployFailureMessage(
  result: Extract<StartFrontDeskRedeployResult, { ok: false }>
): string {
  if (result.reason === 'already-running') {
    return `Front desk redeploy already running (${result.detail}). Wait for it to finish.`;
  }
  if (result.reason === 'missing-script') {
    return `Front desk redeploy script not found at ${result.detail}`;
  }
  return `Could not start front desk redeploy: ${result.detail}`;
}
