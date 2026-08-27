#!/usr/bin/env node
/**
 * BL-713 (slice A of BL-712): the Cursor seat spike CLI.
 *
 * Slice A's ONLY live caller of the seat driver. Without it the driver would
 * be a dark module — compiled, tested, and reachable from nothing (the BL-419
 * shape the ticket's required_wiring names). BL-712 slice B replaces this
 * entry point with the real launcher path; until then this is how a human
 * drives one Cursor-staffed seat through one real parcel.
 *
 *   node out/tools/cursor-seat-spike.js --role documenter
 *
 * main() is a thin wrapper (engineering.prompt): argument parsing, report
 * formatting and exit-code selection are exported pure helpers, and every
 * side effect arrives through the injected deps factory — no *_FORCE_RESULT
 * env bypass, no process.chdir().
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { PIPELINE_CHAIN } from '../swarm/rolePack';
import {
  CURSOR_SEAT_SPIKE_ESCAPE_ENV,
  CURSOR_SEAT_SPIKE_ESCAPE_VALUE,
  MODEL_STEWARD_REGISTRY_RELATIVE_PATH,
  roleWorktreePath,
  runSeatOnce,
  type CursorIdentity,
  type HelperName,
  type SeatDeps,
  type SeatRunOptions,
  type SeatRunOutcome,
} from '../swarm/cursorSeatDriver';
import {
  openLiveCursorSeatSession,
  readHeadShortCommit,
  sendTaskToLiveSession,
  type LiveSeatSession,
} from '../swarm/cursorSeatSession';

// The two helpers a seat may ever invoke. Anything else is a private side
// channel by definition, so the lookup refuses rather than composing a path.
const HELPER_SCRIPTS: Record<HelperName, string> = {
  ready_for_next: 'ready_for_next.sh',
  swarm_handoff: 'swarm_handoff.sh',
};

const DEFAULT_PRIORITY = '50';
const DEFAULT_IDENTITY: CursorIdentity = { provider: 'cursor', model: 'auto' };
// The `cursor` agent token lands with the launcher in BL-712 slice B; until
// then the prompt bundle is composed under an already-registered agent, and
// the report says so rather than letting an unknown token silently fall
// through to the claude default.
const DEFAULT_COMPOSE_AGENT = 'claude';

export interface CursorSeatSpikeArgs {
  help: boolean;
  role: string;
  repoRoot: string;
  identity: CursorIdentity;
  agent: string;
  priority: string;
}

export function usageText(): string {
  return [
    'Usage: cursor-seat-spike --role <role> [--repo <path>] [--model <id>]',
    '                        [--provider <name>] [--agent <token>] [--priority <nn>]',
    '',
    'Drives ONE role seat over a Cursor agent session through ONE parcel:',
    'boot with the role prompt bundle, run ready_for_next.sh, do the stage',
    'work, forward through swarm_handoff.sh.',
    '',
    `Roles: ${PIPELINE_CHAIN.join(', ')}`,
    '',
    'A Cursor identity that is not certified in the model steward registry is',
    'refused for a production pack. To run the spike with an uncertified',
    `candidate, set ${CURSOR_SEAT_SPIKE_ESCAPE_ENV}=${CURSOR_SEAT_SPIKE_ESCAPE_VALUE}.`,
    '',
    'Exit codes: 0 forwarded or empty mailbox, 1 aborted, 2 refused, 64 bad arguments.',
  ].join('\n');
}

const KNOWN_FLAGS = new Set(['--role', '--repo', '--model', '--provider', '--agent', '--priority']);

function parseFlagValues(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!KNOWN_FLAGS.has(flag)) {
      throw new Error(`unknown argument "${flag}"\n\n${usageText()}`);
    }
    const value = argv[i + 1];
    if (value === undefined || KNOWN_FLAGS.has(value)) {
      throw new Error(`${flag} needs a value\n\n${usageText()}`);
    }
    values.set(flag, value);
    i++;
  }
  return values;
}

function resolveRole(values: Map<string, string>): string {
  const role = values.get('--role');
  if (!role) {
    throw new Error(`--role is required\n\n${usageText()}`);
  }
  if (!PIPELINE_CHAIN.includes(role)) {
    throw new Error(`--role "${role}" is not a pipeline role (${PIPELINE_CHAIN.join(', ')})`);
  }
  return role;
}

function buildParsedArgs(role: string, values: Map<string, string>, cwd: string): CursorSeatSpikeArgs {
  return {
    help: false,
    role,
    repoRoot: values.get('--repo') ?? cwd,
    identity: {
      provider: values.get('--provider') ?? DEFAULT_IDENTITY.provider,
      model: values.get('--model') ?? DEFAULT_IDENTITY.model,
    },
    agent: values.get('--agent') ?? DEFAULT_COMPOSE_AGENT,
    priority: values.get('--priority') ?? DEFAULT_PRIORITY,
  };
}

export function parseCursorSeatSpikeArgs(argv: string[], cwd: string): CursorSeatSpikeArgs {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true, role: '', repoRoot: cwd, identity: DEFAULT_IDENTITY, agent: DEFAULT_COMPOSE_AGENT, priority: DEFAULT_PRIORITY };
  }
  const values = parseFlagValues(argv);
  const role = resolveRole(values);
  return buildParsedArgs(role, values, cwd);
}

export function seatHelperPath(worktree: string, helper: string): string {
  const script = HELPER_SCRIPTS[helper as HelperName];
  if (!script) {
    throw new Error(`"${helper}" is not a helper a seat may invoke (${Object.keys(HELPER_SCRIPTS).join(', ')})`);
  }
  return path.join(worktree, 'swarmforge', 'scripts', script);
}

export function readModelStewardRegistry(repoRoot: string): { models?: Record<string, { status?: string }> } | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, MODEL_STEWARD_REGISTRY_RELATIVE_PATH), 'utf8'));
  } catch {
    return undefined;
  }
}

export function formatSeatRunReport(outcome: SeatRunOutcome): string {
  const lines = [
    `cursor seat spike: ${outcome.outcome}`,
    `  role:      ${outcome.role}`,
    `  posture:   ${outcome.posture}`,
    `  reason:    ${outcome.reason}`,
  ];
  if (outcome.forwardedTo) {
    lines.push(`  forwarded: ${outcome.forwardedTo}`);
  }
  if (outcome.transcriptPath) {
    lines.push(`  transcript: ${outcome.transcriptPath}`);
  }
  for (const decision of outcome.decisions) {
    lines.push(`  decision:  ${decision.step} <- ${decision.fromSignal} (${decision.reason})`);
  }
  return lines.join('\n');
}

export function exitCodeForOutcome(outcome: { outcome: string }): number {
  if (outcome.outcome === 'forwarded' || outcome.outcome === 'no_task') {
    return 0;
  }
  return outcome.outcome === 'refused_uncertified' ? 2 : 1;
}

/** The live seams: real helpers, real PromptEngine, a real Cursor session. */
export function createLiveSeatDeps(args: CursorSeatSpikeArgs, env: NodeJS.ProcessEnv): SeatDeps {
  const worktree = roleWorktreePath(args.repoRoot, args.role);
  const apiKey = env.CURSOR_API_KEY?.trim();
  return {
    readRegistry: () => readModelStewardRegistry(args.repoRoot),
    composePromptBundle: async (role) =>
      execFileSync(
        'bb',
        [path.join(args.repoRoot, 'swarmforge', 'scripts', 'prompt_engine_cli.bb'), 'compose', args.agent, role, '0'],
        { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
      ),
    openSession: async (opts) => {
      if (!apiKey) {
        throw new Error('CURSOR_API_KEY is not set; the Cursor seat cannot open a session.');
      }
      return openLiveCursorSeatSession({ ...opts, apiKey, modelId: args.identity.model });
    },
    sendTask: async (session, task) =>
      sendTaskToLiveSession(session as LiveSeatSession, args.role, task, readHeadShortCommit),
    runHelper: async (name, helperArgs) => {
      try {
        const stdout = execFileSync(seatHelperPath(worktree, name), helperArgs, {
          cwd: worktree,
          encoding: 'utf8',
          maxBuffer: 32 * 1024 * 1024,
        });
        return { exitCode: 0, stdout };
      } catch (err) {
        const e = err as { status?: number; stdout?: string; message?: string };
        return { exitCode: typeof e.status === 'number' ? e.status : 1, stdout: e.stdout ?? e.message ?? '' };
      }
    },
    writeFile: (filePath, content) => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
    },
    now: () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'),
  };
}

export interface CursorSeatSpikeIo {
  cwd: string;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  write: (line: string) => void;
  createDeps?: (args: CursorSeatSpikeArgs, env: NodeJS.ProcessEnv) => SeatDeps;
  run?: (deps: SeatDeps, opts: SeatRunOptions) => Promise<SeatRunOutcome>;
}

export async function main(argv: string[], io: CursorSeatSpikeIo): Promise<number> {
  let args: CursorSeatSpikeArgs;
  try {
    args = parseCursorSeatSpikeArgs(argv, io.cwd);
  } catch (err) {
    io.write((err as Error).message);
    return 64;
  }
  if (args.help) {
    io.write(usageText());
    return 0;
  }
  const createDeps = io.createDeps ?? createLiveSeatDeps;
  const run = io.run ?? runSeatOnce;
  const deps = createDeps(args, io.env as NodeJS.ProcessEnv);
  const outcome = await run(deps, {
    repoRoot: args.repoRoot,
    role: args.role,
    identity: args.identity,
    env: io.env,
    priority: args.priority,
  });
  io.write(formatSeatRunReport(outcome));
  return exitCodeForOutcome(outcome);
}

/* istanbul ignore next -- process entry point only */
if (require.main === module) {
  main(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    write: (line) => console.log(line),
  })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
