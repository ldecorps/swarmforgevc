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

export function stopSwarm(targetPath: string): StopResult {
  const socketPath = readTmuxSocket(targetPath);
  if (!socketPath) {
    return {
      success: false,
      message: 'No tmux socket found — is the swarm running?',
      sessionsKilled: [],
    };
  }

  const roles = readSwarmRoles(targetPath);
  if (roles.length === 0) {
    return {
      success: false,
      message: 'No sessions found — is the swarm running?',
      sessionsKilled: [],
    };
  }

  const killed: string[] = [];
  const sessions = roles.map((r) => r.session);

  for (const args of buildKillSessionArgs(socketPath, sessions)) {
    const result = runCommand('tmux', args);
    if (result.exitCode === 0) {
      killed.push(args[args.length - 1]);
    }
  }

  const daemonPidFile = path.join(targetPath, DAEMON_PID_SUBPATH);
  if (fs.existsSync(daemonPidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(daemonPidFile, 'utf8').trim(), DECIMAL_RADIX);
      if (Number.isFinite(pid) && pid > 0) {
        process.kill(pid, 'SIGTERM');
      }
    } catch {
      // pid already gone or unreadable
    }
  }

  if (killed.length === 0) {
    return {
      success: false,
      message: 'No sessions could be stopped (already stopped?).',
      sessionsKilled: [],
    };
  }

  return {
    success: true,
    message: `Stopped ${killed.length} session(s): ${killed.join(', ')}`,
    sessionsKilled: killed,
  };
}
