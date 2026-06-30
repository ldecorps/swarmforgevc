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
  options: cp.SpawnSyncOptionsWithStringEncoding = { encoding: 'utf8' }
): TmuxRunResult {
  const result = cp.spawnSync(command, args, {
    ...options,
    encoding: 'utf8',
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

export function resolveAgentPaneTarget(
  socketPath: string,
  session: string,
  paneBaseIndex: number
): string {
  const result = runCommand('tmux', [
    '-S',
    socketPath,
    'list-windows',
    '-t',
    session,
    '-F',
    '#{window_index}',
  ]);

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return `${session}:0.${paneBaseIndex}`;
  }

  const windowIndex = result.stdout.trim().split('\n')[0];
  return `${session}:${windowIndex}.${paneBaseIndex}`;
}

export function getPaneCommand(socketPath: string, target: string): string {
  const result = runCommand('tmux', [
    '-S',
    socketPath,
    'display-message',
    '-p',
    '-t',
    target,
    '#{pane_current_command}',
  ]);
  if (result.exitCode !== 0) {
    return '';
  }
  return result.stdout.trim();
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

/**
 * Raise the tmux scrollback buffer (history-limit) so tiles can show more
 * "memory". Set globally (-g) so panes created after this — e.g. on respawn —
 * inherit the larger buffer, and on already-running panes the buffer grows
 * toward the new limit as fresh output arrives.
 */
export function setHistoryLimit(socketPath: string, lines: number): TmuxRunResult {
  return runCommand('tmux', [
    '-S',
    socketPath,
    'set-option',
    '-g',
    'history-limit',
    String(lines),
  ]);
}

/**
 * Switch the tmux server to manual window sizing so resizeWindow sticks even
 * when no client is attached (headless swarm). Without this, tmux sizes windows
 * to the latest/attached client and snaps detached windows back to 80x24.
 */
export function setWindowSizeManual(socketPath: string): TmuxRunResult {
  return runCommand('tmux', [
    '-S',
    socketPath,
    'set-option',
    '-g',
    'window-size',
    'manual',
  ]);
}

/**
 * Resize a window so its pane shows more lines. Headless tmux defaults to 80x24,
 * which caps each tile at 24 lines of a full-screen TUI; a taller pane makes the
 * agent re-render (SIGWINCH) into more rows and lets capture-pane return them.
 * Requires setWindowSizeManual to have been applied.
 */
export function resizeWindow(
  socketPath: string,
  target: string,
  cols: number,
  rows: number
): TmuxRunResult {
  return runCommand('tmux', [
    '-S',
    socketPath,
    'resize-window',
    '-t',
    target,
    '-x',
    String(cols),
    '-y',
    String(rows),
  ]);
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

export interface RespawnResult {
  success: boolean;
  message: string;
}

export function respawnAgent(targetPath: string, role: string): RespawnResult {
  const launchScript = path.join(targetPath, '.swarmforge', 'launch', `${role}.sh`);
  if (!fs.existsSync(launchScript)) {
    return { success: false, message: `No launch script found for role "${role}" at ${launchScript}` };
  }
  const result = runCommand('bash', [launchScript]);
  if (result.exitCode !== 0) {
    return { success: false, message: `Failed to respawn "${role}": ${result.stderr || result.stdout || `exit ${result.exitCode}`}` };
  }
  return { success: true, message: `Agent "${role}" restarted.` };
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
