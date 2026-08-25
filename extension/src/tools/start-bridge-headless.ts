#!/usr/bin/env node
/**
 * BL-292: thin CLI that starts the bridge HEADLESS (no VS Code host) - wraps
 * startBridge exactly the way extension.ts's own swarmforge.startBridge
 * command does (same runLogPath, same bare-string-token double-duty as
 * both read/control credential - see bridgeServer.ts's normalizeToRegistry),
 * on a caller-chosen FIXED port instead of that command's OS-ephemeral
 * default, so the Front Desk Bot (a separate process) can find it at a
 * known address. The token is provisioned by the LAUNCHER (never generated
 * or written into the repo here) and given to this process via env, the
 * same posture as every other secret in this codebase (RESEND_API_KEY etc).
 *
 * Usage: node start-bridge-headless.js <target-path> <port>
 * Env: BRIDGE_TOKEN (required)
 */
import * as os from 'os';
import * as path from 'path';
import { startBridge } from '../bridge/bridgeServer';
import { runCliMain } from './swarm-metrics';

export function parseCliArgs(argv: string[]): { targetPath: string; port: number } | null {
  const [targetPath, portArg] = argv;
  if (!targetPath || !portArg) {
    return null;
  }
  const port = Number(portArg);
  if (!Number.isInteger(port) || port <= 0) {
    return null;
  }
  return { targetPath, port };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set in the environment`);
  }
  return value;
}

// Same path extension.ts's own module-level runLogPath resolves to - one
// shared run-history file across every target on this machine, not
// per-target.
export function runLogPath(): string {
  return path.join(os.homedir(), '.swarmforge', 'runs.jsonl');
}

export async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write('Usage: start-bridge-headless.js <target-path> <port>\n');
    process.exitCode = 1;
    return;
  }
  const token = requiredEnv('BRIDGE_TOKEN');
  const handle = await startBridge(args.targetPath, runLogPath(), token, { port: args.port });
  // The launcher's own pid-wait-loop (mirroring start_handoff_daemon.sh's
  // "wait for the child to claim its pid file" convention) has nothing to
  // poll for a Node child beyond its own liveness, but printing the bound
  // port confirms startBridge actually resolved to the requested one
  // (a mismatch here would mean the port was already taken).
  process.stdout.write(`BRIDGE_LISTENING port=${handle.port}\n`);
}

if (require.main === module) {
  runCliMain(main);
}
