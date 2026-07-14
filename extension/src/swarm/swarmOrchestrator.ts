import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { isSwarmReady } from './swarmLauncher';

export interface LaunchResult {
  success: boolean;
  message: string;
  skipDaemon?: boolean;
  agentStarted?: boolean;
  daemonStarted?: boolean;
}

export interface ActivationContext {
  tmuxReady: boolean;
  daemonReady: boolean;
  configMatches: boolean;
  autoLaunch: boolean;
  skipDaemon: boolean;
  hasPriorRun: boolean;
  isStartupTriggered: boolean;
}

export type ActivationPath =
  | 'reattach'
  | 'reattach-after-daemon'
  | 'cold-launch'
  | 'offer-resume'
  | 'idle';

export function shouldSkipHandoffDaemon(env: NodeJS.ProcessEnv): boolean {
  if (env['SWARMFORGE_SKIP_DAEMON'] === '1') {
    return true;
  }
  if (env['SWARMFORGE_MAILBOX_ONLY'] === '1') {
    return true;
  }
  return false;
}

export function daemonHealthCheck(targetPath: string): boolean {
  const pidFile = path.join(targetPath, '.swarmforge', 'daemon', 'handoffd.pid');
  if (!fs.existsSync(pidFile)) {
    return false;
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      return false;
    }
    // Check if process exists by sending signal 0
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function decideActivationPath(context: ActivationContext): ActivationPath {
  const { tmuxReady, daemonReady, configMatches, autoLaunch, skipDaemon, hasPriorRun, isStartupTriggered } = context;

  // Config mismatch: always cold-launch to get the right pack
  if (configMatches === false) {
    return 'cold-launch';
  }

  // Tmux not ready at all
  if (!tmuxReady) {
    if (autoLaunch) {
      return 'cold-launch';
    }
    if (isStartupTriggered) {
      return 'idle';
    }
    if (hasPriorRun) {
      return 'offer-resume';
    }
    return 'idle';
  }

  // Tmux ready: check daemon
  if (skipDaemon || daemonReady) {
    return 'reattach';
  }

  // Tmux ready but daemon down (daemon required)
  return 'reattach-after-daemon';
}

// A killed shell script's own forked/exec'd commands (e.g. a `sleep` inside
// `#!/bin/sh\nsleep 10`) are grandchildren proc.kill() alone never reaches -
// the shell dies but the grandchild is reparented and keeps running. Node's
// 'close' event (unlike 'exit') waits for the shared stdio pipe to actually
// EOF, which the orphaned grandchild's still-open inherited fd blocks until
// it finishes for real - so a "timed out" launch would previously still
// block spawnAndCapture's promise for the grandchild's full real duration
// (BL-131 QA bounce finding). detached:true (below) makes the direct child
// the leader of its own process group, so killing the negative pid signals
// the whole group - shell and any of its own children - at once.
function killProcessTree(proc: cp.ChildProcess): void {
  if (proc.pid) {
    try {
      process.kill(-proc.pid, 'SIGTERM');
      return;
    } catch {
      // Process group kill failed (e.g. already exited) - fall through.
    }
  }
  proc.kill();
}

async function spawnAndCapture(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const proc = cp.spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    const timeout = options.timeout ? setTimeout(() => killProcessTree(proc), options.timeout) : null;

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve({ exitCode: code, stdout, stderr });
    });

    proc.on('error', (err) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve({ exitCode: 1, stdout, stderr: err.message });
    });
  });
}

export async function startSwarmAgents(
  targetPath: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 120_000
): Promise<LaunchResult> {
  const swarmScript = path.join(targetPath, 'swarm');
  if (!fs.existsSync(swarmScript)) {
    return {
      success: false,
      message: `No ./swarm script found at ${swarmScript}`,
      agentStarted: false,
    };
  }

  const launchEnv = {
    ...process.env,
    ...env,
    SWARMFORGE_TERMINAL: 'none',
  };

  const result = await spawnAndCapture(swarmScript, [targetPath], {
    cwd: targetPath,
    env: launchEnv,
    timeout: timeoutMs,
  });

  if (result.exitCode === 0 && isSwarmReady(targetPath)) {
    return {
      success: true,
      message: 'SwarmForge agents launched successfully.',
      agentStarted: true,
    };
  }

  return {
    success: false,
    message: `Agents failed to start: ${result.stderr || result.stdout || `exit code ${result.exitCode}`}`,
    agentStarted: false,
  };
}

export async function startHandoffDaemon(
  targetPath: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 30_000
): Promise<LaunchResult> {
  if (shouldSkipHandoffDaemon(env)) {
    return {
      success: true,
      message: 'Skipping handoff daemon (flag set).',
      daemonStarted: false,
    };
  }

  // Look for start_handoff_daemon.sh in common locations
  const possibleScripts = [
    path.join(targetPath, 'swarmforge', 'scripts', 'start_handoff_daemon.sh'),
    path.join(targetPath, '..', 'swarmforge', 'scripts', 'start_handoff_daemon.sh'),
  ];

  let scriptPath = '';
  for (const candidate of possibleScripts) {
    if (fs.existsSync(candidate)) {
      scriptPath = candidate;
      break;
    }
  }

  if (!scriptPath) {
    return {
      success: false,
      message: 'start_handoff_daemon.sh script not found in expected locations',
      daemonStarted: false,
    };
  }

  const daemonDir = path.join(targetPath, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });

  const launchEnv = {
    ...process.env,
    ...env,
    SWARMFORGE_DAEMON_START_CALLER: 'extension',
  };

  const result = await spawnAndCapture('bash', [scriptPath, targetPath], {
    cwd: targetPath,
    env: launchEnv,
    timeout: timeoutMs,
  });

  if (result.exitCode === 0 && daemonHealthCheck(targetPath)) {
    return {
      success: true,
      message: 'Handoff daemon started successfully.',
      daemonStarted: true,
    };
  }

  return {
    success: false,
    message: `Daemon failed to start: ${result.stderr || result.stdout || `exit code ${result.exitCode}`}`,
    daemonStarted: false,
  };
}

export async function waitForAllReady(
  targetPath: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 120_000,
  isReady: (tp: string) => boolean = isSwarmReady
): Promise<boolean> {
  const skipDaemon = shouldSkipHandoffDaemon(env);
  const deadline = Date.now() + timeoutMs;

  const check = (): Promise<boolean> => {
    if (!isReady(targetPath)) {
      return Promise.resolve(false);
    }

    if (!skipDaemon && !daemonHealthCheck(targetPath)) {
      return Promise.resolve(false);
    }

    return Promise.resolve(true);
  };

  const poll = async (): Promise<boolean> => {
    if (Date.now() >= deadline) {
      return false;
    }

    const ready = await check();
    if (ready) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    return poll();
  };

  return poll();
}

export async function orchestrateFullLaunch(
  targetPath: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 120_000
): Promise<LaunchResult> {
  if (!fs.existsSync(targetPath)) {
    return {
      success: false,
      message: `Target path does not exist: ${targetPath}`,
    };
  }

  const skipDaemon = shouldSkipHandoffDaemon(env);

  // Phase 1: Start agents (creates tmux sessions)
  const agentsResult = await startSwarmAgents(targetPath, env, timeoutMs);
  if (!agentsResult.success) {
    return {
      ...agentsResult,
      skipDaemon,
    };
  }

  // Phase 2: Start daemon (after agents exist to receive handoffs)
  let daemonResult: LaunchResult;
  if (skipDaemon) {
    daemonResult = {
      success: true,
      message: 'Daemon skipped.',
      daemonStarted: false,
    };
  } else {
    daemonResult = await startHandoffDaemon(targetPath, env, timeoutMs);
    // Daemon failure is non-fatal if agents are running; log but continue
    if (!daemonResult.success) {
      console.warn(`Warning: ${daemonResult.message}`);
    }
  }

  // Phase 3: Verify everything is ready
  const ready = await waitForAllReady(targetPath, env, timeoutMs);
  if (!ready) {
    return {
      success: false,
      message: 'Swarm did not become ready within timeout.',
      skipDaemon,
      agentStarted: agentsResult.agentStarted,
      daemonStarted: daemonResult.daemonStarted,
    };
  }

  return {
    success: true,
    message: 'SwarmForge launched and ready.',
    skipDaemon,
    agentStarted: agentsResult.agentStarted,
    daemonStarted: daemonResult.daemonStarted,
  };
}
