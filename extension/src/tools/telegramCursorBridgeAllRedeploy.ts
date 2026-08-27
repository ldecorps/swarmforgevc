// BL-710: /redeploy all — compile once and bounce every Telegram runtime.

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const DEFAULT_MINIAPP_BRIDGE_PORT = 8765;

/** Parse `/redeploy all` (case-insensitive, no extra args). */
export function parseAllRedeployCommand(text: string): boolean {
  return /^\/redeploy(?:[\s_-]+all)\s*$/i.test(text.trim());
}

export function allRedeployScriptPath(repoRoot: string): string {
  return path.join(repoRoot, 'swarmforge', 'scripts', 'redeploy_all_telegram.sh');
}

export function allRedeployLogPath(repoRoot: string): string {
  return path.join(repoRoot, '.swarmforge', 'operator', 'redeploy-all-telegram.log');
}

function allRedeployLockPath(repoRoot: string): string {
  return path.join(repoRoot, '.swarmforge', 'operator', 'redeploy-all-telegram.lock');
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function configuredBridgePort(): number {
  const raw = process.env.BRIDGE_HEADLESS_PORT;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MINIAPP_BRIDGE_PORT;
}

export function readAllRedeployLock(repoRoot: string): { pid: number } | undefined {
  const lockPath = allRedeployLockPath(repoRoot);
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

function writeAllRedeployLock(repoRoot: string, pid: number): void {
  const lockPath = allRedeployLockPath(repoRoot);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, `${JSON.stringify({ pid, startedAtMs: Date.now() }, null, 2)}\n`, 'utf8');
}

export type StartAllRedeployResult =
  | { ok: true; logPath: string; pid: number; port: number }
  | { ok: false; reason: 'already-running' | 'missing-script' | 'spawn-failed'; detail: string };

export function startAllRedeployRun(repoRoot: string, spawnFn: typeof spawn = spawn): StartAllRedeployResult {
  const existing = readAllRedeployLock(repoRoot);
  if (existing) {
    return {
      ok: false,
      reason: 'already-running',
      detail: `pid ${existing.pid}`,
    };
  }
  const script = allRedeployScriptPath(repoRoot);
  if (!fs.existsSync(script)) {
    return { ok: false, reason: 'missing-script', detail: script };
  }
  const logPath = allRedeployLogPath(repoRoot);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const outFd = fs.openSync(logPath, 'a');
  const errFd = fs.openSync(logPath, 'a');
  const port = configuredBridgePort();
  try {
    const child = spawnFn('bash', [script, repoRoot, String(port)], {
      detached: true,
      stdio: ['ignore', outFd, errFd],
    });
    child.unref();
    const pid = child.pid;
    if (pid === undefined) {
      return { ok: false, reason: 'spawn-failed', detail: 'no pid from spawn' };
    }
    writeAllRedeployLock(repoRoot, pid);
    return { ok: true, logPath, pid, port };
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }
}

export function formatAllRedeployStartMessage(result: Extract<StartAllRedeployResult, { ok: true }>): string {
  return [
    '🔄 All Telegram redeploy started (pid ' +
      `${result.pid}): compile → cursor bridge, front desk, mini app bridge (port ${result.port}).`,
    'Each runtime will reload swarm.env where applicable.',
    `Log: ${result.logPath}`,
  ].join('\n');
}

export function formatAllRedeployFailureMessage(result: Extract<StartAllRedeployResult, { ok: false }>): string {
  if (result.reason === 'already-running') {
    return `All Telegram redeploy already running (${result.detail}). Wait for it to finish.`;
  }
  if (result.reason === 'missing-script') {
    return `All Telegram redeploy script not found at ${result.detail}`;
  }
  return `Could not start all Telegram redeploy: ${result.detail}`;
}
