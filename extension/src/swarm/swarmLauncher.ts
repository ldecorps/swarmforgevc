import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { readSwarmRoles, readTmuxSocket } from './tmuxClient';

export interface LaunchResult {
  success: boolean;
  message: string;
  targetPath: string;
}

function isSwarmReady(targetPath: string): boolean {
  const socket = readTmuxSocket(targetPath);
  const roles = readSwarmRoles(targetPath);
  return Boolean(socket && roles.length > 0);
}

export async function launchSwarm(targetPath: string): Promise<LaunchResult> {
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
      env: {
        ...process.env,
        SWARMFORGE_TERMINAL: 'none',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    let stderr = '';

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
      if (child.pid && !child.killed) {
        child.kill('SIGTERM');
      }
      resolve({ success, message, targetPath });
    };

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('SwarmForge is ready') && isSwarmReady(targetPath)) {
        finish(true, 'Swarm launched successfully.');
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
        finish(true, 'Swarm launched successfully.');
        return;
      }
      finish(
        false,
        `Swarm launch failed: ${stderr || `exit code ${code ?? 'unknown'}`}`
      );
    });

    const deadline = setTimeout(() => {
      if (isSwarmReady(targetPath)) {
        finish(true, 'Swarm launched successfully.');
      } else {
        finish(false, 'Timed out waiting for swarm to become ready.');
      }
    }, 120_000);

    const poll = setInterval(() => {
      if (isSwarmReady(targetPath)) {
        finish(true, 'Swarm launched successfully.');
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
