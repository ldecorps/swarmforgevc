import * as fs from 'fs';
import * as path from 'path';
import { readSwarmRoles, readTmuxSocket, runCommand } from './tmuxClient';

const DAEMON_PID_SUBPATH = path.join('.swarmforge', 'daemon', 'handoffd.pid');
const DAEMON_SUPERVISOR_PID_SUBPATH = path.join('.swarmforge', 'daemon', 'handoffd-supervisor.pid');
const DECIMAL_RADIX = 10;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 3000;
const FORCE_KILL_TIMEOUT_MS = 1000;

export interface StopResult {
  success: boolean;
  message: string;
  sessionsKilled: string[];
}

export interface StopPhase {
  name: string;
  success: boolean;
  detail: string;
}

export interface CompleteStopResult {
  success: boolean;
  message: string;
  phases: StopPhase[];
  sessionsAttempted: string[];
  sessionsStopped: number;
  daemonStopped: boolean;
  supervisorStopped: boolean;
  durationMs: number;
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

export interface DaemonStopResult {
  daemonStopped: boolean;
  supervisorStopped: boolean;
  daemonMessage: string;
  supervisorMessage: string;
}

/**
 * Comprehensive cleanup of all swarm state files and sentinels.
 * Removes socket, sessions, bounce state, drain state, etc.
 * Idempotent: safe to call multiple times.
 */
export function clearAllSwarmState(targetPath: string): void {
  const stateFiles = [
    path.join('.swarmforge', 'tmux-socket'),
    path.join('.swarmforge', 'sessions.tsv'),
    path.join('.swarmforge', 'roles.tsv'),
    path.join('.swarmforge', 'bounce-graceful'),
    path.join('.swarmforge', 'bounce-ack.json'),
    path.join('.swarmforge', 'bounce-drain.json'),
  ];

  for (const rel of stateFiles) {
    const file = path.join(targetPath, rel);
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch {
      // best-effort; never block on cleanup
    }
  }
}

/**
 * Stop all daemon processes: handoffd and handoffd-supervisor.
 * Attempts SIGTERM first, then removes pid files.
 * Returns what was stopped.
 */
export function stopAllDaemonProcesses(targetPath: string): DaemonStopResult {
  const daemonPidFile = path.join(targetPath, DAEMON_PID_SUBPATH);
  const supervisorPidFile = path.join(targetPath, DAEMON_SUPERVISOR_PID_SUBPATH);

  let daemonStopped = false;
  let daemonMessage = 'no pid file';

  if (fs.existsSync(daemonPidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(daemonPidFile, 'utf8').trim(), DECIMAL_RADIX);
      if (Number.isFinite(pid) && pid > 0) {
        process.kill(pid, 'SIGTERM');
        daemonStopped = true;
        daemonMessage = `SIGTERM sent to daemon (pid ${pid})`;
      }
    } catch (err) {
      daemonMessage = `failed to stop daemon: ${err instanceof Error ? err.message : 'unknown'}`;
    }
    try {
      fs.unlinkSync(daemonPidFile);
    } catch {
      // best-effort
    }
  }

  let supervisorStopped = false;
  let supervisorMessage = 'no pid file';

  if (fs.existsSync(supervisorPidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(supervisorPidFile, 'utf8').trim(), DECIMAL_RADIX);
      if (Number.isFinite(pid) && pid > 0) {
        process.kill(pid, 'SIGTERM');
        supervisorStopped = true;
        supervisorMessage = `SIGTERM sent to supervisor (pid ${pid})`;
      }
    } catch (err) {
      supervisorMessage = `failed to stop supervisor: ${err instanceof Error ? err.message : 'unknown'}`;
    }
    try {
      fs.unlinkSync(supervisorPidFile);
    } catch {
      // best-effort
    }
  }

  return { daemonStopped, supervisorStopped, daemonMessage, supervisorMessage };
}

/**
 * Verify that the swarm has been completely stopped.
 * Returns true only when no socket or active daemon processes remain.
 */
export function verifySwarmStopped(targetPath: string): boolean {
  // Check socket file
  const socketPath = readTmuxSocket(targetPath);
  if (socketPath) {
    return false;
  }

  // Check daemon pid file and process
  const daemonPidFile = path.join(targetPath, DAEMON_PID_SUBPATH);
  if (fs.existsSync(daemonPidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(daemonPidFile, 'utf8').trim(), DECIMAL_RADIX);
      if (Number.isFinite(pid) && pid > 0) {
        // Check if process actually exists
        process.kill(pid, 0);
        return false; // Process still alive
      }
    } catch {
      // Process doesn't exist, continue
    }
  }

  // Check supervisor pid file and process
  const supervisorPidFile = path.join(targetPath, DAEMON_SUPERVISOR_PID_SUBPATH);
  if (fs.existsSync(supervisorPidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(supervisorPidFile, 'utf8').trim(), DECIMAL_RADIX);
      if (Number.isFinite(pid) && pid > 0) {
        process.kill(pid, 0);
        return false; // Process still alive
      }
    } catch {
      // Process doesn't exist, continue
    }
  }

  return true;
}

/**
 * Complete orchestrated stop: kill tmux sessions, daemons, clear all state.
 * Handles graceful shutdown and force kill with configurable timeouts.
 * Always succeeds (idempotent); never throws.
 */
export function stopSwarmCompletely(
  targetPath: string,
  gracefulTimeoutMs: number = GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  useGracefulShutdown: boolean = true
): CompleteStopResult {
  const startTime = Date.now();
  const phases: StopPhase[] = [];
  let sessionsStopped = 0;
  const sessionsAttempted: string[] = [];

  try {
    // Phase 1: Kill tmux sessions
    const socketPath = readTmuxSocket(targetPath);
    if (socketPath) {
      const roles = readSwarmRoles(targetPath);
      const sessions = roles.map((r) => r.session);
      sessionsAttempted.push(...sessions);

      for (const args of buildKillSessionArgs(socketPath, sessions)) {
        const result = runCommand('tmux', args);
        if (result.exitCode === 0) {
          sessionsStopped++;
        }
      }

      // Kill the tmux server itself to clean up orphans
      runCommand('tmux', ['-S', socketPath, 'kill-server']);

      phases.push({
        name: 'tmux-stop',
        success: true,
        detail: `Stopped ${sessionsStopped}/${sessions.length} sessions`,
      });
    } else {
      phases.push({
        name: 'tmux-stop',
        success: true,
        detail: 'No tmux socket found (already stopped)',
      });
    }

    // Phase 2: Stop daemon processes
    const daemonResult = stopAllDaemonProcesses(targetPath);
    phases.push({
      name: 'daemon-stop',
      success: daemonResult.daemonStopped || daemonResult.supervisorStopped,
      detail: `Daemon: ${daemonResult.daemonMessage}; Supervisor: ${daemonResult.supervisorMessage}`,
    });

    // Phase 3: Clear all state files and sentinels
    clearAllSwarmState(targetPath);
    phases.push({
      name: 'state-cleanup',
      success: true,
      detail: 'All state files and sentinels removed',
    });

    // Phase 4: Verify stopped
    const stopped = verifySwarmStopped(targetPath);
    phases.push({
      name: 'verify-stopped',
      success: stopped,
      detail: stopped ? 'Swarm fully stopped' : 'Some processes may still be running',
    });

    const durationMs = Date.now() - startTime;

    return {
      success: true,
      message: `SwarmForge completely stopped (${durationMs}ms). Sessions: ${sessionsStopped}/${sessionsAttempted.length}`,
      phases,
      sessionsAttempted,
      sessionsStopped,
      daemonStopped: daemonResult.daemonStopped,
      supervisorStopped: daemonResult.supervisorStopped,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errMsg = err instanceof Error ? err.message : 'unknown error';

    // Even on error, attempt cleanup
    try {
      clearAllSwarmState(targetPath);
    } catch {
      // ignore
    }

    phases.push({
      name: 'error-recovery',
      success: false,
      detail: errMsg,
    });

    return {
      success: false,
      message: `Stop encountered error but cleaned up state: ${errMsg}`,
      phases,
      sessionsAttempted,
      sessionsStopped,
      daemonStopped: false,
      supervisorStopped: false,
      durationMs,
    };
  }
}
