// BL-696: /redeploy miniapp skill — compile extension and bounce headless mini app bridge.

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const DEFAULT_MINIAPP_BRIDGE_PORT = 8765;

/** Parse `/redeploy miniapp` variants (case-insensitive, no extra args). */
export function parseMiniAppRedeployCommand(text: string): boolean {
  return /^\/redeploy(?:[\s_-]+mini(?:[\s_-]*app)?)\s*$/i.test(text.trim());
}

export function miniAppRedeployScriptPath(repoRoot: string): string {
  return path.join(repoRoot, 'swarmforge', 'scripts', 'bounce_bridge_headless.sh');
}

export function miniAppRedeployLogPath(repoRoot: string): string {
  return path.join(repoRoot, '.swarmforge', 'operator', 'redeploy-miniapp.log');
}

function miniAppRedeployLockPath(repoRoot: string): string {
  return path.join(repoRoot, '.swarmforge', 'operator', 'redeploy-miniapp.lock');
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

export function readMiniAppRedeployLock(repoRoot: string): { pid: number } | undefined {
  const lockPath = miniAppRedeployLockPath(repoRoot);
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

function writeMiniAppRedeployLock(repoRoot: string, pid: number): void {
  const lockPath = miniAppRedeployLockPath(repoRoot);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, `${JSON.stringify({ pid, startedAtMs: Date.now() }, null, 2)}\n`, 'utf8');
}

export type StartMiniAppRedeployResult =
  | { ok: true; logPath: string; pid: number; port: number }
  | { ok: false; reason: 'already-running' | 'missing-script' | 'spawn-failed'; detail: string };

export function startMiniAppRedeployRun(
  repoRoot: string,
  spawnFn: typeof spawn = spawn
): StartMiniAppRedeployResult {
  const existing = readMiniAppRedeployLock(repoRoot);
  if (existing) {
    return {
      ok: false,
      reason: 'already-running',
      detail: `pid ${existing.pid}`,
    };
  }
  const script = miniAppRedeployScriptPath(repoRoot);
  if (!fs.existsSync(script)) {
    return { ok: false, reason: 'missing-script', detail: script };
  }
  const logPath = miniAppRedeployLogPath(repoRoot);
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
    writeMiniAppRedeployLock(repoRoot, pid);
    return { ok: true, logPath, pid, port };
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }
}

export function formatMiniAppRedeployStartMessage(result: Extract<StartMiniAppRedeployResult, { ok: true }>): string {
  return [
    `🔄 Mini app redeploy started (pid ${result.pid}) on port ${result.port}: compile → stop → start → /lets-talk health probe.`,
    'The bridge will restart briefly; refresh the mini app in a moment.',
    `Log: ${result.logPath}`,
  ].join('\n');
}

export function formatMiniAppRedeployFailureMessage(result: Extract<StartMiniAppRedeployResult, { ok: false }>): string {
  if (result.reason === 'already-running') {
    return `Mini app redeploy already running (${result.detail}). Wait for it to finish.`;
  }
  if (result.reason === 'missing-script') {
    return `Mini app redeploy script not found at ${result.detail}`;
  }
  return `Could not start mini app redeploy: ${result.detail}`;
}
