// pipeline smoke test BL-029
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SecretStorage } from 'vscode';
import {
  listTmuxSessions,
  readSwarmRoles,
  readTmuxSocket,
  sessionExists,
} from './tmuxClient';
import { stopSwarm } from './swarmStopper';
import { spawnTrackedJob } from './childJobRegistry';

export interface LaunchResult {
  success: boolean;
  message: string;
  targetPath: string;
}

const SWARM_LAUNCH_SUCCESS_MESSAGE = 'Swarm launched successfully.';

// BL-058: launch failures used to surface only as ephemeral toasts, so a
// failed launch left nothing to diagnose. Every attempt persists the spawned
// ./swarm output and outcome here, overwritten per attempt.
const LAUNCH_LOG_SUBPATH = path.join('.swarmforge', 'last-launch.log');

interface LaunchAttemptRecord {
  runName?: string;
  swarmScript: string;
  configPath?: string;
  success: boolean;
  message: string;
  stdout: string;
  stderr: string;
}

function persistLaunchLog(targetPath: string, record: LaunchAttemptRecord): void {
  try {
    fs.mkdirSync(path.join(targetPath, '.swarmforge'), { recursive: true });
    fs.writeFileSync(
      path.join(targetPath, LAUNCH_LOG_SUBPATH),
      [
        `SwarmForge launch attempt ${new Date().toISOString()}`,
        `script: ${record.swarmScript}`,
        `runName: ${record.runName ?? '(none)'}`,
        `config: ${record.configPath ?? '(default)'}`,
        `success: ${record.success}`,
        `message: ${record.message}`,
        '--- stdout ---',
        record.stdout,
        '--- stderr ---',
        record.stderr,
        '',
      ].join('\n')
    );
  } catch {
    // diagnostics only; never let logging break a launch
  }
}

export function isSwarmReady(targetPath: string): boolean {
  const socket = readTmuxSocket(targetPath);
  if (!socket) {
    return false;
  }

  if (listTmuxSessions(socket).exitCode !== 0) {
    return false;
  }

  const roles = readSwarmRoles(targetPath);
  if (roles.length === 0) {
    return false;
  }

  return roles.every((role) => sessionExists(socket, role.session));
}

// Dirs where tmux, bb (babashka), claude, and aider are commonly installed.
// A Dock/Finder-launched VS Code inherits a minimal PATH without these, so the
// spawned ./swarm cannot find its tools and the launch silently fails.
const COMMON_TOOL_PATHS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  path.join(os.homedir(), '.local', 'bin'),
];

function pythonUserBinDirs(): string[] {
  const base = path.join(os.homedir(), 'Library', 'Python');
  try {
    return fs
      .readdirSync(base)
      .map((version) => path.join(base, version, 'bin'))
      .filter((dir) => fs.existsSync(dir));
  } catch {
    return [];
  }
}

// BL-116: probedDirs (from the user's login shell, see below) are merged in
// ahead of the hardcoded common-tool list, which stays as the fallback -
// this parameter defaults to [] so every existing call site/test is
// unaffected until something actually supplies a probe result.
export function augmentPath(currentPath: string | undefined, probedDirs: string[] = []): string {
  const toolPaths = [...probedDirs, ...COMMON_TOOL_PATHS, ...pythonUserBinDirs()];
  const existing = (currentPath ?? '').split(':').filter((p) => p.length > 0);
  const missing = toolPaths.filter((dir) => !existing.includes(dir));
  return [...missing, ...existing].join(':');
}

// BL-116: COMMON_TOOL_PATHS above hardcodes macOS dirs (Homebrew, ~/.local/bin
// covers some Linux cases but not linuxbrew or a custom shell profile's own
// PATH exports). A desktop-launched VS Code inherits a minimal PATH
// regardless of platform, so the spawned ./swarm can't find tmux/bb/claude.
// Probing the user's actual LOGIN shell ($SHELL -lc 'echo $PATH') is the
// portable fix: whatever the user's own shell profile puts on PATH is
// exactly what a terminal-launched swarm would see.
const LOGIN_SHELL_PROBE_TIMEOUT_MS = 1500;

export function parseLoginShellPathOutput(stdout: string): string[] {
  return stdout
    .trim()
    .split(':')
    .filter((p) => p.length > 0);
}

// Thin adapter boundary (constitution testability rule): the only piece
// that touches a real subprocess/timer. probeLoginShellPath below is the
// testable logic layer, built on an injected runFn.
function spawnAndCaptureShellOutput(
  shell: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { code: number | null; stdout: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    let child: cp.ChildProcess;
    try {
      child = cp.spawn(shell, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      finish({ code: null, stdout: '' });
      return;
    }

    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, stdout: '' });
    }, timeoutMs);

    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ code, stdout });
    });
    child.on('error', () => {
      clearTimeout(timer);
      finish({ code: null, stdout: '' });
    });
  });
}

export type ShellRunFn = (
  shell: string,
  args: string[],
  timeoutMs: number
) => Promise<{ code: number | null; stdout: string }>;

// BL-116 path-probe-01/02: runs the login-shell probe and parses its PATH,
// or returns [] (never throws) on any failure/timeout - callers merge an
// empty probe result in as a no-op, falling back to the existing hardcoded
// list exactly as augmentPath already did before this ticket.
export async function probeLoginShellPath(
  shell: string,
  timeoutMs: number = LOGIN_SHELL_PROBE_TIMEOUT_MS,
  runFn: ShellRunFn = spawnAndCaptureShellOutput
): Promise<string[]> {
  const { code, stdout } = await runFn(shell, ['-lc', 'echo $PATH'], timeoutMs);
  if (code !== 0) {
    return [];
  }
  return parseLoginShellPathOutput(stdout);
}

let cachedProbePromise: Promise<string[]> | null = null;
let cachedProbeResult: string[] = [];

// BL-116 path-probe-01: the probe runs at MOST once per activation - a
// second call while one is already in flight (or after one has completed)
// returns the same cached promise/result rather than spawning another
// shell. resetLoginShellPathCacheForTests exists only for test isolation
// between cases.
export function resetLoginShellPathCacheForTests(): void {
  cachedProbePromise = null;
  cachedProbeResult = [];
}

export function getCachedLoginShellPathDirs(
  shell: string = process.env.SHELL ?? '/bin/sh',
  timeoutMs: number = LOGIN_SHELL_PROBE_TIMEOUT_MS,
  runFn?: ShellRunFn
): Promise<string[]> {
  if (cachedProbePromise === null) {
    cachedProbePromise = probeLoginShellPath(shell, timeoutMs, runFn).then((dirs) => {
      cachedProbeResult = dirs;
      return dirs;
    });
  }
  return cachedProbePromise;
}

// BL-116: kicks off the (at-most-once, cached) probe in the background and
// never awaits it - callers must not block activation or a launch on a
// login shell that might be slow or hung. augmentPath/buildLaunchEnv stay
// synchronous and simply read whatever has resolved so far
// (readCachedLoginShellPathDirsSync, below): [] until the probe completes,
// the real probed dirs once it does. A launch that races ahead of the
// probe still works exactly as it did before this ticket (falls back to
// the hardcoded list); one that starts after the probe resolves benefits
// from it.
export function primeLoginShellPathProbe(): void {
  void getCachedLoginShellPathDirs();
}

export function readCachedLoginShellPathDirsSync(): string[] {
  return cachedProbeResult;
}

export function resolveSwarmConfigPath(): string | undefined {
  const fromEnv = process.env['SWARMFORGE_CONFIG'];
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return fromEnv.trim();
  }

  try {
    // Lazy load: unit tests run outside the extension host.
    const vscode = require('vscode') as typeof import('vscode');
    const fromSettings = vscode.workspace
      .getConfiguration('swarmforge')
      .get<string>('configPath');
    if (fromSettings !== undefined && fromSettings.trim() !== '') {
      return fromSettings.trim();
    }
  } catch {
    // vscode unavailable outside the extension host
  }

  return undefined;
}

/** Count `window` lines in a swarmforge pack/profile config file. */
export function countRolesInConfig(configPath: string): number {
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    return content.split('\n').filter((line) => line.trimStart().startsWith('window ')).length;
  } catch {
    return 0;
  }
}

/** True when roles.tsv matches the configured pack/profile role count. */
export function runningSwarmMatchesConfig(targetPath: string, configPath?: string): boolean {
  const resolved = configPath?.trim() || resolveSwarmConfigPath();
  if (!resolved) {
    return true;
  }
  const expected = countRolesInConfig(resolved);
  if (expected === 0) {
    return true;
  }
  const roles = readSwarmRoles(targetPath);
  if (roles.length === 0) {
    return false;
  }
  return roles.length === expected;
}

export function buildLaunchEnv(runName?: string, configPath?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SWARMFORGE_TERMINAL: 'none',
    PATH: augmentPath(process.env.PATH, readCachedLoginShellPathDirsSync()),
  };

  if (runName) {
    env['SWARM_RUN_NAME'] = `swarm/${runName}`;
  } else {
    delete env['SWARM_RUN_NAME'];
  }

  // BL-154 phase 1: handoff via tmux injection only unless explicitly disabled.
  if (process.env['SWARMFORGE_SKIP_DAEMON'] !== undefined) {
    env['SWARMFORGE_SKIP_DAEMON'] = process.env['SWARMFORGE_SKIP_DAEMON'];
  }

  const resolvedConfig = configPath ?? resolveSwarmConfigPath();
  if (resolvedConfig !== undefined) {
    env['SWARMFORGE_CONFIG'] = resolvedConfig;
  } else {
    delete env['SWARMFORGE_CONFIG'];
  }

  if (process.env['SWARMFORGE_MAILBOX_ONLY'] !== undefined) {
    env['SWARMFORGE_MAILBOX_ONLY'] = process.env['SWARMFORGE_MAILBOX_ONLY'];
  }

  return env;
}

/** BL-130: forward provider API keys to ./swarm without writing them to disk. */
export async function enrichLaunchEnvWithProviderKeys(
  env: NodeJS.ProcessEnv,
  secrets?: SecretStorage
): Promise<NodeJS.ProcessEnv> {
  const { resolveMistralApiKey, resolveOpenAIApiKey } = await import('../notify/secrets');
  const mistralKey = await resolveMistralApiKey(secrets);
  if (mistralKey) {
    env['MISTRAL_API_KEY'] = mistralKey;
  }
  const openaiKey = await resolveOpenAIApiKey(secrets);
  if (openaiKey) {
    env['OPENAI_API_KEY'] = openaiKey;
  }
  return env;
}

export async function launchSwarm(
  targetPath: string,
  runName?: string,
  readyTimeoutMs = 120_000,
  secrets?: SecretStorage
): Promise<LaunchResult> {
  const swarmScript = path.join(targetPath, 'swarm');
  if (!fs.existsSync(swarmScript)) {
    const message = `No ./swarm wrapper found at ${swarmScript}`;
    persistLaunchLog(targetPath, {
      runName,
      swarmScript,
      success: false,
      message,
      stdout: '',
      stderr: '',
    });
    return { success: false, message, targetPath };
  }

  const configPath = resolveSwarmConfigPath();

  // Explicit cold launch: always tear down a live or stale swarm first so
  // readiness polling cannot report success against a previous pack (e.g.
  // three-role resilience-min while seven-pack is configured).
  stopSwarm(targetPath);

  const launchEnv = await enrichLaunchEnvWithProviderKeys(
    buildLaunchEnv(runName, configPath),
    secrets
  );

  return new Promise((resolve) => {
    // BL-108 spawn-registry-01: detached:true makes child.pid the new
    // process GROUP's leader, so a registry entry keyed on it can reap the
    // whole tree (this bootstrap child plus anything it forks) even if the
    // extension host is killed before it can await this child's own exit.
    const child = spawnTrackedJob(
      path.join(targetPath, '.swarmforge'),
      () =>
        cp.spawn(swarmScript, [targetPath], {
          cwd: targetPath,
          env: launchEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        }),
      { worktree: targetPath, kind: 'swarm-launch', ownerHostPid: process.pid }
    );

    let settled = false;
    let stderr = '';
    let stdout = '';

    const cleanup = () => {
      clearTimeout(deadline);
      clearInterval(poll);
    };

    const finish = (success: boolean, message: string) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      persistLaunchLog(targetPath, {
        runName,
        swarmScript,
        configPath,
        success,
        message,
        stdout,
        stderr,
      });
      resolve({ success, message, targetPath });
    };

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (
        stdout.includes('SwarmForge is ready') &&
        isSwarmReady(targetPath)
      ) {
        finish(true, SWARM_LAUNCH_SUCCESS_MESSAGE);
      }
    });

    child.on('error', (err) => {
      finish(false, `Failed to start swarm: ${err.message}`);
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }
      if (isSwarmReady(targetPath)) {
        finish(true, SWARM_LAUNCH_SUCCESS_MESSAGE);
        return;
      }
      finish(
        false,
        `Swarm launch failed: ${stderr || stdout || `exit code ${code ?? 'unknown'}`}`
      );
    });

    const deadline = setTimeout(() => {
      if (isSwarmReady(targetPath)) {
        finish(true, SWARM_LAUNCH_SUCCESS_MESSAGE);
      } else {
        finish(false, 'Timed out waiting for swarm to become ready.');
      }
    }, readyTimeoutMs);

    const poll = setInterval(() => {
      if (isSwarmReady(targetPath)) {
        finish(true, SWARM_LAUNCH_SUCCESS_MESSAGE);
      }
    }, 500);
  });
}

// BL-084: a socket already on disk at activation means a swarm is mid
// cold-start (bringing up N tmux sessions, each spawning a fresh `claude`),
// which can take far longer than the transient-flake budget BL-080 used for
// an already-up swarm. No socket at all means there is no swarm to wait for,
// so activation should keep falling through to the resume prompt quickly.
export function chooseReattachTimeoutMs(
  swarmSocketPresent: boolean,
  coldStartTimeoutMs: number,
  fastTimeoutMs: number
): number {
  return swarmSocketPresent ? coldStartTimeoutMs : fastTimeoutMs;
}

// BL-131: getNowMs/scheduleTick default to the real clock/setTimeout, so
// every existing production call site is byte-for-byte unaffected; tests
// inject a fake clock + a tick-capturing scheduler (same pattern as
// briefingScheduler.ts/chaserMonitor.ts) to drive the poll loop
// synchronously instead of waiting on the real clock.
export function waitForSwarmReady(
  targetPath: string,
  timeoutMs = 120_000,
  pollMs = 500,
  getNowMs: () => number = Date.now,
  scheduleTick: (fn: () => void, ms: number) => void = (fn, ms) => {
    setTimeout(fn, ms);
  }
): Promise<boolean> {
  if (isSwarmReady(targetPath)) {
    return Promise.resolve(true);
  }

  const deadline = getNowMs() + timeoutMs;

  return new Promise((resolve) => {
    const check = () => {
      if (isSwarmReady(targetPath)) {
        resolve(true);
        return;
      }
      if (getNowMs() >= deadline) {
        resolve(false);
        return;
      }
      scheduleTick(check, pollMs);
    };
    check();
  });
}
