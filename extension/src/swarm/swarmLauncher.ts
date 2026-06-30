import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  listTmuxSessions,
  readSwarmRoles,
  readTmuxSocket,
  sessionExists,
} from './tmuxClient';

export interface LaunchResult {
  success: boolean;
  message: string;
  targetPath: string;
}

const SWARM_LAUNCH_SUCCESS_MESSAGE = 'Swarm launched successfully.';

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

export function buildLaunchEnv(runName?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SWARMFORGE_TERMINAL: 'none',
  };

  if (runName) {
    env['SWARM_RUN_NAME'] = `swarm/${runName}`;
  } else {
    delete env['SWARM_RUN_NAME'];
  }

  return env;
}

export async function launchSwarm(targetPath: string, runName?: string): Promise<LaunchResult> {
  const swarmScript = path.join(targetPath, 'swarm');
  if (!fs.existsSync(swarmScript)) {
    return {
      success: false,
      message: `No ./swarm wrapper found at ${swarmScript}`,
      targetPath,
    };
  }

  return new Promise((resolve) => {
    const child = cp.spawn(swarmScript, [targetPath], {
      cwd: targetPath,
      env: buildLaunchEnv(runName),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

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
    }, 120_000);

    const poll = setInterval(() => {
      if (isSwarmReady(targetPath)) {
        finish(true, SWARM_LAUNCH_SUCCESS_MESSAGE);
      }
    }, 500);
  });
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
