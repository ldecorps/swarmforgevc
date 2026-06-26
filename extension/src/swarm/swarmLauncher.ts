import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { readSwarmRoles, readTmuxSocket } from './tmuxClient';

export interface LaunchResult {
  success: boolean;
  message: string;
  targetPath: string;
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

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      const socket = readTmuxSocket(targetPath);
      const roles = readSwarmRoles(targetPath);

      if (code === 0 && socket && roles.length > 0) {
        resolve({
          success: true,
          message: `Swarm launched with ${roles.length} agent(s).`,
          targetPath,
        });
        return;
      }

      const detail = stderr || stdout || `exit code ${code ?? 'unknown'}`;
      resolve({
        success: false,
        message: `Swarm launch failed: ${detail}`,
        targetPath,
      });
    });

    child.on('error', (err) => {
      resolve({
        success: false,
        message: `Failed to start swarm: ${err.message}`,
        targetPath,
      });
    });
  });
}

export function waitForSwarmReady(
  targetPath: string,
  timeoutMs = 120_000,
  pollMs = 500
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve) => {
    const check = () => {
      const socket = readTmuxSocket(targetPath);
      const roles = readSwarmRoles(targetPath);
      if (socket && roles.length > 0) {
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
