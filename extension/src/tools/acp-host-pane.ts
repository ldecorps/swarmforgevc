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
 * main() is a thin wrapper: parsing and the spawn plan are exported pure
 * helpers; every side effect arrives through injected deps.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as readline from 'readline';
import {
  AcpHostSession,
  acpSnapshotRelPath,
} from '../swarm/acpHostRuntime';
import {
  ACP_SPIKE_SEAT_AGENT,
  shouldLaunchViaAcpHost,
} from '../swarm/acpSeatLaunch';

export interface AcpHostPaneArgs {
  help: boolean;
  role: string;
  agent: string;
  workdir: string;
  promptFile: string;
  addDir?: string;
  extraCli?: string;
  firstMessage: string;
  repoRoot: string;
}

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

export function usageText(): string {
  return [
    'Usage: acp-host-pane --role <role> --agent <token> --workdir <path>',
    '                     --prompt-file <path> [--add-dir <path>]',
    '                     [--extra-cli <args>] [--repo <path>] [first-message]',
    '',
    `Hosts the spike seat (${ACP_SPIKE_SEAT_AGENT}) behind the ACP host in the`,
    'role pane: writes .swarmforge/acp/<role>.json, renders the transcript,',
    'and drives the agent CLI as a subprocess.',
  ].join('\n');
}

const KNOWN_FLAGS = new Set([
  '--role',
  '--agent',
  '--workdir',
  '--prompt-file',
  '--add-dir',
  '--extra-cli',
  '--repo',
  '--help',
  '-h',
]);

export function parseAcpHostPaneArgs(argv: string[], resolveRepoRoot: () => string): AcpHostPaneArgs {
  if (argv.includes('--help') || argv.includes('-h')) {
    return {
      help: true,
      role: '',
      agent: '',
      workdir: '',
      promptFile: '',
      firstMessage: '',
      repoRoot: resolveRepoRoot(),
    };
  }
  const values = new Map<string, string>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (KNOWN_FLAGS.has(tok)) {
      if (tok === '--help' || tok === '-h') continue;
      const value = argv[i + 1];
      if (value === undefined || KNOWN_FLAGS.has(value)) {
        throw new Error(`${tok} needs a value\n\n${usageText()}`);
      }
      values.set(tok, value);
      i++;
      continue;
    }
    positionals.push(tok);
  }
  const role = values.get('--role');
  const agent = values.get('--agent') || ACP_SPIKE_SEAT_AGENT;
  const workdir = values.get('--workdir');
  const promptFile = values.get('--prompt-file');
  if (!role || !workdir || !promptFile) {
    throw new Error(`--role, --workdir, and --prompt-file are required\n\n${usageText()}`);
  }
  if (!shouldLaunchViaAcpHost(agent)) {
    throw new Error(
      `refusing to host agent "${agent}" — this spike only hosts ${ACP_SPIKE_SEAT_AGENT}`
    );
  }
  return {
    help: false,
    role,
    agent,
    workdir,
    promptFile,
    addDir: values.get('--add-dir'),
    extraCli: values.get('--extra-cli'),
    firstMessage: positionals.join(' '),
    repoRoot: values.get('--repo') || resolveRepoRoot(),
  };
}

/** Argv for the underlying vibe CLI (ACP stdio + the same trust/workdir flags). */
export function buildAgentArgv(args: AcpHostPaneArgs): string[] {
  const argv = ['vibe', '--yolo', '--trust', '--workdir', args.workdir];
  if (args.addDir) argv.push('--add-dir', args.addDir);
  if (args.extraCli) {
    // Split on whitespace only for the spike; write_role_launch_script already
    // shell-quoted the block as a single --extra-cli value when needed.
    argv.push(...args.extraCli.split(/\s+/).filter(Boolean));
  }
  if (args.firstMessage) argv.push(args.firstMessage);
  return argv;
}

export function snapshotAbsPath(repoRoot: string, role: string): string {
  return path.join(repoRoot, acpSnapshotRelPath(role));
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
      writeSnapshot: (snapshot) => {
        deps.writeSnapshotFile(snapPath, `${JSON.stringify(snapshot, null, 2)}\n`);
      },
    },
    { role: args.role }
  );
  // Announce the seat before the agent speaks so a mid-boot babysitter tick
  // already sees acp:true rather than falling back to pane heuristics.
  deps.writeSnapshotFile(
    snapPath,
    `${JSON.stringify(session.snapshot(), null, 2)}\n`
  );

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
