import * as fs from 'fs';
import * as path from 'path';
import { isDaemonReady } from './daemonHealth';
import { runCommand } from './tmuxClient';

export interface DaemonStartResult {
  success: boolean;
  message: string;
}

const AUDIT_LOG = 'extension-daemon-audit.log';

function appendAudit(targetPath: string, line: string): void {
  try {
    const file = path.join(targetPath, '.swarmforge', 'daemon', AUDIT_LOG);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // diagnostics only
  }
}

export interface WaitForHandoffDaemonOptions {
  maxAttempts?: number;
  isDaemonReadyFn?: (targetPath: string) => boolean;
  sleepMs?: number;
}

/**
 * Poll until handoffd is ready. Injectable probes keep tests timer-free.
 */
export async function waitForHandoffDaemon(
  targetPath: string,
  options: WaitForHandoffDaemonOptions = {}
): Promise<boolean> {
  const maxAttempts = options.maxAttempts ?? 40;
  const readyFn = options.isDaemonReadyFn ?? ((tp: string) => isDaemonReady(tp));
  const sleepMs = options.sleepMs ?? 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (readyFn(targetPath)) {
      appendAudit(targetPath, `waitForHandoffDaemon ready attempt=${attempt}`);
      return true;
    }
    if (sleepMs > 0 && attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }
  }

  appendAudit(targetPath, `waitForHandoffDaemon timeout attempts=${maxAttempts}`);
  return false;
}

/**
 * Ordered handoffd + supervisor startup delegated to the shell script that
 * owns the BL-081 pid-file race and BL-144 halt recovery semantics.
 */
export function startHandoffDaemon(targetPath: string, caller = 'extension'): DaemonStartResult {
  appendAudit(targetPath, `startHandoffDaemon caller=${caller} begin`);

  const script = path.join(targetPath, 'swarmforge', 'scripts', 'start_handoff_daemon.sh');
  if (!fs.existsSync(script)) {
    const message = `No start_handoff_daemon.sh found at ${script}`;
    appendAudit(targetPath, `startHandoffDaemon FAILED ${message}`);
    return { success: false, message };
  }

  const result = runCommand('bash', [script, targetPath], {
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_DAEMON_START_CALLER: caller },
  });

  const message =
    result.exitCode === 0
      ? result.stdout.trim() || 'Handoff daemon started.'
      : result.stderr || result.stdout || `start_handoff_daemon.sh exited ${result.exitCode}`;

  appendAudit(
    targetPath,
    `startHandoffDaemon caller=${caller} exit=${result.exitCode} message=${message.replace(/\s+/g, ' ').slice(0, 200)}`
  );

  if (result.exitCode !== 0) {
    return { success: false, message };
  }

  return { success: true, message };
}
