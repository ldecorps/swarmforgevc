import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface TmuxRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SwarmRole {
  index: number;
  role: string;
  session: string;
  displayName: string;
  agent: string;
}

export function runCommand(
  command: string,
  args: string[],
  options: cp.SpawnSyncOptionsWithStringEncoding = {}
): TmuxRunResult {
  const result = cp.spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });

  return {
    stdout: (result.stdout ?? '').trimEnd(),
    stderr: (result.stderr ?? '').trimEnd(),
    exitCode: result.status ?? 1,
  };
}

export function readTmuxSocket(targetPath: string): string | undefined {
  const socketFile = path.join(targetPath, '.swarmforge', 'tmux-socket');
  if (!fs.existsSync(socketFile)) {
    return undefined;
  }
  return fs.readFileSync(socketFile, 'utf8').trim();
}

export function listTmuxSessions(socketPath?: string): TmuxRunResult {
  const args = socketPath ? ['-S', socketPath, 'list-sessions'] : ['list-sessions'];
  return runCommand('tmux', args);
}

export function getPaneBaseIndex(socketPath: string): number {
  const result = runCommand('tmux', [
    '-S',
    socketPath,
    'show-window-options',
    '-gv',
    'pane-base-index',
  ]);
  const value = parseInt(result.stdout, 10);
  return Number.isFinite(value) ? value : 0;
}

export function paneTarget(
  session: string,
  windowName: string,
  paneBaseIndex: number
): string {
  return `${session}:${windowName}.${paneBaseIndex}`;
}

export function capturePane(
  socketPath: string,
  target: string,
  startLine?: number
): TmuxRunResult {
  const args = ['-S', socketPath, 'capture-pane', '-p', '-e', '-t', target];
  if (startLine !== undefined) {
    args.push('-S', String(startLine));
  }
  return runCommand('tmux', args);
}

export function sendKeys(
  socketPath: string,
  target: string,
  keys: string,
  literal = false
): TmuxRunResult {
  const args = ['-S', socketPath, 'send-keys', '-t', target];
  if (literal) {
    args.push('-l', '--', keys);
  } else {
    args.push(keys);
  }
  return runCommand('tmux', args);
}

export function readSwarmRoles(targetPath: string): SwarmRole[] {
  const sessionsFile = path.join(targetPath, '.swarmforge', 'sessions.tsv');
  if (!fs.existsSync(sessionsFile)) {
    return [];
  }

  const lines = fs.readFileSync(sessionsFile, 'utf8').split('\n');
  const roles: SwarmRole[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const [indexStr, role, session, displayName, agent] = line.split('\t');
    if (!role || !session || !displayName) {
      continue;
    }
    roles.push({
      index: parseInt(indexStr, 10) || roles.length + 1,
      role,
      session,
      displayName,
      agent: agent ?? 'unknown',
    });
  }

  return roles;
}

export function sessionExists(socketPath: string, session: string): boolean {
  const result = runCommand('tmux', [
    '-S',
    socketPath,
    'has-session',
    '-t',
    session,
  ]);
  return result.exitCode === 0;
}
