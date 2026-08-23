/**
 * BL-1081: pure argv helpers for the ACP pane host.
 *
 * Kept separate from the process-entry CLI so mutation and review stay on
 * the planning surface (no spawn, no fs, no readline). Spawn argv and
 * snapshot path helpers live in acpHostPanePlan.ts.
 */

import { ACP_SPIKE_SEAT_AGENT, shouldLaunchViaAcpHost } from './acpSeatLaunch';

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

function emptyHelpArgs(resolveRepoRoot: () => string): AcpHostPaneArgs {
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

function collectFlagValues(argv: string[]): { values: Map<string, string>; positionals: string[] } {
  const values = new Map<string, string>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!KNOWN_FLAGS.has(tok)) {
      positionals.push(tok);
      continue;
    }
    if (tok === '--help' || tok === '-h') continue;
    const value = argv[i + 1];
    if (value === undefined || KNOWN_FLAGS.has(value)) {
      throw new Error(`${tok} needs a value\n\n${usageText()}`);
    }
    values.set(tok, value);
    i++;
  }
  return { values, positionals };
}

export function parseAcpHostPaneArgs(argv: string[], resolveRepoRoot: () => string): AcpHostPaneArgs {
  if (argv.includes('--help') || argv.includes('-h')) {
    return emptyHelpArgs(resolveRepoRoot);
  }
  const { values, positionals } = collectFlagValues(argv);
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
