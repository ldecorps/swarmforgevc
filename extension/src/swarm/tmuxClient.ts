import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { sendInstructionVerified, VerifiedInjectResult } from './verifiedInject';

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

// runCommand is synchronous and runs on the extension host's only JS thread:
// a child that never exits wedges the entire extension (tiles, webview
// messages, every timer). All callers are sub-second tmux commands, so a
// bounded default timeout turns any hang into a failed result instead.
export const DEFAULT_RUN_COMMAND_TIMEOUT_MS = 10_000;

// BL-104: split out of runCommand (complexity 8 -> under threshold). Pure
// and unit-tested directly, independent of an actual spawnSync call.
export function isTimedOut(error: NodeJS.ErrnoException | undefined): boolean {
  return error !== undefined && error.code === 'ETIMEDOUT';
}

// BL-104: split out of runCommand alongside isTimedOut. Shapes a raw
// spawnSync-like result into the TmuxRunResult the rest of the codebase
// depends on (timeout stderr message, exit-code fallback).
export function shapeRunResult(
  raw: { error?: NodeJS.ErrnoException; stdout: string | null; stderr: string | null; status: number | null },
  command: string,
  timeoutMs: number
): TmuxRunResult {
  const timedOut = isTimedOut(raw.error);
  const stderr = (raw.stderr ?? '').trimEnd();

  return {
    stdout: (raw.stdout ?? '').trimEnd(),
    stderr: timedOut
      ? [stderr, `${command} timed out after ${timeoutMs}ms`].filter(Boolean).join('\n')
      : stderr,
    exitCode: timedOut ? 1 : raw.status ?? 1,
  };
}

export function runCommand(
  command: string,
  args: string[],
  options: cp.SpawnSyncOptionsWithStringEncoding = { encoding: 'utf8' }
): TmuxRunResult {
  const result = cp.spawnSync(command, args, {
    timeout: DEFAULT_RUN_COMMAND_TIMEOUT_MS,
    ...options,
    encoding: 'utf8',
  });

  return shapeRunResult(result, command, options.timeout ?? DEFAULT_RUN_COMMAND_TIMEOUT_MS);
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

// BL-104: split out of readSwarmRoles (complexity 9 -> under threshold).
// Pure and unit-tested directly, independent of the file-reading loop.
export function hasRequiredRoleFields(role?: string, session?: string, displayName?: string): boolean {
  return Boolean(role) && Boolean(session) && Boolean(displayName);
}

// BL-104: split out alongside hasRequiredRoleFields — parses one
// sessions.tsv line into a SwarmRole, or undefined for a blank/malformed
// line. fallbackIndex mirrors the original's `roles.length + 1` (computed
// by the caller before the push, since a skipped line never increments it).
export function parseRoleLine(line: string, fallbackIndex: number): SwarmRole | undefined {
  if (!line.trim()) {
    return undefined;
  }
  const [indexStr, role, session, displayName, agent] = line.split('\t');
  if (!hasRequiredRoleFields(role, session, displayName)) {
    return undefined;
  }
  return {
    index: parseInt(indexStr, 10) || fallbackIndex,
    role,
    session,
    displayName,
    agent: agent ?? 'unknown',
  };
}

export function readSwarmRoles(targetPath: string): SwarmRole[] {
  const sessionsFile = path.join(targetPath, '.swarmforge', 'sessions.tsv');
  if (!fs.existsSync(sessionsFile)) {
    return [];
  }

  const lines = fs.readFileSync(sessionsFile, 'utf8').split('\n');
  const roles: SwarmRole[] = [];

  for (const line of lines) {
    const parsed = parseRoleLine(line, roles.length + 1);
    if (parsed) {
      roles.push(parsed);
    }
  }

  return roles;
}

export interface RespawnResult {
  success: boolean;
  message: string;
}

// Synchronous backoff wait for the retry loop below. The extension host is
// single-threaded and blocking here is deliberate and bounded (a few hundred
// ms, only on a verification retry) - the same tradeoff runCommand already
// makes with its blocking spawnSync calls.
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Kills whatever is running in the pane and relaunches the role's launch
 * script directly in place, bypassing send-keys entirely. This is the only
 * recovery that works on a WEDGED TUI (process alive, all input ignored):
 * send-keys types into a dead input box and can never submit there.
 */
export function respawnPaneForced(
  socketPath: string,
  target: string,
  launchScript: string
): TmuxRunResult {
  return runCommand('tmux', [
    '-S',
    socketPath,
    'respawn-pane',
    '-k',
    '-t',
    target,
    `bash ${launchScript}`,
  ]);
}

export function respawnAgent(targetPath: string, role: string): RespawnResult {
  const launchScript = path.join(targetPath, '.swarmforge', 'launch', `${role}.sh`);
  if (!fs.existsSync(launchScript)) {
    return { success: false, message: `No launch script found for role "${role}" at ${launchScript}` };
  }

  const socketPath = readTmuxSocket(targetPath);
  if (!socketPath) {
    return { success: false, message: `Cannot respawn "${role}": no tmux socket recorded (is the swarm running?)` };
  }

  const roleEntry = readSwarmRoles(targetPath).find((entry) => entry.role === role);
  if (!roleEntry) {
    return { success: false, message: `Cannot respawn "${role}": role not found in sessions.tsv` };
  }

  // The launch script runs `claude` in the foreground and only exits when the
  // agent does. It must run INSIDE the role's tmux pane — executing it here
  // would block the extension host's single JS thread until the agent exits,
  // freezing the whole extension, and leave the agent outside tmux where no
  // tile can see it.
  const target = resolveAgentPaneTarget(socketPath, roleEntry.session, getPaneBaseIndex(socketPath));
  return performVerifiedRespawn(socketPath, target, launchScript, role);
}

// BL-093: split out of respawnAgent (CRAP) - type-and-verify first (works
// for the common case: an idle/dead shell pane waiting to reattach). Only
// escalate to a forced pane kill+relaunch when verification exhausts its
// retries - i.e. the pane is a WEDGED live TUI that send-keys cannot reach -
// never on a healthy pane (a healthy pane confirms delivery on the first
// attempt).
function performVerifiedRespawn(socketPath: string, target: string, launchScript: string, role: string): RespawnResult {
  const command = `bash ${launchScript}`;
  let typeFailure: TmuxRunResult | undefined;

  const result = sendInstructionVerified(
    {
      capturePane: () => {
        const captured = capturePane(socketPath, target);
        return captured.exitCode === 0 ? captured.stdout : '';
      },
      sendLiteral: (text: string) => {
        const typed = sendKeys(socketPath, target, text, true);
        if (typed.exitCode !== 0) {
          typeFailure = typed;
          return false;
        }
        return true;
      },
      sendEnter: () => {
        sendKeys(socketPath, target, 'Enter');
      },
      wait: sleepSync,
    },
    command
  );

  if (typeFailure) {
    return { success: false, message: `Failed to respawn "${role}": ${typeFailure.stderr || typeFailure.stdout || `exit ${typeFailure.exitCode}`}` };
  }

  if (result.status === 'delivered') {
    return { success: true, message: `Agent "${role}" restarted in pane ${target}.` };
  }

  return escalateToForcedRespawn(socketPath, target, launchScript, role, result);
}

function escalateToForcedRespawn(
  socketPath: string,
  target: string,
  launchScript: string,
  role: string,
  result: VerifiedInjectResult
): RespawnResult {
  const forced = respawnPaneForced(socketPath, target, launchScript);
  if (forced.exitCode !== 0) {
    return {
      success: false,
      message: `Failed to respawn "${role}": send-keys did not submit (${result.reason}), and forced pane respawn also failed: ${forced.stderr || forced.stdout || `exit ${forced.exitCode}`}`,
    };
  }
  return {
    success: true,
    message: `Agent "${role}" was wedged (send-keys did not submit); forced a pane respawn in ${target}.`,
  };
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
