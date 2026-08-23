#!/usr/bin/env node
/**
 * BL-1081: the ACP host as a pane process.
 *
 * write_role_launch_script names this compiled file as the vibe seat's
 * pane command. Without this entry point the host library is a dark
 * module — compiled, tested, and reachable from nothing (QA bounce D1 /
 * BL-149). The host:
 *
 *   1. writes the structured seat snapshot the babysitter reads;
 *   2. spawns the agent CLI as an ACP subprocess;
 *   3. renders every non-protocol line and every rendered event into the
 *      pane (invariant 2 — the transcript stays human-readable).
 *
 * main() is a thin wrapper: parsing and the spawn plan live in
 * acpHostPaneArgs; every side effect arrives through injected deps.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as readline from 'readline';
import { AcpHostSession } from '../swarm/acpHostRuntime';
import { parseAcpHostPaneArgs, usageText, type AcpHostPaneArgs } from '../swarm/acpHostPaneArgs';
import {
  buildAgentArgv,
  formatSnapshotBody,
  snapshotAbsPath,
} from '../swarm/acpHostPanePlan';

export type { AcpHostPaneArgs } from '../swarm/acpHostPaneArgs';
export { parseAcpHostPaneArgs, usageText } from '../swarm/acpHostPaneArgs';
export { buildAgentArgv, snapshotAbsPath } from '../swarm/acpHostPanePlan';

export interface SpawnedAgent {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: 'close', listener: (code: number | null) => void): void;
}

export interface AcpHostPaneDeps {
  writeLine: (line: string) => void;
  writeSnapshotFile: (absPath: string, body: string) => void;
  spawnAgent: (argv: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => SpawnedAgent;
  resolveRepoRoot: () => string;
}

function writeSeatSnapshot(
  deps: AcpHostPaneDeps,
  snapPath: string,
  snapshot: unknown
): void {
  deps.writeSnapshotFile(snapPath, formatSnapshotBody(snapshot));
}

export async function runAcpHostPane(args: AcpHostPaneArgs, deps: AcpHostPaneDeps): Promise<number> {
  if (args.help) {
    deps.writeLine(usageText());
    return 0;
  }
  const snapPath = snapshotAbsPath(args.repoRoot, args.role);
  fs.mkdirSync(path.dirname(snapPath), { recursive: true });

  const session = new AcpHostSession(
    {
      writeLine: deps.writeLine,
      writeSnapshot: (snapshot) => writeSeatSnapshot(deps, snapPath, snapshot),
    },
    { role: args.role }
  );
  // Announce the seat before the agent speaks so a mid-boot babysitter tick
  // already sees acp:true rather than falling back to pane heuristics.
  writeSeatSnapshot(deps, snapPath, session.snapshot());

  const child = deps.spawnAgent(buildAgentArgv(args), {
    cwd: args.workdir,
    env: { ...process.env, ACP: '1' },
  });

  const rlOut = readline.createInterface({ input: child.stdout });
  const rlErr = readline.createInterface({ input: child.stderr });
  rlOut.on('line', (line) => session.ingest(line));
  rlErr.on('line', (line) => session.ingest(line));

  return await new Promise((resolve) => {
    child.on('error', (err) => {
      deps.writeLine(`[acp-host] failed to spawn agent: ${err.message}`);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 0));
  });
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const deps: AcpHostPaneDeps = {
    writeLine: (line) => {
      process.stdout.write(`${line}\n`);
    },
    writeSnapshotFile: (absPath, body) => {
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, body, 'utf8');
    },
    spawnAgent: (agentArgv, opts) => {
      const [cmd, ...rest] = agentArgv;
      return spawn(cmd, rest, {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    },
    resolveRepoRoot: () => process.cwd(),
  };
  try {
    const args = parseAcpHostPaneArgs(argv, deps.resolveRepoRoot);
    return await runAcpHostPane(args, deps);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    return 64;
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}
