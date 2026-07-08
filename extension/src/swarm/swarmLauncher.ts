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

export function augmentPath(currentPath: string | undefined): string {
  const toolPaths = [...COMMON_TOOL_PATHS, ...pythonUserBinDirs()];
  const existing = (currentPath ?? '').split(':').filter((p) => p.length > 0);
  const missing = toolPaths.filter((dir) => !existing.includes(dir));
  return [...missing, ...existing].join(':');
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

export function buildLaunchEnv(runName?: string, configPath?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SWARMFORGE_TERMINAL: 'none',
    PATH: augmentPath(process.env.PATH),
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

export function waitForSwarmReady(
  targetPath: string,
  timeoutMs = 120_000,
  pollMs = 500
): Promise<boolean> {
  if (isSwarmReady(targetPath)) {
    return Promise.resolve(true);
  }

  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve) => {
    const check = () => {
      if (isSwarmReady(targetPath)) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(check, pollMs);
    };
    check();
  });
}
