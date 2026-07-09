import * as fs from 'fs';
import * as path from 'path';
import { readSwarmRoles, readTmuxSocket, runCommand } from './tmuxClient';

const DAEMON_PID_SUBPATH = path.join('.swarmforge', 'daemon', 'handoffd.pid');
const DECIMAL_RADIX = 10;

export interface StopResult {
  success: boolean;
  message: string;
  sessionsKilled: string[];
}

export function buildKillSessionArgs(socketPath: string, sessions: string[]): string[][] {
  return sessions.map((session) => ['-S', socketPath, 'kill-session', '-t', session]);
}

/**
 * Remove the swarm's state marker files so a stale previous run can never
 * satisfy isSwarmReady for a new launch. Safe to call when files are absent.
 */
export function clearSwarmStateFiles(targetPath: string): void {
  for (const rel of [
    path.join('.swarmforge', 'tmux-socket'),
    path.join('.swarmforge', 'sessions.tsv'),
  ]) {
    const file = path.join(targetPath, rel);
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch {
      // best-effort cleanup; never block stop/launch on it
    }
  }
}

/**
 * Best-effort teardown of a swarm that is not (fully) alive: kill whatever
 * tmux server answers on the recorded socket, then remove the state marker
 * files. Used before a fresh launch so readiness can only be satisfied by
 * the NEW run's state.
 */
export function clearStaleSwarmState(targetPath: string): void {
  const socketPath = readTmuxSocket(targetPath);
  if (socketPath) {
    runCommand('tmux', ['-S', socketPath, 'kill-server']);
  }
  clearSwarmStateFiles(targetPath);
}

function stopHandoffDaemon(targetPath: string): void {
  const daemonPidFile = path.join(targetPath, DAEMON_PID_SUBPATH);
  if (!fs.existsSync(daemonPidFile)) {
    return;
  }
  try {
    const pid = parseInt(fs.readFileSync(daemonPidFile, 'utf8').trim(), DECIMAL_RADIX);
    if (Number.isFinite(pid) && pid > 0) {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    // pid already gone or unreadable
  }
}

/**
 * Idempotent stop: stopping an already-stopped (or crashed) swarm is a
 * success, and always leaves the state files cleared so the next launch
 * starts from a clean slate.
 */
export function stopSwarm(targetPath: string): StopResult {
  const socketPath = readTmuxSocket(targetPath);
  if (!socketPath) {
    clearSwarmStateFiles(targetPath);
    stopHandoffDaemon(targetPath);
    return {
      success: true,
      message: 'Swarm already stopped (no tmux socket); state cleared.',
      sessionsKilled: [],
    };
  }

  const roles = readSwarmRoles(targetPath);
  const killed: string[] = [];
  const sessions = roles.map((r) => r.session);

  for (const args of buildKillSessionArgs(socketPath, sessions)) {
    const result = runCommand('tmux', args);
    if (result.exitCode === 0) {
      killed.push(args[args.length - 1]);
    }
  }

  // Kill the server itself so orphan sessions (e.g. from a run whose
  // sessions.tsv went stale) cannot survive into the next launch.
  runCommand('tmux', ['-S', socketPath, 'kill-server']);

  stopHandoffDaemon(targetPath);
  clearSwarmStateFiles(targetPath);

  if (killed.length === 0) {
    return {
      success: true,
      message: 'No live sessions found (already stopped); stale swarm state cleared.',
      sessionsKilled: [],
    };
  }

  return {
    success: true,
    message: `Stopped ${killed.length} session(s): ${killed.join(', ')}`,
    sessionsKilled: killed,
  };
}

/**
 * Best-effort swarm teardown when the extension host stops. Idempotent and
 * never throws — a partially torn-down swarm must not block deactivate().
 */
export function stopSwarmOnExtensionShutdown(
  targetPath: string | null | undefined
): StopResult | null {
  if (!targetPath) {
    return null;
  }
  try {
    return stopSwarm(targetPath);
  } catch {
    return null;
  }
}
